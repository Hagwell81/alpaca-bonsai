use std::io;
use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::{Backend, CrosstermBackend},
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Tabs, Wrap},
    Frame, Terminal,
};
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::error;
use tui_textarea::TextArea;

/// ASCII art banner for the alpaca-tui.
const ALPACA_BANNER: &str = r"
███████╗██╗     ███████╗███████╗██████╗███████╗
██╔══██║██║     ██╔══██║██╔══██║██╔═══╝██╔══██║
███████║██║     ███████║███████║██║    ███████║
██╔══██║██║     ██╔════╝██╔══██║██║    ██╔══██║
██║  ██║███████╗██║     ██║  ██║██████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═════╝╚═╝  ╚═╝
                                               
";

/// Default control URL: the desktop API gateway (port 13439) which routes
/// intelligently across slots 13434-13438. Falls back to the primary slot
/// (13434) if the gateway is unavailable.
const DEFAULT_CONTROL_URL: &str = "http://127.0.0.1:13439";

#[derive(Parser)]
#[command(name = "alpaca-tui", about = "Terminal UI for the Alpaca local LLM server")]
struct Cli {
    /// Control API URL (default: desktop API gateway on port 13439).
    /// Use http://127.0.0.1:13434 for the primary slot directly,
    /// or http://127.0.0.1:15450 for bonsai-beach.
    #[arg(long, default_value = DEFAULT_CONTROL_URL)]
    control: String,
    /// Default model ID to send with chat requests.
    #[arg(long, default_value = "bonsai-27b")]
    model: String,
    /// Workspace folder for file context. If not provided, shows a
    /// workspace selection step at startup.
    #[arg(long, value_name = "DIR")]
    workspace: Option<PathBuf>,
    /// Skip the workspace selection step.
    #[arg(long)]
    no_workspace: bool,
    /// System prompt to prepend to every conversation.
    #[arg(long)]
    system_prompt: Option<String>,
}

/// TUI configuration persisted between launches.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct TuiConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_prompt: Option<String>,
}

impl Default for TuiConfig {
    fn default() -> Self {
        Self { workspace: None, system_prompt: None }
    }
}

impl TuiConfig {
    fn load() -> Self {
        let path = Self::config_path();
        if let Some(ref p) = path {
            if let Ok(content) = std::fs::read_to_string(p) {
                if let Ok(cfg) = serde_json::from_str::<TuiConfig>(&content) {
                    return cfg;
                }
            }
        }
        Self::default()
    }

    fn save(&self) {
        if let Some(ref path) = Self::config_path() {
            if let Ok(json) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(path, json);
            }
        }
    }

    fn config_path() -> Option<PathBuf> {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            if cfg!(target_os = "windows") {
                Some(PathBuf::from(home).join("AppData").join("Roaming").join("alpaca-tui").join("config.json"))
            } else {
                Some(PathBuf::from(home).join(".config").join("alpaca-tui").join("config.json"))
            }
        } else {
            None
        }
    }
}

// ============================================================================
// Data types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
struct ModelInfo {
    id: String,
    #[serde(default)]
    owned_by: Option<String>,
}

/// A single chat message in the conversation.
#[derive(Debug, Clone)]
struct ChatMessage {
    role: MessageRole,
    content: String,
    /// Reasoning/thinking content extracted from the model's response.
    /// Displayed in a dimmed, collapsible block above the content.
    reasoning: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum MessageRole {
    User,
    Assistant,
    System,
    Error,
}

impl MessageRole {
    fn label(&self) -> &'static str {
        match self {
            MessageRole::User => "You",
            MessageRole::Assistant => "Assistant",
            MessageRole::System => "System",
            MessageRole::Error => "Error",
        }
    }

    fn color(&self) -> Color {
        match self {
            MessageRole::User => Color::Cyan,
            MessageRole::Assistant => Color::Green,
            MessageRole::System => Color::Yellow,
            MessageRole::Error => Color::Red,
        }
    }
}

// ============================================================================
// Main entry point
// ============================================================================

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // ── Workspace selection step ──────────────────────────────────────
    let workspace_folder = if cli.no_workspace {
        None
    } else if let Some(ref ws) = cli.workspace {
        if ws.is_dir() { Some(ws.clone()) } else { None }
    } else {
        let config = TuiConfig::load();
        let result = run_workspace_selection(&mut terminal, config.workspace.clone()).await?;
        match result {
            WorkspaceSelection::Selected(folder) => {
                let mut cfg = TuiConfig::load();
                cfg.workspace = Some(folder.to_string_lossy().to_string());
                cfg.save();
                Some(folder)
            }
            WorkspaceSelection::Skipped => None,
            WorkspaceSelection::Quit => {
                disable_raw_mode()?;
                execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
                return Ok(());
            }
        }
    };

    // ── Main TUI app ──────────────────────────────────────────────────
    let result = run_app(&mut terminal, cli, workspace_folder).await;

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;

    if let Err(e) = result {
        if e.to_string() == "__QUIT__" {
            return Ok(());
        }
        error!(error = %e, "TUI error");
    }
    Ok(())
}

// ============================================================================
// Workspace selection step
// ============================================================================

enum WorkspaceSelection {
    Selected(PathBuf),
    Skipped,
    Quit,
}

struct WorkspaceApp {
    saved_workspace: Option<String>,
    path_input: String,
    editing_path: bool,
    recent_dirs: Vec<PathBuf>,
    list_state: ListState,
    focus: usize,
    button_focus: usize,
    error: Option<String>,
}

impl WorkspaceApp {
    fn new(saved_workspace: Option<String>) -> Self {
        let recent_dirs = discover_recent_dirs();
        let mut list_state = ListState::default();
        list_state.select(Some(0));
        Self {
            saved_workspace,
            path_input: String::new(),
            editing_path: false,
            recent_dirs,
            list_state,
            focus: 0,
            button_focus: 0,
            error: None,
        }
    }

    fn buttons(&self) -> [&'static str; 3] {
        if self.saved_workspace.is_some() {
            ["Use Saved", "Skip", "Quit"]
        } else {
            ["Skip", "Skip", "Quit"]
        }
    }
}

fn discover_recent_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        for sub in &["Projects", "repos", "code", "src", "workspace", "Documents"] {
            let p = home.join(sub);
            if p.is_dir() {
                dirs.push(p);
            }
        }
        dirs.push(home);
    }
    if let Ok(cwd) = std::env::current_dir() {
        if !dirs.contains(&cwd) {
            dirs.push(cwd);
        }
    }
    dirs
}

async fn run_workspace_selection(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    saved_workspace: Option<String>,
) -> anyhow::Result<WorkspaceSelection> {
    let mut app = WorkspaceApp::new(saved_workspace);

    loop {
        terminal.draw(|f| draw_workspace_selection(f, &mut app))?;

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let ev = event::read()?;
        if let Event::Key(key) = ev {
            if key.kind != KeyEventKind::Press {
                continue;
            }

            if app.editing_path {
                match key.code {
                    KeyCode::Enter => {
                        let p = PathBuf::from(&app.path_input);
                        if p.is_dir() {
                            return Ok(WorkspaceSelection::Selected(p));
                        } else {
                            app.error = Some(format!("Not a directory: {}", app.path_input));
                        }
                    }
                    KeyCode::Esc => {
                        app.editing_path = false;
                        app.path_input.clear();
                        app.error = None;
                    }
                    KeyCode::Backspace => {
                        app.path_input.pop();
                    }
                    KeyCode::Char(c) => {
                        app.path_input.push(c);
                    }
                    _ => {}
                }
                continue;
            }

            match key.code {
                KeyCode::Char('q') => return Ok(WorkspaceSelection::Quit),
                KeyCode::Tab => {
                    app.focus = (app.focus + 1) % 3;
                    app.button_focus = 0;
                }
                KeyCode::BackTab => {
                    app.focus = (app.focus + 2) % 3;
                    app.button_focus = 0;
                }
                KeyCode::Up => {
                    if app.focus == 0 {
                        let i = app.list_state.selected().unwrap_or(0);
                        if i > 0 {
                            app.list_state.select(Some(i - 1));
                        }
                    } else if app.focus == 2 {
                        app.button_focus = (app.button_focus + 2) % 3;
                    }
                }
                KeyCode::Down => {
                    if app.focus == 0 {
                        let i = app.list_state.selected().unwrap_or(0);
                        if i + 1 < app.recent_dirs.len() {
                            app.list_state.select(Some(i + 1));
                        }
                    } else if app.focus == 2 {
                        app.button_focus = (app.button_focus + 1) % 3;
                    }
                }
                KeyCode::Enter => {
                    match app.focus {
                        0 => {
                            if let Some(i) = app.list_state.selected() {
                                if let Some(dir) = app.recent_dirs.get(i) {
                                    return Ok(WorkspaceSelection::Selected(dir.clone()));
                                }
                            }
                        }
                        1 => {
                            app.editing_path = true;
                            app.error = None;
                        }
                        2 => {
                            match app.button_focus {
                                0 if app.saved_workspace.is_some() => {
                                    if let Some(ref ws) = app.saved_workspace {
                                        let p = PathBuf::from(ws);
                                        if p.is_dir() {
                                            return Ok(WorkspaceSelection::Selected(p));
                                        } else {
                                            app.error = Some(format!("Saved workspace not found: {}", ws));
                                        }
                                    }
                                }
                                _ => return Ok(WorkspaceSelection::Skipped),
                            }
                        }
                        _ => {}
                    }
                }
                KeyCode::Char('s') => return Ok(WorkspaceSelection::Skipped),
                _ => {}
            }
        }
    }
}

fn draw_workspace_selection(f: &mut Frame, app: &mut WorkspaceApp) {
    let area = f.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(8),
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Length(1),
            Constraint::Length(2),
        ])
        .split(area);

    let banner = Paragraph::new(ALPACA_BANNER)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center);
    f.render_widget(banner, chunks[0]);

    let title = Paragraph::new("Select a workspace folder")
        .style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center);
    f.render_widget(title, chunks[1]);

    let items: Vec<ListItem> = app
        .recent_dirs
        .iter()
        .map(|d| ListItem::new(d.to_string_lossy().to_string()))
        .collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Recent Directories "))
        .highlight_style(Style::default().bg(Color::DarkGray))
        .highlight_symbol("> ");
    f.render_stateful_widget(list, chunks[2], &mut app.list_state);

    let path_block = Block::default().borders(Borders::ALL).title(" Manual Path ");
    let path_text = if app.editing_path {
        format!("{}|", app.path_input)
    } else {
        app.path_input.clone()
    };
    let path_widget = Paragraph::new(path_text)
        .block(path_block)
        .style(if app.focus == 1 { Style::default().fg(Color::Yellow) } else { Style::default() });
    f.render_widget(path_widget, chunks[3]);

    let buttons = app.buttons();
    let button_spans: Vec<Span> = buttons
        .iter()
        .enumerate()
        .flat_map(|(i, b)| {
            let style = if app.focus == 2 && app.button_focus == i {
                Style::default().fg(Color::Black).bg(Color::White).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };
            vec![Span::styled(format!(" [{}] ", b), style)]
        })
        .collect();
    let button_line = Line::from(button_spans).alignment(Alignment::Center);
    let button_widget = Paragraph::new(button_line);
    f.render_widget(button_widget, chunks[4]);

    if let Some(ref err) = app.error {
        let err_widget = Paragraph::new(err.as_str()).style(Style::default().fg(Color::Red));
        f.render_widget(err_widget, chunks[6]);
    } else {
        let hint = " [Tab] switch focus  [Enter] select/confirm  [s] skip  [q] quit ";
        let hint_widget = Paragraph::new(hint).style(Style::default().fg(Color::DarkGray));
        f.render_widget(hint_widget, chunks[6]);
    }
}

// ============================================================================
// Main app (tabbed interface)
// ============================================================================

enum AppEvent {
    Models(Vec<ModelInfo>),
    Error(String),
    Input(Event),
    /// A chunk of streamed assistant text has arrived.
    StreamChunk(String),
    /// A chunk of streamed reasoning/thinking text has arrived.
    StreamReasoning(String),
    /// The stream has completed.
    StreamDone,
    /// The stream failed with an error.
    StreamError(String),
    /// Usage info from the last response.
    Usage(usize, usize),
    /// The model has started a tool call (name, arguments_json).
    ToolCallStart(String, String),
    /// A tool call has completed (name, result).
    ToolCallResult(String, String),
}

struct App {
    active_tab: usize,
    tabs: Vec<&'static str>,
    models: Vec<ModelInfo>,
    model_state: ListState,
    /// Multi-line text editor for chat input.
    textarea: TextArea<'static>,
    /// Conversation history (user + assistant messages).
    messages: Vec<ChatMessage>,
    /// Scroll offset for the chat history (lines from bottom).
    chat_scroll: usize,
    /// Transient error/status banner.
    status_msg: Option<(String, Color)>,
    /// Control URL for API calls.
    control_url: String,
    /// Selected model ID for chat requests.
    selected_model: String,
    /// Workspace folder path (if configured).
    workspace: Option<PathBuf>,
    /// System prompt prepended to every conversation.
    system_prompt: Option<String>,
    /// Whether a chat request is currently in-flight.
    is_streaming: bool,
    /// Accumulated assistant text for the current streaming response.
    streaming_text: String,
    /// Accumulated reasoning/thinking text for the current streaming response.
    streaming_reasoning: String,
    /// Token usage from the last response (prompt, completion).
    last_token_usage: Option<(usize, usize)>,
}

impl App {
    fn new(cli: Cli, workspace: Option<PathBuf>) -> Self {
        let mut state = ListState::default();
        state.select(Some(0));
        let textarea = TextArea::default();
        Self {
            active_tab: 1, // Start on Chat tab
            tabs: vec!["Models", "Chat", "Logs"],
            models: vec![],
            model_state: state,
            textarea,
            messages: vec![],
            chat_scroll: 0,
            status_msg: None,
            control_url: cli.control,
            selected_model: cli.model,
            workspace,
            system_prompt: cli.system_prompt,
            is_streaming: false,
            streaming_text: String::new(),
            streaming_reasoning: String::new(),
            last_token_usage: None,
        }
    }

    /// Push a message into the conversation and reset scroll to bottom.
    fn push_message(&mut self, msg: ChatMessage) {
        self.messages.push(msg);
        self.chat_scroll = 0;
    }

    /// Get the chat history as styled lines for rendering.
    fn chat_lines(&self) -> Vec<Line<'_>> {
        let mut lines: Vec<Line> = Vec::new();
        for msg in &self.messages {
            let label = msg.role.label();
            let color = msg.role.color();
            lines.push(Line::from(vec![
                Span::styled(format!("{}:", label), Style::default().fg(color).add_modifier(Modifier::BOLD)),
            ]));
            // Render reasoning/thinking block (dimmed, italic) before content
            if let Some(reasoning) = &msg.reasoning {
                if !reasoning.is_empty() {
                    let reasoning_style = Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC);
                    lines.push(Line::from(vec![Span::styled("  ┌─ Thinking ─────────────────────", reasoning_style)]));
                    for rline in reasoning.lines() {
                        lines.push(Line::from(vec![Span::styled(format!("  │ {}", rline), reasoning_style)]));
                    }
                    lines.push(Line::from(vec![Span::styled("  └─────────────────────────────────", reasoning_style)]));
                    lines.push(Line::from(""));
                }
            }
            for content_line in msg.content.lines() {
                lines.push(Line::from(vec![Span::raw(format!("  {}", content_line))]));
            }
            lines.push(Line::from(""));
        }
        // If streaming, show the in-progress assistant text
        if self.is_streaming && (!self.streaming_text.is_empty() || !self.streaming_reasoning.is_empty()) {
            lines.push(Line::from(vec![
                Span::styled("Assistant:", Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
            ]));
            // Show streaming reasoning first (if any)
            if !self.streaming_reasoning.is_empty() {
                let reasoning_style = Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC);
                lines.push(Line::from(vec![Span::styled("  ┌─ Thinking ─────────────────────", reasoning_style)]));
                for rline in self.streaming_reasoning.lines() {
                    lines.push(Line::from(vec![Span::styled(format!("  │ {}", rline), reasoning_style)]));
                }
                // No closing └ while still streaming
                lines.push(Line::from(""));
            }
            for content_line in self.streaming_text.lines() {
                lines.push(Line::from(vec![Span::raw(format!("  {}", content_line))]));
            }
            // Cursor indicator
            lines.push(Line::from(vec![Span::styled("▋", Style::default().fg(Color::Green))]));
        }
        lines
    }

    /// Handle a slash command. Returns true if the app should quit.
    fn handle_command(&mut self, cmd: &str) -> bool {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        let command = parts[0];
        let arg = parts.get(1).map(|s| s.trim()).unwrap_or("");

        match command {
            "/help" | "/?" => {
                let help = concat!(
                    "Available commands:\n",
                    "  /help, /?         Show this help\n",
                    "  /clear            Clear conversation history\n",
                    "  /model <id>       Switch model (e.g. /model bonsai-27b)\n",
                    "  /models           List available models\n",
                    "  /status           Show connection and session status\n",
                    "  /system <prompt>  Set system prompt\n",
                    "  /system clear     Clear system prompt\n",
                    "  /workspace        Show current workspace\n",
                    "  /quit, /exit      Quit the TUI\n",
                );
                self.push_message(ChatMessage { role: MessageRole::System, content: help.to_string(), reasoning: None });
            }
            "/clear" => {
                self.messages.clear();
                self.streaming_text.clear();
                self.streaming_reasoning.clear();
                self.status_msg = Some(("Conversation cleared".to_string(), Color::Yellow));
            }
            "/model" => {
                if arg.is_empty() {
                    self.push_message(ChatMessage {
                        role: MessageRole::System,
                        content: format!("Current model: {}", self.selected_model),
                        reasoning: None,
                    });
                } else {
                    self.selected_model = arg.to_string();
                    self.status_msg = Some((format!("Model set to: {}", arg), Color::Green));
                }
            }
            "/models" => {
                if self.models.is_empty() {
                    self.push_message(ChatMessage {
                        role: MessageRole::System,
                        content: "No models available (is the server running?)".to_string(),
                        reasoning: None,
                    });
                } else {
                    let list: Vec<String> = self.models.iter().map(|m| format!("  - {}", m.id)).collect();
                    self.push_message(ChatMessage {
                        role: MessageRole::System,
                        content: format!("Available models:\n{}", list.join("\n")),
                        reasoning: None,
                    });
                }
            }
            "/status" => {
                let ws = self.workspace.as_ref().map(|w| w.display().to_string()).unwrap_or_else(|| "(none)".to_string());
                let sp = self.system_prompt.as_deref().unwrap_or("(none)");
                let tokens = self.last_token_usage.map(|(p, c)| format!("{} prompt / {} completion", p, c)).unwrap_or_else(|| "(no usage data)".to_string());
                let status = format!(
                    "Endpoint:    {}\nModel:       {}\nWorkspace:   {}\nSystem:      {}\nTokens:      {}\nStreaming:   {}",
                    self.control_url, self.selected_model, ws, sp, tokens,
                    if self.is_streaming { "yes" } else { "no" },
                );
                self.push_message(ChatMessage { role: MessageRole::System, content: status, reasoning: None });
            }
            "/system" => {
                if arg == "clear" {
                    self.system_prompt = None;
                    self.status_msg = Some(("System prompt cleared".to_string(), Color::Yellow));
                } else if arg.is_empty() {
                    let sp = self.system_prompt.as_deref().unwrap_or("(none)");
                    self.push_message(ChatMessage {
                        role: MessageRole::System,
                        content: format!("Current system prompt:\n{}", sp),
                        reasoning: None,
                    });
                } else {
                    self.system_prompt = Some(arg.to_string());
                    self.status_msg = Some(("System prompt set".to_string(), Color::Green));
                }
            }
            "/workspace" => {
                let ws = self.workspace.as_ref().map(|w| w.display().to_string()).unwrap_or_else(|| "(no workspace set)".to_string());
                self.push_message(ChatMessage {
                    role: MessageRole::System,
                    content: format!("Workspace: {}", ws),
                    reasoning: None,
                });
            }
            "/quit" | "/exit" => return true,
            _ => {
                self.push_message(ChatMessage {
                    role: MessageRole::Error,
                    content: format!("Unknown command: {}. Type /help for available commands.", command),
                    reasoning: None,
                });
            }
        }
        false
    }
}

async fn run_app<B: Backend>(
    terminal: &mut Terminal<B>,
    cli: Cli,
    workspace: Option<PathBuf>,
) -> anyhow::Result<()> {
    let mut app = App::new(cli, workspace);

    // Background poller: refresh models list every 5 seconds
    let (event_tx, mut event_rx) = mpsc::channel(64);
    let control_url = app.control_url.clone();
    let poll_tx = event_tx.clone();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            match fetch_models(&client, &control_url).await {
                Ok(models) => {
                    let _ = poll_tx.send(AppEvent::Models(models)).await;
                }
                Err(e) => {
                    let _ = poll_tx.send(AppEvent::Error(e.to_string())).await;
                }
            }
        }
    });

    // Input reader task
    let input_tx = event_tx.clone();
    tokio::spawn(async move {
        loop {
            if event::poll(Duration::from_millis(50)).unwrap_or(false) {
                if let Ok(ev) = event::read() {
                    let _ = input_tx.send(AppEvent::Input(ev)).await;
                }
            }
        }
    });

    loop {
        terminal.draw(|f| draw(f, &mut app))?;

        tokio::select! {
            Some(event) = event_rx.recv() => {
                match event {
                    AppEvent::Models(models) => {
                        app.models = models;
                        app.status_msg = None;
                    }
                    AppEvent::Error(msg) => {
                        app.status_msg = Some((format!("Server: {}", msg), Color::Red));
                    }
                    AppEvent::Input(ev) => {
                        if handle_input(&ev, &mut app, &event_tx).await? {
                            break;
                        }
                    }
                    AppEvent::StreamChunk(chunk) => {
                        app.streaming_text.push_str(&chunk);
                        app.chat_scroll = 0;
                    }
                    AppEvent::StreamReasoning(chunk) => {
                        app.streaming_reasoning.push_str(&chunk);
                        app.chat_scroll = 0;
                    }
                    AppEvent::StreamDone => {
                        let content = std::mem::take(&mut app.streaming_text);
                        let reasoning = std::mem::take(&mut app.streaming_reasoning);
                        if !content.is_empty() || !reasoning.is_empty() {
                            app.push_message(ChatMessage {
                                role: MessageRole::Assistant,
                                content,
                                reasoning: if reasoning.is_empty() { None } else { Some(reasoning) },
                            });
                        }
                        app.is_streaming = false;
                    }
                    AppEvent::StreamError(msg) => {
                        let content = std::mem::take(&mut app.streaming_text);
                        let reasoning = std::mem::take(&mut app.streaming_reasoning);
                        if !content.is_empty() || !reasoning.is_empty() {
                            app.push_message(ChatMessage {
                                role: MessageRole::Assistant,
                                content,
                                reasoning: if reasoning.is_empty() { None } else { Some(reasoning) },
                            });
                        }
                        app.push_message(ChatMessage { role: MessageRole::Error, content: msg, reasoning: None });
                        app.is_streaming = false;
                    }
                    AppEvent::Usage(prompt, completion) => {
                        app.last_token_usage = Some((prompt, completion));
                    }
                    AppEvent::ToolCallStart(name, args) => {
                        // Show the tool call as a system-style message in the chat
                        let preview = if args.len() > 120 {
                            format!("{}({}…)", name, &args[..120])
                        } else {
                            format!("{}({})", name, args)
                        };
                        app.push_message(ChatMessage {
                            role: MessageRole::Error, // reuse Error styling (dim/italic)
                            content: format!("→ calling tool {}", preview),
                            reasoning: None,
                        });
                        app.chat_scroll = 0;
                    }
                    AppEvent::ToolCallResult(name, result) => {
                        let preview = if result.len() > 200 {
                            format!("{}…", &result[..200])
                        } else {
                            result.clone()
                        };
                        app.push_message(ChatMessage {
                            role: MessageRole::Error, // reuse Error styling (dim/italic)
                            content: format!("← {} returned: {}", name, preview),
                            reasoning: None,
                        });
                        app.chat_scroll = 0;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handle a keyboard event. Returns Ok(true) if the app should quit.
async fn handle_input(
    event: &Event,
    app: &mut App,
    event_tx: &mpsc::Sender<AppEvent>,
) -> anyhow::Result<bool> {
    if let Event::Key(key) = event {
        if key.kind != KeyEventKind::Press {
            return Ok(false);
        }

        // ── Global keys (work on all tabs) ───────────────────────────
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            return Ok(true);
        }

        // Function keys for tab switching
        match key.code {
            KeyCode::F(1) => { app.active_tab = 0; return Ok(false); }
            KeyCode::F(2) => { app.active_tab = 1; return Ok(false); }
            KeyCode::F(3) => { app.active_tab = 2; return Ok(false); }
            _ => {}
        }

        // ── Tab-specific input ───────────────────────────────────────
        match app.active_tab {
            0 => handle_models_input(*key, app).await?,
            1 => handle_chat_input(*key, app, event_tx).await?,
            2 => handle_logs_input(*key, app).await?,
            _ => {}
        }
    }
    Ok(false)
}

/// Input handler for the Models tab.
async fn handle_models_input(key: event::KeyEvent, app: &mut App) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Up => {
            let i = app.model_state.selected().unwrap_or(0);
            if i > 0 {
                app.model_state.select(Some(i - 1));
            }
        }
        KeyCode::Down => {
            let i = app.model_state.selected().unwrap_or(0);
            if i + 1 < app.models.len() {
                app.model_state.select(Some(i + 1));
            }
        }
        KeyCode::Enter => {
            if let Some(i) = app.model_state.selected() {
                if let Some(m) = app.models.get(i) {
                    app.selected_model = m.id.clone();
                    app.status_msg = Some((format!("Model set to: {}", m.id), Color::Green));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Input handler for the Chat tab.
async fn handle_chat_input(
    key: event::KeyEvent,
    app: &mut App,
    event_tx: &mpsc::Sender<AppEvent>,
) -> anyhow::Result<()> {
    if app.is_streaming {
        return Ok(());
    }

    // Tab/BackTab: switch tabs (textarea doesn't need Tab)
    if key.code == KeyCode::Tab {
        app.active_tab = (app.active_tab + 1) % app.tabs.len();
        return Ok(());
    }
    if key.code == KeyCode::BackTab {
        app.active_tab = (app.active_tab + app.tabs.len() - 1) % app.tabs.len();
        return Ok(());
    }

    // PageUp/PageDown: scroll chat history
    if key.code == KeyCode::PageUp {
        app.chat_scroll = app.chat_scroll.saturating_add(10);
        return Ok(());
    }
    if key.code == KeyCode::PageDown {
        app.chat_scroll = app.chat_scroll.saturating_sub(10);
        return Ok(());
    }

    // Enter: submit (Shift+Enter inserts newline via textarea)
    if key.code == KeyCode::Enter && !key.modifiers.contains(KeyModifiers::SHIFT) {
        let text = app.textarea.lines().join("\n");
        if text.is_empty() {
            return Ok(());
        }

        // Reset textarea
        app.textarea = TextArea::default();
        app.textarea.set_block(Block::default().borders(Borders::ALL).title(" Message (Enter to send, Shift+Enter for newline) "));

        // Slash command?
        if text.starts_with('/') {
            let should_quit = app.handle_command(&text);
            if should_quit {
                return Err(anyhow::anyhow!("__QUIT__"));
            }
            return Ok(());
        }

        // Regular chat message
        app.push_message(ChatMessage { role: MessageRole::User, content: text.clone(), reasoning: None });
        app.is_streaming = true;
        app.streaming_text.clear();
        app.streaming_reasoning.clear();

        let control_url = app.control_url.clone();
        let model = app.selected_model.clone();
        let system_prompt = app.system_prompt.clone();
        let tx = event_tx.clone();

        tokio::spawn(async move {
            if let Err(e) = stream_chat(&control_url, &model, &text, system_prompt.as_deref(), &tx).await {
                let _ = tx.send(AppEvent::StreamError(e.to_string())).await;
            }
        });

        return Ok(());
    }

    // All other keys go to the textarea
    app.textarea.input(key);
    Ok(())
}

/// Input handler for the Logs tab.
async fn handle_logs_input(key: event::KeyEvent, app: &mut App) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Char('c') => {
            app.status_msg = Some(("Status cleared".to_string(), Color::Yellow));
        }
        _ => {}
    }
    Ok(())
}

// ============================================================================
// Drawing
// ============================================================================

fn draw(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(9),   // Banner + tabs
            Constraint::Min(0),       // Main content
            Constraint::Length(3),    // Status bar
        ])
        .split(f.area());

    // Header area: banner (6 lines) + tabs (3 lines)
    let header_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(6), Constraint::Length(3)])
        .split(chunks[0]);

    let ws_line = if let Some(ref ws) = app.workspace {
        format!(" Workspace: {} ", ws.display())
    } else {
        " No workspace ".to_string()
    };
    let header_text = format!("{}\n{}", ALPACA_BANNER, ws_line);
    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center);
    f.render_widget(header, header_chunks[0]);

    let tabs = Tabs::new(app.tabs.iter().map(|t| Line::from(*t)).collect::<Vec<_>>())
        .select(app.active_tab)
        .style(Style::default().fg(Color::White))
        .highlight_style(Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
        .block(Block::default().borders(Borders::ALL).title(" Tab (F1/F2/F3) "));
    f.render_widget(tabs, header_chunks[1]);

    // Main content
    match app.active_tab {
        0 => draw_models(f, app, chunks[1]),
        1 => draw_chat(f, app, chunks[1]),
        2 => draw_logs(f, app, chunks[1]),
        _ => {}
    }

    // Status bar
    draw_status_bar(f, app, chunks[2]);
}

fn draw_status_bar(f: &mut Frame, app: &mut App, area: Rect) {
    let model = &app.selected_model;
    let endpoint = app.control_url.replace("http://", "");
    let ws = app.workspace.as_ref().map(|w| w.display().to_string()).unwrap_or_else(|| "no-ws".to_string());
    let state = if app.is_streaming { "streaming" } else { "ready" };
    let state_color = if app.is_streaming { Color::Yellow } else { Color::Green };

    let mut spans = vec![
        Span::styled(" Model: ", Style::default().fg(Color::DarkGray)),
        Span::styled(model.clone(), Style::default().fg(Color::Cyan)),
        Span::styled(" | ", Style::default().fg(Color::DarkGray)),
        Span::styled("Endpoint: ", Style::default().fg(Color::DarkGray)),
        Span::styled(endpoint, Style::default().fg(Color::White)),
        Span::styled(" | ", Style::default().fg(Color::DarkGray)),
        Span::styled("WS: ", Style::default().fg(Color::DarkGray)),
        Span::styled(ws, Style::default().fg(Color::White)),
        Span::styled(" | ", Style::default().fg(Color::DarkGray)),
        Span::styled(state, Style::default().fg(state_color)),
    ];

    if let Some((prompt, completion)) = app.last_token_usage {
        spans.push(Span::styled(format!(" | tokens: {}+{}", prompt, completion), Style::default().fg(Color::DarkGray)));
    }

    let line = Line::from(spans);
    let bar = Paragraph::new(line)
        .block(Block::default().borders(Borders::ALL).title(" Status (Ctrl+C to quit) "));
    f.render_widget(bar, area);
}

fn draw_models(f: &mut Frame, app: &mut App, area: Rect) {
    let items: Vec<ListItem> = if app.models.is_empty() {
        vec![ListItem::new(Line::from(vec![
            Span::styled("(no models — is the server running on ", Style::default().fg(Color::DarkGray)),
            Span::styled(app.control_url.clone(), Style::default().fg(Color::Yellow)),
            Span::styled("?)", Style::default().fg(Color::DarkGray)),
        ]))]
    } else {
        app.models
            .iter()
            .map(|m| {
                let line = Line::from(vec![
                    Span::styled(format!(" {} ", m.id), Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
                    Span::raw(format!("  (owned_by: {}) ", m.owned_by.as_deref().unwrap_or("unknown"))),
                ]);
                ListItem::new(line)
            })
            .collect()
    };

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Models [Up/Dn] navigate [Enter] select for chat "))
        .highlight_style(Style::default().bg(Color::DarkGray))
        .highlight_symbol("> ");
    f.render_stateful_widget(list, area, &mut app.model_state);
}

fn draw_chat(f: &mut Frame, app: &mut App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(5), Constraint::Length(3)])
        .split(area);

    // Chat history
    let lines = app.chat_lines();
    let total_lines = lines.len();
    let height = chunks[0].height.saturating_sub(2) as usize;

    let visible_start = if total_lines <= height {
        0
    } else {
        total_lines.saturating_sub(height + app.chat_scroll)
    };
    let visible_end = total_lines.saturating_sub(app.chat_scroll);
    let visible_lines: Vec<Line> = lines.into_iter()
        .skip(visible_start)
        .take(visible_end.saturating_sub(visible_start))
        .collect();

    let scroll_title = if app.chat_scroll > 0 {
        format!(" Chat (scrolled: {} from bottom) ", app.chat_scroll)
    } else {
        " Chat (PgUp/PgDn to scroll) ".to_string()
    };

    let chat = Paragraph::new(visible_lines)
        .block(Block::default().borders(Borders::ALL).title(scroll_title))
        .wrap(Wrap { trim: false });
    f.render_widget(chat, chunks[0]);

    // Input textarea
    f.render_widget(&app.textarea, chunks[1]);
}

fn draw_logs(f: &mut Frame, app: &mut App, area: Rect) {
    let logs: String = if app.status_msg.is_none() && app.models.is_empty() {
        "(no logs — background poller status will appear here)".to_string()
    } else {
        let mut parts = Vec::new();
        if let Some((ref msg, _color)) = app.status_msg {
            parts.push(format!("[status] {}", msg));
        }
        if !app.models.is_empty() {
            parts.push(format!("[models] {} model(s) available", app.models.len()));
        }
        parts.join("\n")
    };
    let log_widget = Paragraph::new(logs)
        .block(Block::default().borders(Borders::ALL).title(" Logs "))
        .wrap(Wrap { trim: true });
    f.render_widget(log_widget, area);
}

// ============================================================================
// API calls
// ============================================================================

/// Fetch the list of models from /v1/models.
///
/// Filters out vision projector (mmproj) files, which are not standalone chat
/// models — they are loaded alongside a base model to provide vision support.
/// Matches both naming conventions: "mmproj-*" (standard) and "*-mmproj-*" (bonsai).
async fn fetch_models(client: &reqwest::Client, control_url: &str) -> anyhow::Result<Vec<ModelInfo>> {
    let url = format!("{}/v1/models", control_url);
    let resp = client.get(&url).timeout(Duration::from_secs(5)).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("GET /v1/models returned {}", resp.status());
    }
    let body: serde_json::Value = resp.json().await?;
    let data = body.get("data").cloned().unwrap_or(serde_json::Value::Array(vec![]));
    let arr = data.as_array().cloned().unwrap_or_default();
    let models = arr
        .iter()
        .filter(|item| {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !is_mmproj_filename(id)
        })
        .map(|item| ModelInfo {
            id: item.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            owned_by: item.get("owned_by").and_then(|v| v.as_str()).map(|s| s.to_string()),
        })
        .collect();
    Ok(models)
}

/// Returns true if the filename is a vision projector (mmproj) file.
/// Matches "mmproj-" prefix and "-mmproj-" infix (bonsai naming convention).
fn is_mmproj_filename(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.starts_with("mmproj-") || lower.contains("-mmproj-")
}

// ============================================================================
// Built-in tools (agentic loop support)
//
// The TUI ships with a small set of built-in tools that the model can call
// during a chat session. Tool definitions are sent via the OpenAI-compatible
// `tools` field in /v1/chat/completions. When the model returns tool_calls,
// the TUI executes them locally and sends the results back in a follow-up
// request, looping until the model produces a final answer with no tool calls.
//
// Available tools:
// - read_file:  Read a text file from the workspace (capped at 32 KB)
// - list_dir:   List directory contents in the workspace
// - web_fetch:  Fetch a URL and return trimmed text content (capped at 16 KB)
// ============================================================================

/// Build the JSON array of tool definitions sent to the model.
fn builtin_tool_definitions() -> serde_json::Value {
    serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the contents of a text file from the workspace. Returns the file content as a string (truncated to 32 KB).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from the workspace root, or an absolute path."
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List the files and subdirectories in a directory within the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path from the workspace root, or an absolute path. Use \".\" for the workspace root."
                        }
                    },
                    "required": ["path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "Fetch a URL and return the response body as text (truncated to 16 KB). Useful for reading documentation or web pages.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The HTTP(S) URL to fetch."
                        }
                    },
                    "required": ["url"]
                }
            }
        }
    ])
}

/// A parsed tool call from the model's response.
#[derive(Debug, Clone)]
struct ToolCall {
    id: String,
    name: String,
    arguments: String,
}

/// Execute a built-in tool call and return the result string.
async fn execute_tool_call(
    call: &ToolCall,
    workspace: &Option<PathBuf>,
) -> String {
    let args: serde_json::Value = serde_json::from_str(&call.arguments).unwrap_or(serde_json::json!({}));
    match call.name.as_str() {
        "read_file" => {
            let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let path = resolve_workspace_path(path_str, workspace);
            match std::fs::read_to_string(&path) {
                Ok(mut content) => {
                    // Truncate to 32 KB
                    const MAX: usize = 32 * 1024;
                    if content.len() > MAX {
                        content.truncate(MAX);
                        content.push_str("\n... (truncated)");
                    }
                    content
                }
                Err(e) => format!("Error reading file '{}': {}", path.display(), e),
            }
        }
        "list_dir" => {
            let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let path = resolve_workspace_path(path_str, workspace);
            match std::fs::read_dir(&path) {
                Ok(entries) => {
                    let mut items: Vec<String> = Vec::new();
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let prefix = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            "[DIR]  "
                        } else {
                            "[FILE] "
                        };
                        items.push(format!("{}{}", prefix, name));
                    }
                    items.sort();
                    if items.is_empty() {
                        "(empty directory)".to_string()
                    } else {
                        items.join("\n")
                    }
                }
                Err(e) => format!("Error listing directory '{}': {}", path.display(), e),
            }
        }
        "web_fetch" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                return "Error: url parameter is required".to_string();
            }
            // Block non-HTTP schemes for safety
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return format!("Error: only http:// and https:// URLs are allowed, got: {}", url);
            }
            match reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
            {
                Ok(client) => {
                    match client.get(url).header("User-Agent", "alpaca-tui/2.0").send().await {
                        Ok(resp) => {
                            let status = resp.status();
                            match resp.text().await {
                                Ok(mut body) => {
                                    // Strip HTML tags crudely if the content looks like HTML
                                    if body.contains("<html") || body.contains("<!DOCTYPE") {
                                        body = strip_html_tags(&body);
                                    }
                                    // Truncate to 16 KB
                                    const MAX: usize = 16 * 1024;
                                    if body.len() > MAX {
                                        body.truncate(MAX);
                                        body.push_str("\n... (truncated)");
                                    }
                                    format!("HTTP {}:\n{}", status, body)
                                }
                                Err(e) => format!("Error reading response from '{}': {}", url, e),
                            }
                        }
                        Err(e) => format!("Error fetching '{}': {}", url, e),
                    }
                }
                Err(e) => format!("Error creating HTTP client: {}", e),
            }
        }
        _ => format!("Unknown tool: {}", call.name),
    }
}

/// Resolve a path relative to the workspace root, or use it as-is if absolute.
fn resolve_workspace_path(path_str: &str, workspace: &Option<PathBuf>) -> PathBuf {
    let p = std::path::Path::new(path_str);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    match workspace {
        Some(ws) => ws.join(path_str),
        None => PathBuf::from(path_str),
    }
}

/// Crude HTML tag stripper — removes anything between < and >.
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }
    // Collapse multiple whitespace
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Stream a chat completion via SSE from /v1/chat/completions.
///
/// Sends `reasoning_format: "auto"` so the server extracts thinking/reasoning
/// content into a separate `reasoning_content` field in the delta, rather than
/// leaving it inline as `<think>...</think>` tags. The reasoning chunks are
/// forwarded via `AppEvent::StreamReasoning` and rendered in a dimmed block.
async fn stream_chat(
    control_url: &str,
    model: &str,
    user_message: &str,
    system_prompt: Option<&str>,
    tx: &mpsc::Sender<AppEvent>,
) -> anyhow::Result<()> {
    // Build the initial message list. The agentic loop appends assistant
    // tool_calls and tool result messages between iterations.
    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(sp) = system_prompt {
        messages.push(serde_json::json!({ "role": "system", "content": sp }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": user_message }));

    // Agentic loop: keep calling the model until it stops requesting tools.
    // Cap at 8 iterations to avoid runaway loops.
    const MAX_TOOL_ITERATIONS: usize = 8;
    for iteration in 0..MAX_TOOL_ITERATIONS {
        let (content, reasoning, tool_calls) = stream_one_turn(
            control_url,
            model,
            &messages,
            iteration == 0,
            tx,
        )
        .await?;

        // Emit any reasoning collected this turn (only on the first turn so
        // intermediate tool-calling reasoning doesn't spam the UI).
        if iteration == 0 && !reasoning.is_empty() {
            let _ = tx.send(AppEvent::StreamReasoning(reasoning)).await;
        }

        if tool_calls.is_empty() {
            // No tool calls — the model produced a final answer. We're done.
            let _ = tx.send(AppEvent::StreamDone).await;
            return Ok(());
        }

        // Append the assistant message with tool_calls so the next request
        // has the full context.
        let assistant_msg = serde_json::json!({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls.iter().map(|c| serde_json::json!({
                "id": c.id,
                "type": "function",
                "function": {
                    "name": c.name,
                    "arguments": c.arguments,
                }
            })).collect::<Vec<_>>(),
        });
        messages.push(assistant_msg);

        // Execute each tool call and append the results as tool messages.
        for call in &tool_calls {
            let _ = tx
                .send(AppEvent::ToolCallStart(call.name.clone(), call.arguments.clone()))
                .await;
            let workspace: Option<PathBuf> = None; // TUI workspace lookup happens in main loop
            let result = execute_tool_call(call, &workspace).await;
            let _ = tx
                .send(AppEvent::ToolCallResult(call.name.clone(), result.clone()))
                .await;
            messages.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": result,
            }));
        }
    }

    // Hit the iteration cap — emit a final note and stop.
    let _ = tx
        .send(AppEvent::StreamChunk(
            "\n[Tool loop iteration cap reached — stopping.]".to_string(),
        ))
        .await;
    let _ = tx.send(AppEvent::StreamDone).await;
    Ok(())
}

/// Stream a single turn of the conversation. Returns
/// `(content, reasoning, tool_calls)`.
///
/// When `send_tools` is true, the request includes the built-in tool
/// definitions so the model can request tool calls. On subsequent iterations
/// of the agentic loop, tools are still sent so the model can chain calls.
async fn stream_one_turn(
    control_url: &str,
    model: &str,
    messages: &[serde_json::Value],
    is_first_turn: bool,
    tx: &mpsc::Sender<AppEvent>,
) -> anyhow::Result<(String, String, Vec<ToolCall>)> {
    use futures_util::StreamExt;

    let url = format!("{}/v1/chat/completions", control_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()?;

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        // Ask the server to extract thinking into a separate reasoning_content
        // field so we can render it distinctly from the final answer.
        "reasoning_format": "auto",
    });
    // Always send tools — the model decides whether to call them.
    body["tools"] = builtin_tool_definitions();
    body["tool_choice"] = serde_json::json!("auto");

    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("HTTP {}: {}", status, text);
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    // Tracks whether we are inside an inline <think>...</think> block in the
    // content stream (fallback for servers that don't honor reasoning_format).
    let mut in_think_block = false;

    // Accumulators for the final return value
    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    // Tool call accumulator: id -> (name, arguments_buffer)
    let mut tool_calls: std::collections::BTreeMap<usize, (String, String, String)> =
        std::collections::BTreeMap::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    // End of stream — fall through to return accumulated state
                    continue;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    let choice = json.get("choices").and_then(|c| c.get(0));
                    let delta = choice.and_then(|c| c.get("delta"));

                    // Primary path: dedicated reasoning_content field
                    if let Some(reasoning) = delta
                        .and_then(|d| d.get("reasoning_content"))
                        .and_then(|c| c.as_str())
                    {
                        if !reasoning.is_empty() {
                            full_reasoning.push_str(reasoning);
                            // Only stream reasoning to the UI on the first turn
                            // to avoid spamming during tool-call iterations.
                            if is_first_turn {
                                let _ = tx.send(AppEvent::StreamReasoning(reasoning.to_string())).await;
                            }
                        }
                    }

                    // Content path — may contain inline <think> tags as a fallback
                    if let Some(content) = delta
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !content.is_empty() {
                            let (reasoning_chunks, content_chunks) =
                                split_think_tags(content, &mut in_think_block);
                            for r in reasoning_chunks {
                                if !r.is_empty() {
                                    full_reasoning.push_str(&r);
                                    if is_first_turn {
                                        let _ = tx.send(AppEvent::StreamReasoning(r)).await;
                                    }
                                }
                            }
                            for c in content_chunks {
                                if !c.is_empty() {
                                    full_content.push_str(&c);
                                    // Always stream content to the UI
                                    let _ = tx.send(AppEvent::StreamChunk(c)).await;
                                }
                            }
                        }
                    }

                    // Tool calls path — accumulate deltas by index
                    if let Some(tc_array) = delta.and_then(|d| d.get("tool_calls")).and_then(|c| c.as_array()) {
                        for tc in tc_array {
                            let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                            let id = tc.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                            let name = tc
                                .get("function")
                                .and_then(|f| f.get("name"))
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            let args = tc
                                .get("function")
                                .and_then(|f| f.get("arguments"))
                                .and_then(|a| a.as_str())
                                .unwrap_or("")
                                .to_string();
                            let entry = tool_calls.entry(idx).or_insert_with(|| (String::new(), String::new(), String::new()));
                            if !id.is_empty() { entry.0 = id.clone(); }
                            if !name.is_empty() { entry.1 = name.clone(); }
                            entry.2.push_str(&args);
                        }
                    }

                    if let Some(finish) = choice.and_then(|c| c.get("finish_reason")).and_then(|f| f.as_str()) {
                        if finish == "tool_calls" {
                            // Stream ended with tool calls — we'll loop in the caller
                        }
                    }

                    if let Some(usage) = json.get("usage") {
                        let prompt = usage.get("prompt_tokens").and_then(|t| t.as_u64()).unwrap_or(0) as usize;
                        let completion = usage.get("completion_tokens").and_then(|t| t.as_u64()).unwrap_or(0) as usize;
                        let _ = tx.send(AppEvent::Usage(prompt, completion)).await;
                    }
                }
            }
        }
    }

    // Convert accumulated tool_calls into a Vec
    let mut calls = Vec::new();
    for (_, (id, name, args)) in tool_calls {
        if !name.is_empty() {
            calls.push(ToolCall {
                id: if id.is_empty() { format!("call_{}", uuid_like()) } else { id },
                name,
                arguments: args,
            });
        }
    }

    Ok((full_content, full_reasoning, calls))
}

/// Generate a cheap unique-ish id (we don't pull in the uuid crate just for this).
fn uuid_like() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}", now % 1_000_000_000)
}

/// Split a content chunk that may contain inline `<think>...</think>` tags into
/// reasoning and content portions. Handles tags that span multiple chunks via
/// the `in_think_block` state flag.
///
/// Returns (reasoning_chunks, content_chunks).
fn split_think_tags(content: &str, in_think_block: &mut bool) -> (Vec<String>, Vec<String>) {
    let mut reasoning = Vec::new();
    let mut content_out = Vec::new();
    let mut remaining = content;

    loop {
        if *in_think_block {
            // Look for the closing </think> tag
            if let Some(end) = remaining.find("</think>") {
                reasoning.push(remaining[..end].to_string());
                remaining = &remaining[end + "</think>".len()..];
                *in_think_block = false;
                // Loop again to process the rest (may contain more <think> blocks)
            } else {
                // No closing tag yet — entire remaining chunk is reasoning
                reasoning.push(remaining.to_string());
                break;
            }
        } else {
            // Look for an opening <think> tag
            if let Some(start) = remaining.find("<think>") {
                if start > 0 {
                    content_out.push(remaining[..start].to_string());
                }
                remaining = &remaining[start + "<think>".len()..];
                *in_think_block = true;
                // Loop again to process the rest
            } else {
                // No opening tag — entire remaining chunk is content
                content_out.push(remaining.to_string());
                break;
            }
        }
    }

    (reasoning, content_out)
}

#[cfg(test)]
mod tests {
    use super::split_think_tags;

    #[test]
    fn split_think_tags_no_tags() {
        let mut in_block = false;
        let (r, c) = split_think_tags("hello world", &mut in_block);
        assert!(r.is_empty(), "no reasoning expected, got {:?}", r);
        assert_eq!(c, vec!["hello world".to_string()]);
        assert!(!in_block);
    }

    #[test]
    fn split_think_tags_complete_block() {
        let mut in_block = false;
        let (r, c) = split_think_tags("<think>secret</think>answer", &mut in_block);
        assert_eq!(r, vec!["secret".to_string()]);
        // Empty content before <think> is filtered (start == 0)
        assert_eq!(c, vec!["answer".to_string()]);
        assert!(!in_block);
    }

    #[test]
    fn split_think_tags_open_block_no_close() {
        let mut in_block = false;
        let (r, c) = split_think_tags("pre <think>reasoning continues", &mut in_block);
        assert_eq!(r, vec!["reasoning continues".to_string()]);
        assert_eq!(c, vec!["pre ".to_string()]);
        assert!(in_block);
    }

    #[test]
    fn split_think_tags_continuation_then_close() {
        let mut in_block = true;
        let (r, c) = split_think_tags(" more reasoning</think>final answer", &mut in_block);
        assert_eq!(r, vec![" more reasoning".to_string()]);
        assert_eq!(c, vec!["final answer".to_string()]);
        assert!(!in_block);
    }

    #[test]
    fn split_think_tags_multiple_blocks() {
        let mut in_block = false;
        let (r, c) = split_think_tags("<think>a</think>mid<think>b</think>end", &mut in_block);
        assert_eq!(r, vec!["a".to_string(), "b".to_string()]);
        // Empty content chunks before each <think> at position 0 are filtered
        assert_eq!(c, vec!["mid".to_string(), "end".to_string()]);
        assert!(!in_block);
    }

    #[test]
    fn is_mmproj_filename_detects_both_conventions() {
        use super::is_mmproj_filename;
        assert!(is_mmproj_filename("mmproj-fuyu.gguf"));
        assert!(is_mmproj_filename("MMPROJ-model.gguf"));
        assert!(is_mmproj_filename("Ternary-Bonsai-27B-mmproj-Q8_0.gguf"));
        assert!(is_mmproj_filename("Some-Model-MMProj-Q8.gguf"));
        assert!(!is_mmproj_filename("bonsai-27b.gguf"));
        assert!(!is_mmproj_filename("Ternary-Bonsai-27B-Q4_1.gguf"));
        assert!(!is_mmproj_filename("regular.gguf"));
    }
}

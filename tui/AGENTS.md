# DOX framework — TUI (Terminal UI)

## Purpose

Rust-based terminal user interface (ratatui + crossterm + tui-textarea) for chat and model management. Connects to the desktop API gateway (default: `http://127.0.0.1:13439`) which routes intelligently across llama-server slots. Supports streaming chat via SSE, slash commands, multi-line input, and scrollback history.

Inspired by the Claude Code CLI architecture (streaming responses, slash commands, status bar, workspace context).

## Ownership

All Rust source files in this directory are owned by the `alpaca-tui` crate.

## Local Contracts

- **Binary name:** `alpaca-tui` (built via `cargo build --release`)
- **Binary discovery:** The desktop main process finds the binary at `tui/target/release/alpaca-tui[.exe]` (dev) or `resources/tui/alpaca-tui[.exe]` (packaged, unpacked from asar)
- **Control API:** Connects to `--control` URL (default: `http://127.0.0.1:13439` — the desktop API gateway). Uses OpenAI-compatible endpoints only:
  - `GET /v1/models` — list available models
  - `POST /v1/chat/completions` (with `stream: true`) — streaming chat via SSE
- **Workspace:** Optional `--workspace <DIR>` CLI arg; if not provided, shows a workspace selection step at startup. The selected folder is persisted to `~/.config/alpaca-tui/config.json` (or `%APPDATA%\alpaca-tui\config.json` on Windows)
- **Config skip:** `--no-workspace` skips the workspace selection step
- **System prompt:** Optional `--system-prompt <TEXT>` CLI arg; can also be set at runtime via `/system` command

## Port Allocation

The desktop app reserves ports 13434-13440:

| Port | Service | Purpose |
|------|---------|---------|
| 13434 | llama-server slot 0 (primary) | OpenAI-compatible chat, /v1/models, /props |
| 13435 | llama-server slot 1 (secondary) | Secondary chat model |
| 13436 | llama-server slot 2 (vision) | Vision-capable model |
| 13437 | llama-server slot 3 (embedding) | Embedding model for RAG |
| 13438 | llama-server slot 4 (coding) | Coding-optimized model |
| 13439 | API Gateway | Unified HTTP/SSE proxy, image generation |
| 13440 | MOSS-TTS | Text-to-speech |

The TUI defaults to port **13439** (API Gateway) which routes across all slots. To connect directly to the primary slot, pass `--control http://127.0.0.1:13434`. For bonsai-beach compatibility, pass `--control http://127.0.0.1:15450`.

## Work Guidance

### CLI Arguments

| Arg | Default | Purpose |
|-----|---------|---------|
| `--control <URL>` | `http://127.0.0.1:13439` | Control API URL (desktop API gateway) |
| `--model <ID>` | `bonsai-27b` | Default model ID for chat |
| `--workspace <DIR>` | (none) | Workspace folder for file context; skips selection step |
| `--no-workspace` | (false) | Skip workspace selection step entirely |
| `--system-prompt <TEXT>` | (none) | System prompt prepended to every conversation |

### Workspace Selection Step

When launched without `--workspace` or `--no-workspace`, the TUI shows a workspace selection screen with:
1. **Saved workspace** — the last-used folder (from config file), with a "Use Saved" button
2. **Recent directories** — common project directories (home/Projects, home/repos, home/code, home/src, home/workspace, home/Documents, cwd)
3. **Manual path input** — type a full path and press Enter
4. **Skip** — proceed without a workspace
5. **Quit** — exit the TUI

The selected workspace is persisted and restored on next launch. The desktop app can also pass the workspace via `--workspace` when launching from the tray menu.

### Tabs

1. **Models** (F1) — list models from /v1/models; `[↑/↓]` navigate, `[Enter]` select for chat
2. **Chat** (F2) — streaming chat interface with multi-line input, slash commands, scrollback
3. **Logs** (F3) — background poller status and model availability

### Chat Features

- **Multi-line input:** Uses `tui-textarea` for full text editing (cursor movement, selection, copy/paste)
- **Streaming responses:** SSE parsing of `/v1/chat/completions` with `stream: true`; tokens appear in real-time with a cursor indicator
- **Reasoning/thinking display:** The chat request includes `reasoning_format: "auto"` so the server extracts thinking into a separate `reasoning_content` field. Reasoning chunks are rendered in a dimmed, italic `┌─ Thinking ─┐` block above the final answer. As a fallback for servers that don't honor `reasoning_format`, inline `<think>...</think>` tags in the content stream are split out via `split_think_tags()` (stateful, handles tags spanning multiple SSE chunks)
- **Built-in tools (agentic loop):** Every chat request includes the `tools` array with three built-in tools: `read_file` (read a workspace file, capped at 32 KB), `list_dir` (list directory contents), and `web_fetch` (HTTP GET, capped at 16 KB, HTML tags stripped). When the model returns `tool_calls`, the TUI executes them locally via `execute_tool_call()` and sends the results back in a follow-up request, looping up to 8 iterations (`MAX_TOOL_ITERATIONS`) until the model produces a final answer with no tool calls. Tool calls and results are rendered inline as dimmed system messages via `AppEvent::ToolCallStart` / `AppEvent::ToolCallResult`. Tool definitions are built by `builtin_tool_definitions()`; the streaming turn is handled by `stream_one_turn()` which accumulates tool-call deltas by index.
- **Slash commands:** Type `/` followed by a command name (see below)
- **Scrollback:** `PageUp`/`PageDown` to scroll through conversation history
- **System prompt:** Prepended to every conversation; set via `--system-prompt` or `/system` command
- **mmproj filtering:** `fetch_models()` filters out vision projector files via `is_mmproj_filename()`, which matches both naming conventions: `mmproj-*` (standard llama.cpp) and `*-mmproj-*` (Bonsai convention, e.g. `Ternary-Bonsai-27B-mmproj-Q8_0.gguf`)

### Slash Commands

| Command | Action |
|---------|--------|
| `/help`, `/?` | Show available commands |
| `/clear` | Clear conversation history |
| `/model <id>` | Switch model (e.g. `/model bonsai-27b`) |
| `/models` | List available models |
| `/status` | Show connection and session status |
| `/system <prompt>` | Set system prompt |
| `/system clear` | Clear system prompt |
| `/workspace` | Show current workspace |
| `/quit`, `/exit` | Quit the TUI |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F1`/`F2`/`F3` | Switch tabs (Models/Chat/Logs) |
| `Tab`/`BackTab` | Cycle tabs |
| `Ctrl+C` | Quit (global, works on all tabs) |
| `↑`/`↓` | Navigate model list (Models tab) |
| `Enter` | Send chat message (Chat tab) |
| `Shift+Enter` | Insert newline (Chat tab) |
| `PageUp`/`PageDown` | Scroll chat history (Chat tab) |

**Note:** The `q` key is NOT a global quit shortcut (it was removed because it prevented typing 'q' in chat messages). Use `Ctrl+C` to quit, or `/quit` in the chat input.

### Desktop Integration

The desktop app launches the TUI via `launchTui()` in `main.js`:
- Finds the binary via `findTuiBinary()` (packaged → dev build)
- Spawns in a new terminal window (cmd.exe on Windows, Terminal.app on macOS, gnome-terminal/xterm on Linux)
- Passes `--control http://127.0.0.1:13439` (API gateway) by default
- Passes `--workspace` if a workspace folder is configured (TUI-specific setting, falls back to main workspace)
- Tray menu: "Open Terminal UI" item
- Providers settings UI: Terminal UI card with binary status, workspace folder picker, and launch button

### Build

```bash
cd tui && cargo build --release
# Binary: tui/target/release/alpaca-tui[.exe]
```

Or via Makefile: `make build-tui`

### Dependencies

| Crate | Purpose |
|-------|---------|
| `ratatui` | Terminal UI framework |
| `crossterm` | Terminal input/output (with `event-stream` feature) |
| `tui-textarea` | Multi-line text editor widget for chat input |
| `tokio` | Async runtime (full features) |
| `reqwest` | HTTP client (with `json` and `stream` features for SSE) |
| `futures-util` | Stream utilities for SSE parsing |
| `clap` | CLI argument parsing |
| `serde` / `serde_json` | JSON serialization |
| `unicode-width` | Unicode character width for text rendering |

## Endpoints

The TUI uses only OpenAI-compatible endpoints:

| Feature | Endpoint | Method |
|---------|----------|--------|
| Chat (streaming) | `/v1/chat/completions` | POST (SSE, `stream: true`, `tools` array with built-in tools) |
| Models list | `/v1/models` | GET |

The `--control` CLI flag overrides the default URL.

## Verification

- `cargo build --release` — compiles without errors or warnings
- `cargo test` — runs inline unit tests (`split_think_tags`, `is_mmproj_filename`)
- `cargo clippy` — no clippy warnings
- Manual: launch with `./target/release/alpaca-tui --control http://127.0.0.1:13439`

## Child DOX Index

This directory is flat; no child AGENTS.md files needed.

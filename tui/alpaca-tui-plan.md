# alpaca-tui — Comprehensive Coding CLI Plan

> **Status:** Planning document — tracks development phases for evolving `alpaca-tui` from a basic chat TUI into a comprehensive, Claude Code-style coding CLI with a full agent/skills/tool stack.
>
> **Owners:** `alpaca-tui` crate (Rust). Lives at `alpaca-bonsai/tui/`.
> **Last updated:** 2026-07-20

---

## 1. Executive Summary

The goal is to transform `alpaca-tui` from its current state (a streaming chat client with slash commands, multi-line input, and scrollback) into a **terminal-native AI coding agent** comparable to Claude Code, with:

- A **tool-calling loop** that lets the model read/write files, run shell commands, search the codebase, and spawn sub-agents
- A **slash-command system** (~30+ commands) for session control, git workflows, context management, and configuration
- A **skills system** with progressive disclosure (metadata → full content → supporting files) and a self-learning curator loop
- A **token-efficiency stack** (keystone-protected pruning, string interning, content-aware routing, LRU caching) to keep context lean
- An **ACP (Agent Communication Protocol) adapter** so the TUI can be driven by external clients (IDEs, other agents)
- A **research mode** inspired by `autoresearch`'s branch-based experimentation loop
- A **plugin/registry architecture** for discovering tools, skills, and agents from bundled, user, and project sources

The plan is organized into **7 phases**, each producing a shippable increment. Phases are ordered so each builds on the previous one and can be verified independently.

---

## 2. Reference Projects & What We Take From Each

| Project | Language | What we adopt | Key files / patterns |
|---|---|---|---|
| **claude-leaked-code** | TypeScript (React + Ink) | Tool trait, query loop, slash commands, system prompt construction, MCP integration, permission prompts, session compaction | `src/Tool.ts`, `src/tools.ts`, `src/commands.ts`, `src/QueryEngine.ts`, `src/query.ts`, `src/services/tools/toolOrchestration.ts`, `src/utils/systemPrompt.ts`, `src/context.ts`, `src/services/mcp/client.ts` |
| **claude-code** | (mirror of leak) | Same as above — used as secondary reference for the README/blog commentary | `README.md` |
| **hermes-agent** | Python | Skills system (YAML frontmatter + progressive disclosure), tool registry with `check_fn` gating, sub-agent delegation (leaf/orchestrator roles), self-learning curator, ACP adapter, plugin discovery from 4 sources, MEMORY.md/USER.md pattern, SQLite session store with FTS5 | `tools/registry.py`, `tools/skills_tool.py`, `tools/delegate_tool.py`, `agent/curator.py`, `agent/memory_manager.py`, `acp_adapter/server.py`, `hermes_cli/plugins.py`, `hermes_state.py` |
| **headroom** | Python + Rust (PyO3) | Content-aware compression routing, SmartCrusher (JSON array dedup), CodeCompressor (tree-sitter AST), Kompress (ML compression — optional), CacheAligner (volatile content detection), CCR (reversible compression with retrieval tool), compression policy with cache-cost multipliers | `headroom/compress.py`, `headroom/transforms/content_router.py`, `headroom/transforms/smart_crusher.py`, `headroom/transforms/code_compressor.py`, `headroom/transforms/cache_aligner.py`, `headroom/ccr/__init__.py` |
| **jcodemunch-mcp** | Python | Keystone-protected entropy pruning, schema-driven (MUNCH) encoding with string interning, tool-surface consolidation (3-tool "Counter" front door), parse cache (SQLite), result cache (LRU), token tracker with dollar valuation, savings gate (15% threshold) | `src/jcodemunch_mcp/retrieval/entropy_prune.py`, `src/jcodemunch_mcp/encoding/schema_driven.py`, `src/jcodemunch_mcp/counter.py`, `src/jcodemunch_mcp/parser/parse_cache.py`, `src/jcodemunch_mcp/storage/token_tracker.py` |
| **autoresearch** | Python | Branch-based experiment isolation, fixed-time-budget experiments, TSV/JSONL append-only logging, metric-driven keep/discard decisions, simplicity-aware evaluation, skill-as-markdown-file pattern (`program.md`) | `program.md`, `train.py`, `prepare.py`, `analysis.ipynb` |

---

## 3. Target Architecture

```
alpaca-tui/
├── Cargo.toml
├── src/
│   ├── main.rs                    # Entry point, CLI parsing, terminal setup
│   ├── app.rs                     # Top-level App state, tab routing, event loop
│   ├── cli.rs                     # clap argument definitions
│   ├── config.rs                  # TuiConfig load/save (replaces inline TuiConfig)
│   │
│   ├── tool/                      # ── Tool system (Phase 2) ──
│   │   ├── mod.rs                 # Tool trait, ToolRegistry, ToolResult, Permission
│   │   ├── context.rs             # ToolUseContext (workspace, mcp_clients, hooks)
│   │   ├── orchestration.rs       # run_tools(), partition concurrent/serial
│   │   ├── execution.rs           # run_tool_use() — validate → permit → execute → hook
│   │   └── tools/
│   │       ├── mod.rs             # register_builtin_tools()
│   │       ├── file_read.rs       # FileReadTool (offset/limit, image/PDF/notebook)
│   │       ├── file_write.rs      # FileWriteTool (create/overwrite, git diff)
│   │       ├── file_edit.rs       # FileEditTool (old_string/new_string, replace_all)
│   │       ├── notebook_edit.rs   # NotebookEditTool (.ipynb cell replace/insert/delete)
│   │       ├── glob.rs            # GlobTool (pattern match, 100-file limit)
│   │       ├── grep.rs            # GrepTool (ripgrep wrapper, context lines, modes)
│   │       ├── bash.rs            # BashTool (shell exec, timeout, destructive warnings)
│   │       ├── agent.rs           # AgentTool (spawn sub-agents: explore/plan/verify)
│   │       ├── web_fetch.rs       # WebFetchTool (URL → markdown, 100KB cap)
│   │       ├── web_search.rs      # WebSearchTool (search API, domain allow/block)
│   │       ├── todo_write.rs      # TodoWriteTool (structured task list)
│   │       ├── ask_user.rs        # AskUserQuestionTool (in-TUI multiple choice)
│   │       ├── skill.rs           # SkillTool (invoke discovered skills)
│   │       └── mcp.rs             # MCPTool (wrap external MCP server tools)
│   │
│   ├── command/                   # ── Slash commands (Phase 3) ──
│   │   ├── mod.rs                 # Command enum, CommandRegistry, dispatch
│   │   ├── prompt.rs              # PromptCommand type (model-side commands)
│   │   ├── local.rs               # LocalCommand type (client-side commands)
│   │   └── commands/
│   │       ├── mod.rs             # register_builtin_commands()
│   │       ├── help.rs            # /help, /?
│   │       ├── clear.rs           # /clear
│   │       ├── compact.rs         # /compact (conversation summarization)
│   │       ├── model.rs           # /model, /models
│   │       ├── status.rs          # /status
│   │       ├── system.rs          # /system, /system clear
│   │       ├── workspace.rs       # /workspace, /add-dir
│   │       ├── quit.rs            # /quit, /exit
│   │       ├── commit.rs          # /commit (git commit with generated message)
│   │       ├── diff.rs            # /diff (show uncommitted changes)
│   │       ├── review.rs          # /review (code review of changes)
│   │       ├── cost.rs            # /cost (token/cost tracking)
│   │       ├── doctor.rs          # /doctor (diagnostics)
│   │       ├── skills.rs          # /skills (list/manage skills)
│   │       ├── memory.rs          # /memory (MEMORY.md/USER.md management)
│   │       ├── mcp.rs             # /mcp (MCP server management)
│   │       ├── config.rs          # /config (view/edit settings)
│   │       ├── plan.rs            # /plan (enter/exit plan mode)
│   │       ├── resume.rs          # /resume (resume session)
│   │       ├── export.rs          # /export (export conversation)
│   │       ├── theme.rs           # /theme (color theme)
│   │       ├── vim.rs             # /vim (vim input mode toggle)
│   │       ├── research.rs        # /research (autoresearch-style experiment loop)
│   │       └── version.rs         # /version
│   │
│   ├── query/                     # ── Query engine (Phase 2) ──
│   │   ├── mod.rs                 # QueryEngine, submit_message() async stream
│   │   ├── loop.rs                # Main query loop (stream → extract tools → execute → feed back)
│   │   ├── streaming.rs           # SSE parsing for /v1/chat/completions
│   │   ├── tool_call_parser.rs    # Extract tool_use blocks from model output
│   │   └── budget.rs              # Token budget tracking, auto-compact trigger
│   │
│   ├── prompt/                    # ── System prompt construction (Phase 2) ──
│   │   ├── mod.rs                 # SystemPromptBuilder
│   │   ├── context.rs             # get_user_context(), get_system_context()
│   │   ├── git_status.rs          # get_git_status() — branch, status, recent log
│   │   ├── memory_files.rs        # Load AGENTS.md / CLAUDE.md / MEMORY.md
│   │   └── workspace_tree.rs      # Lightweight file tree summary
│   │
│   ├── session/                   # ── Session & state (Phase 3) ──
│   │   ├── mod.rs                 # SessionManager
│   │   ├── store.rs               # SQLite store (sessions, messages, FTS5 search)
│   │   ├── transcript.rs          # JSONL transcript recording
│   │   └── compact.rs             # Conversation compaction (microcompact + summary)
│   │
│   ├── skills/                    # ── Skills system (Phase 4) ──
│   │   ├── mod.rs                 # SkillRegistry, SkillMetadata
│   │   ├── discovery.rs           # Scan dirs, parse YAML frontmatter, exclude patterns
│   │   ├── loader.rs              # Progressive disclosure (list → view → references)
│   │   ├── usage.rs               # Usage tracking (.usage.json)
│   │   └── curator.rs             # Background skill maintenance (stale/archive/consolidate)
│   │
│   ├── agent/                     # ── Sub-agent orchestration (Phase 4) ──
│   │   ├── mod.rs                 # Agent, AgentConfig, AgentRole (Leaf/Orchestrator)
│   │   ├── delegate.rs            # DelegateTool implementation, blocked-tools list
│   │   ├── coordinator.rs         # Multi-agent coordination, active subagent tracking
│   │   └── memory.rs              # MemoryManager, MEMORY.md/USER.md pattern
│   │
│   ├── compress/                  # ── Token efficiency (Phase 5) ──
│   │   ├── mod.rs                 # CompressConfig, compress() entry point
│   │   ├── router.rs              # Content-type detection → route to compressor
│   │   ├── keystone.rs            # Keystone-protected entropy pruning (jcodemunch)
│   │   ├── smart_crusher.rs       # JSON array dedup + change-point preservation
│   │   ├── code_compress.rs       # tree-sitter AST-based code compression
│   │   ├── interning.rs           # String interning (@N references, MUNCH format)
│   │   ├── cache_aligner.rs       # Detect volatile content (UUIDs, timestamps, JWTs)
│   │   ├── ccr.rs                 # Reversible compression with retrieval tool
│   │   ├── policy.rs              # Compression policy (PAYG vs Subscription, cache costs)
│   │   └── token_estimate.rs      # Fast char-based token estimation (~90% accuracy)
│   │
│   ├── mcp/                       # ── MCP integration (Phase 6) ──
│   │   ├── mod.rs                 # McpClient, ConnectedMcpServer, FailedMcpServer
│   │   ├── transport.rs           # Stdio/SSE/HTTP/WebSocket transports
│   │   ├── types.rs               # McpServerConfig variants, ServerCapabilities
│   │   └── resource.rs            # List/read MCP resources
│   │
│   ├── acp/                       # ── ACP adapter (Phase 6) ──
│   │   ├── mod.rs                 # AcpServer (exposes TUI as ACP server)
│   │   ├── session.rs             # ACP session management
│   │   ├── schema.rs              # ACP request/response types
│   │   └── auth.rs                # ACP authentication methods
│   │
│   ├── research/                  # ── Research mode (Phase 7) ──
│   │   ├── mod.rs                 # ResearchLoop, ResearchState
│   │   ├── experiment.rs          # Experiment execution with time budget
│   │   ├── metrics.rs             # Metric trait, keep/discard decisions
│   │   ├── log.rs                 # TSV/JSONL append-only experiment log
│   │   └── report.rs              # Markdown report generation
│   │
│   ├── plugin/                    # ── Plugin discovery (Phase 4) ──
│   │   ├── mod.rs                 # PluginManager, LoadedPlugin
│   │   ├── discovery.rs           # Scan bundled/user/project/entry-point sources
│   │   └── hooks.rs               # Hook system (pre/post tool use, etc.)
│   │
│   ├── permissions/               # ── Permission system (Phase 2) ──
│   │   ├── mod.rs                 # PermissionMode, PermissionResult, CanUseToolFn
│   │   ├── matcher.rs             # Path/command matchers for permission rules
│   │   └── rules.rs               # Default allow/deny rules, persistent grants
│   │
│   ├── tui/                       # ── TUI rendering (ongoing, all phases) ──
│   │   ├── mod.rs                 # Terminal setup, draw loop
│   │   ├── repl.rs                # REPL screen (messages + input + permissions)
│   │   ├── chat_view.rs           # Chat history rendering with scrollback
│   │   ├── input.rs               # tui-textarea wrapper, vim mode
│   │   ├── status_bar.rs          # Model/endpoint/workspace/token status
│   │   ├── tabs.rs                # Models/Chat/Logs/Skills/Research tabs
│   │   ├── permission_prompt.rs   # In-TUI permission request rendering
│   │   ├── todo_view.rs           # Todo list rendering
│   │   ├── diff_view.rs           # Git diff rendering
│   │   └── theme.rs               # Color themes
│   │
│   └── workspace/                 # ── Workspace context (Phase 2) ──
│       ├── mod.rs                 # WorkspaceManager
│       ├── file_tree.rs           # Cached file tree (gitignore-aware)
│       └── git.rs                 # Git operations (status, branch, commit, diff)
```

---

## 4. Port & Endpoint Map

The TUI connects to the desktop's API gateway and may spawn additional services:

| Port | Service | Used by TUI? | Purpose |
|---|---|---|---|
| 13434 | llama-server slot 0 (primary) | Fallback | Direct primary-slot chat |
| 13435–13438 | llama-server slots 1–4 | Via gateway | Secondary/vision/embedding/coding slots |
| 13439 | API Gateway | **Yes (default)** | Unified HTTP/SSE proxy, image generation |
| 13440 | MOSS-TTS | Optional | Text-to-speech for voice output |
| 15450 | bonsai-beach | Optional (`--control`) | Legacy bonsai-beach control API |
| 13441–13450 | ACP server (planned) | **Yes (Phase 6)** | ACP adapter for IDE/external clients |
| 13451–13460 | MCP stdio pipes | **Yes (Phase 6)** | MCP server child processes (stdio, not TCP) |

**Default control URL:** `http://127.0.0.1:13439` (API Gateway) — routes across all slots.

---

## 5. Development Phases

### Phase 1: Foundation Refactor ✅ (Complete)

**Goal:** Fix the broken chat input, add streaming, slash commands, scrollback, status bar.

**Delivered:**
- [x] Streaming chat via SSE `/v1/chat/completions`
- [x] Multi-line input via `tui-textarea`
- [x] Slash commands: `/help`, `/clear`, `/model`, `/models`, `/status`, `/system`, `/workspace`, `/quit`
- [x] Scrollback with PageUp/PageDown
- [x] Status bar (model, endpoint, workspace, streaming state, token usage)
- [x] System prompt support (`--system-prompt` and `/system`)
- [x] Default control URL → port 13439 (API Gateway)
- [x] Workspace selection step with persistence

**Files:** `tui/src/main.rs` (monolithic), `tui/Cargo.toml`, `tui/AGENTS.md`

---

### Phase 2: Tool System & Query Engine

**Goal:** Implement the core tool-calling loop so the model can read/write files, run commands, and search the codebase. This is the single most important phase — it turns the TUI from a chat client into a coding agent.

**Sub-tasks:**

- [ ] **2.1 Tool trait & registry** (`src/tool/`)
  - Define `Tool` trait with: `name()`, `call()`, `description()`, `input_schema()`, `is_read_only()`, `is_destructive()`, `check_permissions()`, `is_concurrency_safe()`
  - `ToolRegistry` with `register()`, `get()`, `get_definitions()` (returns OpenAI tool schemas)
  - `ToolUseContext` struct (workspace path, mcp_clients, hooks, read_file_state)
  - `ToolResult<T>` with structured output + max_result_size_chars truncation
  - **Reference:** `claude-leaked-code/src/Tool.ts` (lines 362-560), `hermes-agent/tools/registry.py`

- [ ] **2.2 Built-in tools** (`src/tool/tools/`)
  - `FileReadTool` — `{ file_path, offset?, limit? }` → content with line numbers, image/PDF/notebook support
  - `FileWriteTool` — `{ file_path, content }` → create/overwrite with git diff generation
  - `FileEditTool` — `{ file_path, old_string, new_string, replace_all? }` → in-place edit with uniqueness check
  - `GlobTool` — `{ pattern, path? }` → matched filenames (100-file limit)
  - `GrepTool` — `{ pattern, path?, glob?, output_mode?, -A/-B/-C?, -i?, type? }` → ripgrep wrapper
  - `BashTool` — `{ command, timeout? }` → shell exec with destructive-command warnings
  - `TodoWriteTool` — `{ todos: [{ content, status }] }` → structured task list
  - `AskUserQuestionTool` — `{ questions: [{ question, options }] }` → in-TUI multiple choice
  - `AgentTool` — `{ agent, input }` → spawn sub-agent (explore/plan/verify/general)
  - `WebFetchTool` — `{ url, prompt }` → fetch + markdown extraction (100KB cap)
  - `WebSearchTool` — `{ query, allowed_domains?, blocked_domains? }` → web search
  - `NotebookEditTool` — `{ notebook_path, cell_number, new_source, edit_mode }` → .ipynb editing
  - **Reference:** `claude-leaked-code/src/tools/` (all tool subdirs)

- [ ] **2.3 Query engine** (`src/query/`)
  - `QueryEngine` with `submit_message()` returning an async stream of events
  - Main loop: build request → stream from API → extract tool_use blocks → execute tools → feed results back → repeat until `end_turn`
  - SSE parsing (reuse existing streaming logic from Phase 1)
  - `tool_call_parser.rs` — extract tool calls from both native tool_use and text-based tool calls (for models without native tool calling)
  - `budget.rs` — track token usage, trigger auto-compact at threshold
  - **Reference:** `claude-leaked-code/src/QueryEngine.ts`, `src/query.ts`, `src/services/tools/toolOrchestration.ts`

- [ ] **2.4 Tool orchestration** (`src/tool/orchestration.rs`, `execution.rs`)
  - `run_tools()` — partition tool calls into concurrency-safe and serial batches
  - `run_tool_use()` — single tool execution: find → parse → validate → permit → pre-hooks → execute → post-hooks → yield result
  - Concurrent execution via `tokio::join!` for concurrency-safe tools
  - **Reference:** `claude-leaked-code/src/services/tools/toolOrchestration.ts`, `toolExecution.ts`

- [ ] **2.5 Permission system** (`src/permissions/`)
  - `PermissionMode`: `Default` (ask for destructive), `Plan` (read-only), `AutoApprove` (yolo), `AskAlways`
  - `PermissionResult`: `Allow`, `Deny`, `AllowAll` (persistent grant for session)
  - In-TUI permission prompt rendering with tool-specific messages
  - Path/command matchers for rule-based permissions
  - **Reference:** `claude-leaked-code/src/components/permissions/PermissionRequest.tsx`

- [ ] **2.6 System prompt construction** (`src/prompt/`)
  - `SystemPromptBuilder` — assemble default prompt + custom + append + override
  - `get_system_context()` — git status (branch, status --short, log --oneline -n 5)
  - `get_user_context()` — AGENTS.md/CLAUDE.md/MEMORY.md content, current date
  - `workspace_tree.rs` — lightweight file tree summary (gitignore-aware, depth-limited)
  - **Reference:** `claude-leaked-code/src/utils/systemPrompt.ts`, `src/context.ts`

- [ ] **2.7 Workspace manager** (`src/workspace/`)
  - `WorkspaceManager` — folder selection, file tree caching
  - `git.rs` — git operations (status, branch, commit, diff, log)
  - File tree with gitignore respect (use `ignore` crate)
  - **Reference:** `alpaca-bonsai/desktop/workspace-manager.js`

- [ ] **2.8 TUI integration**
  - Update REPL to render tool-use messages, tool results, and permission prompts
  - Add tool execution status indicators (spinner while running)
  - Render todo list from TodoWriteTool output
  - **Reference:** `claude-leaked-code/src/screens/REPL.tsx`

**Verification:**
- `cargo build --release` compiles
- Manual: launch TUI, ask "read the file X and summarize it" → model calls FileReadTool → result appears
- Manual: ask "create a file called hello.txt with content 'hi'" → permission prompt → file created
- Manual: ask "search for all uses of function foo" → model calls GrepTool → results shown

**Dependencies to add:** `tree-sitter`, `ignore` (gitignore), `glob` crate, `regex`, `sha2`, `git2` (or shell out to git)

---

### Phase 3: Slash Commands & Session Management

**Goal:** Expand the slash command system to ~30 commands and add persistent sessions with compaction.

**Sub-tasks:**

- [ ] **3.1 Command registry** (`src/command/`)
  - `Command` enum: `Prompt` (model-side), `Local` (client-side)
  - `CommandRegistry` with `register()`, `get()`, `list()`
  - Support aliases, hidden commands, enabled-check
  - **Reference:** `claude-leaked-code/src/commands.ts`, `src/types/command.ts`

- [ ] **3.2 Built-in commands** (`src/command/commands/`)
  - Session: `/clear`, `/compact`, `/resume`, `/export`, `/cost`
  - Model: `/model`, `/models`, `/status`
  - System: `/system`, `/system clear`
  - Workspace: `/workspace`, `/add-dir`
  - Git: `/commit`, `/diff`, `/review`, `/branch`
  - Config: `/config`, `/theme`, `/vim`, `/doctor`, `/version`
  - Skills: `/skills`, `/memory`, `/mcp`
  - Mode: `/plan`, `/research`
  - Help: `/help`, `/quit`, `/exit`
  - **Reference:** `claude-leaked-code/src/commands/` (50+ commands)

- [ ] **3.3 Session manager** (`src/session/`)
  - `SessionManager` — create/load/fork sessions
  - SQLite store (`~/.config/alpaca-tui/sessions.db`) with FTS5 for message search
  - JSONL transcript recording (one file per session)
  - Session resume: load prior messages, restore context
  - **Reference:** `hermes-agent/hermes_state.py` (SQLite + FTS5)

- [ ] **3.4 Conversation compaction** (`src/session/compact.rs`)
  - `/compact` command — summarize conversation to reduce token count
  - Microcompact: truncate verbose tool outputs
  - Full compact: ask model to summarize conversation, replace history with summary
  - Auto-compact: trigger when token budget exceeds threshold
  - **Reference:** `claude-leaked-code/src/commands/compact/compact.ts`

- [ ] **3.5 Cost tracking** (`src/command/commands/cost.rs`)
  - Track token usage per session (prompt + completion)
  - Dollar valuation using model-specific pricing
  - `/cost` command shows running total
  - **Reference:** `jcodemunch-mcp/src/jcodemunch_mcp/storage/token_tracker.py`

**Verification:**
- `/compact` reduces message count and token usage
- `/resume` restores a prior session
- `/commit` generates a commit message and commits
- `/cost` shows accurate token totals

**Dependencies to add:** `rusqlite` (SQLite with FTS5), `chrono`

---

### Phase 4: Skills, Sub-Agents & Plugins

**Goal:** Add a skills system with progressive disclosure, sub-agent delegation, a self-learning curator, and plugin discovery.

**Sub-tasks:**

- [ ] **4.1 Skills system** (`src/skills/`)
  - `SkillMetadata` struct: name, description, category, version, platforms, tags, related_skills
  - YAML frontmatter parsing from `SKILL.md` files
  - `SkillRegistry::discover()` — scan `~/.config/alpaca-tui/skills/`, `./.alpaca/skills/`, bundled skills
  - Exclude patterns: `.git`, `node_modules`, `__pycache__`, `.venv`, etc.
  - Progressive disclosure: `list_skills()` → metadata only; `view_skill(name)` → full content; `view_skill(name, file_path)` → supporting files
  - **Reference:** `hermes-agent/tools/skills_tool.py`, `agent/skill_utils.py`

- [ ] **4.2 SkillTool** (`src/tool/tools/skill.rs`)
  - Expose skills to the model via `SkillTool`
  - Model can list, view, and invoke skills
  - Skill invocation = inject skill content into context, then continue conversation
  - **Reference:** `claude-leaked-code/src/tools/SkillTool/`

- [ ] **4.3 Usage tracking & curator** (`src/skills/usage.rs`, `curator.rs`)
  - Track skill usage in `.usage.json` (use_count, last_used_at, state, pinned)
  - Background curator: mark stale (30 days), archive (90 days), optionally consolidate
  - Learning graph: skill nodes + edges (related_skills)
  - **Reference:** `hermes-agent/agent/curator.py`, `agent/learning_graph.py`, `tools/skill_usage.py`

- [ ] **4.4 Sub-agent delegation** (`src/agent/`)
  - `AgentRole`: `Leaf` (no delegation) and `Orchestrator` (can spawn workers)
  - `AgentConfig`: model, max_iterations, toolsets, role, parent_session_id
  - Blocked tools for sub-agents: `delegate_task`, `ask_user`, `memory`, `cronjob` (no recursive delegation, no user interaction, no shared memory writes)
  - Max depth: 1 (parent → child); max concurrent children: 3
  - Active subagent tracking for TUI observability
  - **Reference:** `hermes-agent/tools/delegate_tool.py`, `claude-leaked-code/src/tools/AgentTool/`

- [ ] **4.5 Memory manager** (`src/agent/memory.rs`)
  - `MEMORY.md` — agent's persistent memory (facts, preferences, patterns)
  - `USER.md` — user profile (name, preferences, working style)
  - `MemoryManager` — prefetch relevant memory before turns, sync after turns
  - `/memory` command — append, search, summarize, clear
  - **Reference:** `hermes-agent/agent/memory_manager.py`, `tools/memory_tool.py`

- [ ] **4.6 Plugin discovery** (`src/plugin/`)
  - `PluginManager::discover()` — scan 4 sources:
    1. Bundled plugins (`tui/plugins/`)
    2. User plugins (`~/.config/alpaca-tui/plugins/`)
    3. Project plugins (`./.alpaca/plugins/`)
    4. (No pip entry-points in Rust — instead, support WASM plugins via `wasmtime` in a future phase)
  - Plugin manifest format (TOML or JSON)
  - Hook system: pre/post tool use, pre/post message, on session start/end
  - **Reference:** `hermes-agent/hermes_cli/plugins.py`

- [ ] **4.7 Built-in skills** (bundled `SKILL.md` files)
  - `code-review` — review uncommitted changes
  - `git-workflow` — branch, commit, PR creation
  - `debug` — systematic debugging workflow
  - `refactor` — code refactoring patterns
  - `test-gen` — generate tests for a file
  - `explain` — explain a file or codebase
  - `research` — autoresearch-style experiment loop (Phase 7)
  - **Reference:** `hermes-agent/skills/`, `hermes-agent/optional-skills/`

**Verification:**
- `/skills` lists discovered skills
- Model can invoke a skill via SkillTool
- Sub-agent spawned via AgentTool completes isolated task
- Curator runs on idle and archives stale skills
- Plugin from `~/.config/alpaca-tui/plugins/` is discovered and its hook fires

**Dependencies to add:** `yaml-rust2` (YAML frontmatter), `walkdir`

---

### Phase 5: Token Efficiency Stack

**Goal:** Implement content-aware compression to keep context lean and reduce token consumption by 60-95% on JSON/logs and 15-20% on code.

**Sub-tasks:**

- [ ] **5.1 Token estimator** (`src/compress/token_estimate.rs`)
  - Char-based estimate with format awareness (JSON, code, text)
  - ~90% accuracy vs real tokenizer
  - Fallback to API token counting when precision needed
  - **Reference:** `headroom/headroom/tokenizers/estimator.py`

- [ ] **5.2 Keystone-protected pruning** (`src/compress/keystone.rs`)
  - Always keep keystone lines: control flow (`return`, `raise`, `if`, `for`, `try`, `except`), signatures (`def`, `class`, `@decorator`), operators (`=>`, `->`, `==`), NL constraints (`must`, `never`, `always`)
  - Rank lines by Shannon entropy × length-weight
  - Elide low-signal lines with honest marker: `# … N low-signal line(s) elided …`
  - O(L) complexity
  - **Reference:** `jcodemunch-mcp/src/jcodemunch_mcp/retrieval/entropy_prune.py`

- [ ] **5.3 String interning** (`src/compress/interning.rs`)
  - Replace repeated strings (file paths, IDs) with `@N` references
  - Two-pass: build legend, then encode
  - Legend includes only strings used ≥2 times
  - **Reference:** `jcodemunch-mcp/src/jcodemunch_mcp/encoding/schema_driven.py`

- [ ] **5.4 SmartCrusher for JSON arrays** (`src/compress/smart_crusher.rs`)
  - Deduplicate identical items in JSON arrays
  - Preserve change points (first/last items, variance thresholds)
  - Configurable: min_items, max_items_after_crush, preserve_change_points
  - **Reference:** `headroom/headroom/transforms/smart_crusher.py`

- [ ] **5.5 Code compressor** (`src/compress/code_compress.rs`)
  - tree-sitter AST-based compression
  - Preserve imports, signatures, type annotations, error handlers
  - Compress function bodies while maintaining valid syntax
  - Supported languages: Rust, Python, JS/TS, Go, Java, C/C++
  - **Reference:** `headroom/headroom/transforms/code_compressor.py`

- [ ] **5.6 Content-aware router** (`src/compress/router.rs`)
  - Detect content type (JSON, code, search results, logs, text)
  - Route to optimal compressor
  - Handle mixed content by splitting and routing sections
  - **Reference:** `headroom/headroom/transforms/content_router.py`

- [ ] **5.7 Cache aligner** (`src/compress/cache_aligner.rs`)
  - Detect volatile content that breaks provider KV caches: UUIDs, ISO timestamps, JWTs, hex hashes
  - Emit warnings (detector-only, no rewriting)
  - **Reference:** `headroom/headroom/transforms/cache_aligner.py`

- [ ] **5.8 CCR (reversible compression)** (`src/compress/ccr.rs`)
  - Store originals locally, inject compressed version into context
  - Add `headroom_retrieve` tool so model can request full data if needed
  - ContextTracker tracks compressed content across turns
  - **Reference:** `headroom/headroom/ccr/__init__.py`

- [ ] **5.9 Compression policy** (`src/compress/policy.rs`)
  - Per-mode policy: PAYG (aggressive) vs Subscription (conservative)
  - Cache cost multipliers: write=1.25x, read=0.1x (Anthropic prompt caching)
  - `net_mutation_gain()` formula for cache-aware decisions
  - Config: min_tokens_to_compress=250, protect_recent=4, target_ratio
  - **Reference:** `headroom/headroom/transforms/compression_policy.py`

- [ ] **5.10 LRU cache** (`src/compress/mod.rs`)
  - Content-addressed cache (SHA256 → compressed version)
  - LRU eviction (max 10,000 entries)
  - Thread-safe with `RwLock`
  - Stable hash tracking (skip compression for content seen verbatim every turn)
  - **Reference:** `headroom/headroom/cache/compression_cache.py`

- [ ] **5.11 Tool surface consolidation** (optional, `src/tool/counter.rs`)
  - Reduce per-turn token tax by exposing a 3-tool front door: `order(action, args)`, `menu(query)`, `route(task)`
  - Safety gate: refuse exec/write verbs
  - **Reference:** `jcodemunch-mcp/src/jcodemunch_mcp/counter.py`

**Verification:**
- Large JSON tool output (1000 items) compressed to <15% original tokens
- Code file (500 lines) compressed with keystone pruning preserves all signatures
- Repeated file paths interned to `@0`, `@1`, etc.
- `/cost` shows 60%+ reduction in token usage with compression enabled

**Dependencies to add:** `tree-sitter` + language grammars, `sha2`, `lru` crate, `unicode-segmentation`

---

### Phase 6: MCP & ACP Integration

**Goal:** Integrate external MCP servers (tools/resources) and expose the TUI itself as an ACP server for IDE clients.

**Sub-tasks:**

- [ ] **6.1 MCP client** (`src/mcp/`)
  - `McpClient` with `connect()`, `call_tool()`, `read_resource()`
  - Transport types: Stdio (child process), SSE, HTTP, WebSocket
  - `ConnectedMcpServer` / `FailedMcpServer` states
  - Config in `~/.config/alpaca-tui/mcp.json` (server name → config)
  - **Reference:** `claude-leaked-code/src/services/mcp/client.ts`, `types.ts`

- [ ] **6.2 MCP tool wrapper** (`src/tool/tools/mcp.rs`)
  - Wrap each MCP server tool as a `Tool` trait impl
  - `MCPTool { server_name, tool_name, input_schema, description }`
  - Route `call()` to the appropriate `McpClient`
  - **Reference:** `claude-leaked-code/src/tools/MCPTool/MCPTool.ts`

- [ ] **6.3 MCP resource reading** (`src/mcp/resource.rs`)
  - `ListMcpResourcesTool` — list resources from all connected servers
  - `ReadMcpResourceTool` — read a resource by URI
  - **Reference:** `claude-leaked-code/src/tools/` (ListMcpResources, ReadMcpResource)

- [ ] **6.4 `/mcp` command** (`src/command/commands/mcp.rs`)
  - List connected/failed servers
  - Connect/disconnect servers
  - View server tools and resources
  - **Reference:** `claude-leaked-code/src/commands/mcp/`

- [ ] **6.5 ACP server** (`src/acp/`)
  - `AcpServer` — expose the TUI agent via Agent Client Protocol
  - Endpoints: `initialize`, `prompt`, `list_sessions`, `new_session`, `load_session`, `set_session_model`, `fork_session`, `list_available_commands`, `run_command`, `get_usage`
  - Listen on `127.0.0.1:13441` (configurable)
  - Session management: each ACP session = one `Agent` instance
  - **Reference:** `hermes-agent/acp_adapter/server.py`, `session.py`

- [ ] **6.6 ACP auth** (`src/acp/auth.rs`)
  - `terminal-setup` auth method
  - Token-based auth for IDE clients
  - **Reference:** `hermes-agent/acp_adapter/auth.py`

- [ ] **6.7 ACP tool adapters** (`src/acp/`)
  - Convert internal tool calls to ACP events (`ToolStartChunk`, `ToolCompleteChunk`)
  - Convert streaming responses to ACP `PromptResponse` chunks
  - **Reference:** `hermes-agent/acp_adapter/tools.py`

**Verification:**
- Configure an MCP server in `mcp.json` → its tools appear in the model's tool list
- Model calls an MCP tool → result returned
- ACP server starts on port 13441 → IDE client (e.g., Zed) can connect and send prompts
- ACP `list_sessions` returns active sessions

**Dependencies to add:** `tokio-tungstenite` (WebSocket), `tokio::process` (stdio child processes)

---

### Phase 7: Research Mode & Advanced Features

**Goal:** Add an autoresearch-style experimentation loop and polish advanced features.

**Sub-tasks:**

- [ ] **7.1 Research loop** (`src/research/`)
  - `ResearchLoop` — autonomous experimentation with keep/discard decisions
  - Branch-based isolation: `git checkout -b alpaca-research/<tag>`
  - Fixed-time-budget experiments (configurable, default 5 min)
  - TSV/JSONL append-only log: commit, metric, resource_usage, status, description
  - Metric-driven decisions: keep if improved, discard if worse, crash recovery
  - Simplicity-aware evaluation: prefer deletions over additions
  - **Reference:** `autoresearch/program.md` (entire workflow)

- [ ] **7.2 `/research` command** (`src/command/commands/research.rs`)
  - Start research session with a goal and metric
  - Configure: time budget, max experiments, metric command
  - Run loop in background, show progress in TUI
  - Generate report on completion
  - **Reference:** `autoresearch/program.md`, `analysis.ipynb`

- [ ] **7.3 Research report generation** (`src/research/report.rs`)
  - Markdown report: summary, experiment timeline, key findings, recommendations
  - TUI view: filterable table of experiments, progress chart
  - Export to file or clipboard
  - **Reference:** `autoresearch/analysis.ipynb`

- [ ] **7.4 Plan mode** (`src/command/commands/plan.rs`, `src/tui/plan_view.rs`)
  - `/plan` enters plan mode: read-only tools only, no file writes
  - Model explores codebase, asks questions, proposes plan
  - User approves plan → exit plan mode → execute plan
  - **Reference:** `claude-leaked-code/src/tools/EnterPlanModeTool/`, `ExitPlanModeV2Tool/`

- [ ] **7.5 Vim input mode** (`src/tui/input.rs`)
  - `/vim` toggles vim keybindings in the textarea
  - Modal editing: normal, insert, visual, command modes
  - **Reference:** `claude-leaked-code/src/commands/vim/`

- [ ] **7.6 Themes** (`src/tui/theme.rs`)
  - `/theme` command — list/switch/preview themes
  - Built-in: default, dark, light, solarized, gruvbox
  - Custom themes from `~/.config/alpaca-tui/themes/`
  - **Reference:** `claude-leaked-code/src/commands/theme/`

- [ ] **7.7 Diff viewer** (`src/tui/diff_view.rs`)
  - `/diff` shows uncommitted changes with syntax highlighting
  - Render unified diff with added/removed line colors
  - **Reference:** `claude-leaked-code/src/commands/diff/`

- [ ] **7.8 Export** (`src/command/commands/export.rs`)
  - `/export` — export conversation to markdown, HTML, or JSON
  - Include tool calls and results
  - **Reference:** `claude-leaked-code/src/commands/export/`

- [ ] **7.9 Doctor** (`src/command/commands/doctor.rs`)
  - `/doctor` — diagnostics: API connectivity, model availability, MCP servers, disk space, config validity
  - **Reference:** `claude-leaked-code/src/commands/doctor/`

**Verification:**
- `/research` runs 5 experiments on a target metric, keeps improvements, discards regressions
- `/plan` mode prevents file writes until plan approved
- `/vim` enables vim keybindings
- `/export` produces a valid markdown file
- `/doctor` identifies and reports configuration issues

**Dependencies to add:** (none beyond Phase 5/6)

---

## 6. Cross-Cutting Concerns

### 6.1 Configuration

All config lives in `~/.config/alpaca-tui/` (or `%APPDATA%\alpaca-tui\` on Windows):

| File | Purpose |
|---|---|
| `config.json` | General config (workspace, system_prompt, theme, vim mode) |
| `sessions.db` | SQLite session store with FTS5 |
| `mcp.json` | MCP server configurations |
| `skills/` | User-installed skills (SKILL.md files) |
| `skills/.usage.json` | Skill usage tracking |
| `plugins/` | User-installed plugins |
| `themes/` | Custom color themes |
| `memories/MEMORY.md` | Agent memory |
| `memories/USER.md` | User profile |
| `transcripts/<session_id>.jsonl` | Per-session transcripts |

### 6.2 Error Handling

- Use `anyhow::Result` for application-level errors
- Use `thiserror` for library-level error types in tool/query/skills modules
- Never panic in tool execution — catch errors and return as `ToolResult::Error`
- Network errors → retry with backoff (3 attempts, 1s/2s/4s)
- MCP server failures → mark as `FailedMcpServer`, don't crash the TUI

### 6.3 Logging

- `tracing` crate with `env-filter` (already in use)
- Log levels: `ERROR` (failures), `WARN` (degraded), `INFO` (lifecycle), `DEBUG` (tool calls), `TRACE` (streaming)
- Log file: `~/.config/alpaca-tui/tui.log` (rotated)
- `/logs` tab in TUI shows recent log entries

### 6.4 Testing Strategy

- Unit tests per module (in-module `#[cfg(test)]`)
- Integration tests in `tests/` directory:
  - `tests/tool_execution.rs` — tool call parsing and execution
  - `tests/query_loop.rs` — query loop with mock API
  - `tests/skills_discovery.rs` — skill scanning and loading
  - `tests/compression.rs` — token efficiency benchmarks
  - `tests/mcp_integration.rs` — MCP client with mock server
- Manual verification checklist per phase (see each phase's Verification section)

### 6.5 Performance Targets

| Metric | Target |
|---|---|
| TUI startup time | < 500ms |
| Tool call latency (file read) | < 50ms |
| First token latency (streaming) | < 2s |
| Memory usage (idle) | < 50MB |
| Memory usage (active session) | < 200MB |
| Token reduction (JSON output) | 60-95% |
| Token reduction (code output) | 15-20% |

### 6.6 Backward Compatibility

- The TUI must continue to work with the existing desktop app (`launchTui()` in `main.js`)
- The `--control` CLI flag remains the primary way to specify the API endpoint
- Default port stays 13439 (API Gateway)
- The existing `/help`, `/clear`, `/model`, `/status`, `/system`, `/workspace`, `/quit` commands remain unchanged
- New commands and tools are additive — no breaking changes to existing behavior

---

## 7. Dependency Roadmap

### Current (Phase 1)
```toml
ratatui = "0.29"
crossterm = "0.28"
tui-textarea = "0.7"
tokio = { version = "1.43", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
clap = { version = "4.5", features = ["derive"] }
anyhow = "1.0"
thiserror = "2.0"
tracing = "0.1"
tracing-subscriber = "0.3"
futures-util = "0.3"
unicode-width = "0.2"
```

### Phase 2 additions
```toml
tree-sitter = "0.22"
# tree-sitter language grammars (optional, for code compression in Phase 5)
ignore = "0.4"          # gitignore-aware file walking
glob = "0.3"            # glob pattern matching
regex = "1.10"
sha2 = "0.10"
git2 = "0.18"           # or shell out to git CLI
async-trait = "0.1"
schemars = "0.8"        # JSON Schema generation for tool inputs
```

### Phase 3 additions
```toml
rusqlite = { version = "0.31", features = ["bundled", "full"] }  # SQLite + FTS5
chrono = { version = "0.4", features = ["serde"] }
```

### Phase 4 additions
```toml
yaml-rust2 = "0.9"      # YAML frontmatter parsing
walkdir = "2.5"
```

### Phase 5 additions
```toml
lru = "0.12"
unicode-segmentation = "1.11"
# tree-sitter grammars (per-language crates)
```

### Phase 6 additions
```toml
tokio-tungstenite = "0.21"  # WebSocket for MCP
```

---

## 8. Progress Tracking

### Phase 1: Foundation Refactor ✅
- [x] Streaming chat via SSE
- [x] Multi-line input (tui-textarea)
- [x] Basic slash commands
- [x] Scrollback (PageUp/PageDown)
- [x] Status bar
- [x] System prompt support
- [x] Default port → 13439

### Phase 2: Tool System & Query Engine
- [ ] 2.1 Tool trait & registry
- [ ] 2.2 Built-in tools (12 tools)
- [ ] 2.3 Query engine
- [ ] 2.4 Tool orchestration
- [ ] 2.5 Permission system
- [ ] 2.6 System prompt construction
- [ ] 2.7 Workspace manager
- [ ] 2.8 TUI integration
- [ ] Verification: model can read/write files, run commands, search codebase

### Phase 3: Slash Commands & Session Management
- [ ] 3.1 Command registry
- [ ] 3.2 Built-in commands (~30 commands)
- [ ] 3.3 Session manager (SQLite + FTS5)
- [ ] 3.4 Conversation compaction
- [ ] 3.5 Cost tracking
- [ ] Verification: /compact, /resume, /commit, /cost work

### Phase 4: Skills, Sub-Agents & Plugins
- [ ] 4.1 Skills system
- [ ] 4.2 SkillTool
- [ ] 4.3 Usage tracking & curator
- [ ] 4.4 Sub-agent delegation
- [ ] 4.5 Memory manager
- [ ] 4.6 Plugin discovery
- [ ] 4.7 Built-in skills
- [ ] Verification: /skills, sub-agents, curator, plugins work

### Phase 5: Token Efficiency Stack
- [ ] 5.1 Token estimator
- [ ] 5.2 Keystone-protected pruning
- [ ] 5.3 String interning
- [ ] 5.4 SmartCrusher (JSON arrays)
- [ ] 5.5 Code compressor (tree-sitter)
- [ ] 5.6 Content-aware router
- [ ] 5.7 Cache aligner
- [ ] 5.8 CCR (reversible compression)
- [ ] 5.9 Compression policy
- [ ] 5.10 LRU cache
- [ ] 5.11 Tool surface consolidation (optional)
- [ ] Verification: 60%+ token reduction on JSON, 15%+ on code

### Phase 6: MCP & ACP Integration
- [ ] 6.1 MCP client
- [ ] 6.2 MCP tool wrapper
- [ ] 6.3 MCP resource reading
- [ ] 6.4 /mcp command
- [ ] 6.5 ACP server
- [ ] 6.6 ACP auth
- [ ] 6.7 ACP tool adapters
- [ ] Verification: MCP tools callable, ACP server accepts IDE connections

### Phase 7: Research Mode & Advanced Features
- [ ] 7.1 Research loop
- [ ] 7.2 /research command
- [ ] 7.3 Research report generation
- [ ] 7.4 Plan mode
- [ ] 7.5 Vim input mode
- [ ] 7.6 Themes
- [ ] 7.7 Diff viewer
- [ ] 7.8 Export
- [ ] 7.9 Doctor
- [ ] Verification: research loop runs, plan mode enforces read-only, vim/themes/export/doctor work

---

## 9. Key Design Decisions

### 9.1 Why Rust (not TypeScript like Claude Code)

- **Single binary distribution** — no Node.js runtime needed, ships with the desktop app
- **Memory safety** — tool execution involves file I/O and shell commands; Rust's safety is valuable
- **Performance** — token compression, AST parsing, and large file handling benefit from zero-cost abstractions
- **Existing foundation** — Phase 1 is already in Rust; rewriting in TS would discard working code

### 9.2 Why a monolithic crate (not multiple crates)

- Simpler build and distribution (one binary)
- Faster iteration during development
- Can extract sub-crates later if needed (e.g., `alpaca-tui-core`, `alpaca-tui-tools`)

### 9.3 Why SQLite for sessions (not JSON files)

- FTS5 full-text search across all past conversations
- Atomic writes (no corruption on crash)
- Efficient pagination for long histories
- **Reference:** `hermes-agent/hermes_state.py` uses the same pattern

### 9.4 Why tree-sitter for code compression (not regex)

- Syntax-preserving compression (output is still valid code)
- Language-aware (understands function boundaries, imports, etc.)
- Same approach used by both `headroom` and `jcodemunch-mcp`
- Rust has excellent tree-sitter bindings

### 9.5 Why ACP (not just MCP)

- **MCP** = expose tools/resources *to* the agent (agent as client)
- **ACP** = expose the agent *to* external clients (agent as server)
- Both are needed: MCP lets the TUI use external tools; ACP lets IDEs (Zed, Neovim) drive the TUI
- Hermes uses both; we follow the same pattern

### 9.6 Why progressive disclosure for skills

- Listing all skill contents in the system prompt would waste tokens
- Tier 1: `list_skills()` returns only names + descriptions (~100 tokens for 50 skills)
- Tier 2: `view_skill(name)` loads full content only when the model decides it's relevant
- Tier 3: `view_skill(name, file_path)` loads supporting references on demand
- **Reference:** `hermes-agent/tools/skills_tool.py` (lines 785-950)

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Model doesn't support native tool calling | Tools won't work | Implement text-based tool call parser (parse XML/JSON from text output) |
| Token budget exceeded mid-task | Task fails | Auto-compact at 80% budget; CCR for reversible compression |
| MCP server crashes | Tool call fails | Mark as `FailedMcpServer`, retry connection on next call |
| Sub-agent infinite loop | Hangs TUI | Max iterations (90), max depth (1), max concurrent children (3), timeout |
| File edit conflicts with user's unsaved changes | Data loss | Check file mtime before edit; warn if changed since last read |
| BashTool runs destructive command | Data loss | Permission prompts for destructive commands; denylist for `rm -rf /`, `git push --force` |
| Large file read exceeds token budget | Wasted tokens | FileReadTool truncates with `offset`/`limit`; keystone pruning for code |
| SQLite FTS5 not available | No session search | Use `rusqlite` with `bundled` feature (includes FTS5) |

---

## 11. File Index

### Files to create (by phase)

**Phase 2:** `src/tool/{mod,context,orchestration,execution}.rs`, `src/tool/tools/{mod,file_read,file_write,file_edit,notebook_edit,glob,grep,bash,agent,web_fetch,web_search,todo_write,ask_user,skill,mcp}.rs`, `src/query/{mod,loop,streaming,tool_call_parser,budget}.rs`, `src/prompt/{mod,context,git_status,memory_files,workspace_tree}.rs`, `src/permissions/{mod,matcher,rules}.rs`, `src/workspace/{mod,file_tree,git}.rs`, `src/tui/{repl,permission_prompt,todo_view}.rs`

**Phase 3:** `src/command/{mod,prompt,local}.rs`, `src/command/commands/{mod,help,clear,compact,model,status,system,workspace,quit,commit,diff,review,cost,doctor,skills,memory,mcp,config,plan,resume,export,theme,vim,research,version}.rs`, `src/session/{mod,store,transcript,compact}.rs`

**Phase 4:** `src/skills/{mod,discovery,loader,usage,curator}.rs`, `src/agent/{mod,delegate,coordinator,memory}.rs`, `src/plugin/{mod,discovery,hooks}.rs`, bundled `skills/*/SKILL.md`

**Phase 5:** `src/compress/{mod,router,keystone,smart_crusher,code_compress,interning,cache_aligner,ccr,policy,token_estimate}.rs`

**Phase 6:** `src/mcp/{mod,transport,types,resource}.rs`, `src/acp/{mod,session,schema,auth}.rs`

**Phase 7:** `src/research/{mod,experiment,metrics,log,report}.rs`, `src/tui/{plan_view,diff_view}.rs`, `src/tui/theme.rs`

### Files to modify

- `tui/Cargo.toml` — add dependencies per phase
- `tui/src/main.rs` — refactor from monolithic to modular (split into `app.rs`, `cli.rs`, `config.rs`)
- `tui/AGENTS.md` — update after each phase
- `desktop/main.js` — update `launchTui()` if new CLI flags needed
- `desktop/AGENTS.md` — update if IPC channels change

---

## 12. References

### Primary reference projects

| Project | Path | Key takeaway |
|---|---|---|
| claude-leaked-code | `C:/Users/Tom/source/bonsai/claude-leaked-code/claude-code/` | Tool trait, query loop, 50+ commands, MCP, permissions, system prompt |
| hermes-agent | `C:/Users/Tom/source/bonsai/hermes-agent/` | Skills system, sub-agents, curator, ACP, plugins, SQLite sessions |
| headroom | `C:/Users/Tom/source/bonsai/headroom/` | Content-aware compression, SmartCrusher, CodeCompressor, CCR, cache aligner |
| jcodemunch-mcp | `C:/Users/Tom/source/bonsai/jcodemunch-mcp/` | Keystone pruning, string interning, tool surface consolidation, token tracker |
| autoresearch | `C:/Users/Tom/source/bonsai/autoresearch/` | Branch-based experiments, time budgets, metric-driven decisions, skill-as-markdown |

### Key files in reference projects

**Claude Code (leak):**
- `src/Tool.ts` — Tool interface (362-560)
- `src/tools.ts` — Tool registration (193-251)
- `src/commands.ts` — Command registration
- `src/QueryEngine.ts` — Query engine (184-207)
- `src/query.ts` — Query loop (200-400)
- `src/services/tools/toolOrchestration.ts` — Tool orchestration (19-189)
- `src/services/tools/toolExecution.ts` — Tool execution (200-500)
- `src/utils/systemPrompt.ts` — System prompt builder (41-123)
- `src/context.ts` — Context building (116-190)
- `src/services/mcp/client.ts` — MCP client
- `src/screens/REPL.tsx` — REPL screen
- `src/components/permissions/PermissionRequest.tsx` — Permission prompts (47-82)

**Hermes Agent:**
- `tools/registry.py` — Tool registry (87-117, 220-300)
- `tools/skills_tool.py` — Skills tools (785-950)
- `tools/delegate_tool.py` — Sub-agent delegation
- `agent/curator.py` — Self-learning curator
- `agent/memory_manager.py` — Memory manager
- `acp_adapter/server.py` — ACP server
- `hermes_cli/plugins.py` — Plugin manager (1248-1400)
- `hermes_state.py` — SQLite session store

**Headroom:**
- `headroom/compress.py` — Compression entry point (171-419)
- `headroom/transforms/content_router.py` — Content routing
- `headroom/transforms/smart_crusher.py` — JSON array compression
- `headroom/transforms/code_compressor.py` — AST code compression
- `headroom/transforms/cache_aligner.py` — Cache alignment detection
- `headroom/ccr/__init__.py` — Reversible compression
- `headroom/transforms/compression_policy.py` — Compression policy

**jCodeMunch MCP:**
- `src/jcodemunch_mcp/retrieval/entropy_prune.py` — Keystone pruning
- `src/jcodemunch_mcp/encoding/schema_driven.py` — String interning
- `src/jcodemunch_mcp/counter.py` — Tool surface consolidation
- `src/jcodemunch_mcp/parser/parse_cache.py` — Parse cache
- `src/jcodemunch_mcp/storage/token_tracker.py` — Token tracking

**Autoresearch:**
- `program.md` — Agent instructions (entire file)
- `train.py` — Modifiable experiment target
- `prepare.py` — Fixed utilities
- `analysis.ipynb` — Results analysis

# Alpaca — Bonsai Model Variant

Alpaca is a local-first AI chat and development platform built on top of
llama.cpp. This fork (alpaca-bonsai) integrates the **bonsai-beach** model
catalog and backend configuration so the Bonsai ternary, image, TTS, and STT
models work out of the box.

## Architecture

| Component | Path | Purpose |
|---|---|---|
| Desktop (Electron) | `desktop/` | Main process, IPC, binary/model management, voice, image, launch service |
| WebUI (SvelteKit) | `webui/` | Chat UI, model browser, image route, settings |
| TUI (Rust) | `tui/` | Terminal UI (alpaca-tui, bonsai-beach-tui compatible) |
| Bots | `bots/` | Discord and Slack bots |
| Docs | `docs/` | Docusaurus documentation site |
| Agent configs | `config/agents/` | Per-agent setup guides (Claude Code, Codex, etc.) |

## Bonsai Integration

The bonsai-beach model catalog and backend configuration are replicated in the
desktop layer:

- **`desktop/bonsai-models.js`** — Model catalog (bonsai-27b, bonsai-8b,
  bonsai-image-4b, bonsai-tts, bonsai-stt) with download URLs. Mirrors
  `bonsai-beach/crates/bonsai-beach/src/config.rs`.
- **`desktop/binary-manager.js`** — Binary download for llama.cpp
  (PrismML-Eng/llama.cpp), sd.cpp (leejet/stable-diffusion.cpp), and
  whisper.cpp (ggerganov/whisper.cpp). Mirrors
  `bonsai-beach/crates/bonsai-beach/src/download/binaries.rs`.
- **`desktop/image-service.js`** — Local image generation via sd-cli and the
  Bonsai Image 4B model. Mirrors the image generation flow in
  `bonsai-beach/crates/bonsai-beach/src/openai_proxy.rs`.
- **`desktop/voice-service.js`** — STT via whisper.cpp and TTS via OuteTTS,
  using bonsai-beach model URLs.

### WebUI Integration

- **`/image` route** (`webui/src/routes/image/`) — Dedicated image generation
  page with prompt, steps, CFG, sampler, and seed controls plus a gallery.
- **Inline `/imagine` command** — Type `/imagine <prompt>` in any chat to
  generate an image locally and insert it as a markdown image.
- **Bonsai Models panel** (`webui/src/lib/components/app/models/BonsaiModelsPanel.svelte`)
  — Onboarding panel showing which bonsai models are missing and offering
  one-click download. Shown in Chat Settings → Models when running in Electron.
- **Bonsai ternary models** are listed first in the onboarding model picker
  and pre-checked by default.

## API Endpoints

Alpaca exposes an OpenAI-compatible API on `http://127.0.0.1:13434/v1`.
API key: any non-empty string (e.g. `alpaca`).

## Per-agent Guides

- [Claude Code](config/agents/claude-code.md)
- [Codex](config/agents/codex.md)
- [Pi-agent](config/agents/pi-agent.md)
- [Hermes-agent](config/agents/hermes-agent.md)
- [VS Code / Continue / Roo / Copilot](config/agents/vscode.md)

## Verification

```bash
# WebUI type check
cd webui && npm run check

# Desktop syntax check
node --check desktop/main.js

# TUI build (requires cargo)
cd tui && cargo build --release

# Full build
make build
```

## DOX Framework

This repository uses the DOX (docs-as-contracts) framework. Each major
subdirectory has an `AGENTS.md` file that serves as a binding work contract
for that subtree. Read the nearest `AGENTS.md` before editing, and update it
after meaningful changes.

### Child DOX Index

- `bots/AGENTS.md` — Bot configurations
- `desktop/AGENTS.md` — Electron main process
- `docs/AGENTS.md` — Documentation site
- `tui/AGENTS.md` — Terminal UI (Rust/ratatui)
- `webui/AGENTS.md` — SvelteKit frontend
- `webui/src/lib/components/app/chat/AGENTS.md` — Chat UI components
- `webui/src/lib/components/ui/AGENTS.md` — Shared UI primitives

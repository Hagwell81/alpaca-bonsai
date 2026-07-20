# Settings Guide

Configure Alpaca preferences.

## Accessing Settings

- **Menu**: File > Preferences (Ctrl+,)
- **Tray**: Right-click > Settings
- **Keyboard**: Press `Ctrl+,`

---

## General

| Setting | Description | Default |
|---------|-------------|---------|
| **Theme** | Light, Dark, or System | System |
| **System Message** | Default behavior instruction for the AI | Empty |
| **Show System Message** | Display system messages at the top of conversations | On |
| **Send on Enter** | Press Enter to send, Shift+Enter for new line | On |
| **Paste Long Text to File** | Convert pasted text over the threshold length into a file attachment | 2500 chars |
| **Copy Text Attachments as Plain Text** | Copy attachments as plain text instead of special format | Off |
| **Enable "Continue" Button** | Show a continue button on assistant messages (non-reasoning models) | Off |
| **Parse PDF as Image** | Send PDF pages as images to vision-capable models | Off |
| **Ask for Title Confirmation** | Confirm before auto-renaming conversations | Off |
| **Use First Line for Title** | Use the first non-empty line to generate conversation titles | Off |

---

## Display

| Setting | Description | Default |
|---------|-------------|---------|
| **Show Message Statistics** | Show tokens/second, count, and duration below messages | On |
| **Show Thought in Progress** | Expand the model's reasoning/thinking process by default | Off |
| **Keep Stats Visible** | Keep generation statistics visible after completion | Off |
| **Auto-Mic on Empty** | Show microphone button instead of send when input is empty | Off |
| **Render User Content as Markdown** | Format user messages with Markdown | Off |
| **Use Full Height Code Blocks** | Display code blocks at full natural height | Off |
| **Disable Auto-Scroll** | Stop automatic scrolling during streaming | Off |
| **Always Show Sidebar on Desktop** | Keep sidebar permanently visible on desktop | Off |
| **Auto-Show Sidebar on New Chat** | Open sidebar when starting a new conversation | On |
| **Show Raw Model Names** | Display full model identifiers with badges | Off |

---

## Voice

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Speech-to-Text** | Show microphone button for audio transcription | On |
| **Enable Text-to-Speech** | Show speaker icons on assistant messages | On |

**How it works:**
- **STT** uses local whisper.cpp (auto-downloaded on first use). Record audio and it is transcribed into the chat input.
- **TTS** uses browser speech synthesis by default. For higher quality, run a local MOSS-TTS server on port `13440`.

---

## Sampling

Control text generation randomness and quality:

| Parameter | Range | Description |
|-----------|-------|-------------|
| **Temperature** | 0.0 – 2.0 | Creativity/randomness (lower = more focused) |
| **Dynamic Temperature Range** | 0.0 – 2.0 | Addon that adjusts probabilities by entropy |
| **Dynamic Temperature Exponent** | 0.0 – 2.0 | Smoothes probability redistribution |
| **Top K** | 0 – 100 | Keep only top K tokens |
| **Top P** | 0.0 – 1.0 | Nucleus sampling threshold |
| **Min P** | 0.0 – 1.0 | Minimum probability relative to the most likely token |
| **XTC Probability** | 0.0 – 1.0 | Chance of cutting top tokens (0 disables) |
| **XTC Threshold** | 0.0 – 1.0 | Token probability required to cut |
| **Typical P** | 0.0 – 1.0 | Sort and limit based on log-probability vs entropy |
| **Max Tokens** | -1 / 1+ | Maximum tokens per response (-1 = infinite) |
| **Samplers** | Semicolon list | Order of sampler application |
| **Backend Sampling** | On/Off | Run supported samplers on GPU backend |

:::tip Server Defaults
Leave fields empty to use the llama-server's default values. The UI shows placeholders fetched from `/props`.
:::

---

## Penalties

Fine-tune repetition and diversity:

| Parameter | Description |
|-----------|-------------|
| **Repeat Last N** | Last N tokens to consider for repetition penalty |
| **Repeat Penalty** | Strength of penalizing repeated token sequences |
| **Presence Penalty** | Penalize tokens already present in output |
| **Frequency Penalty** | Penalize tokens based on appearance frequency |
| **DRY Multiplier** | DRY sampling repetition reduction strength |
| **DRY Base** | DRY sampling base value |
| **DRY Allowed Length** | Allowed match length for DRY |
| **DRY Penalty Last N** | DRY penalty window size |
| **DRY Sequence Breakers** | Comma-separated strings that reset DRY detection (e.g. `\n,.,!,?`) |

---

## Advanced

Fine-grained llama.cpp parameters:

| Parameter | Description |
|-----------|-------------|
| **Seed** | Random seed for reproducible outputs |
| **Mirostat** | Adaptive perplexity control (0 = off, 1 = v1, 2 = v2) |
| **Mirostat Tau** | Target perplexity for mirostat |
| **Mirostat Eta** | Learning rate for mirostat |
| **N Keep** | Tokens to retain when context is exceeded |
| **N Discard** | Tokens to discard when context is exceeded |
| **Ignore EOS** | Ignore end-of-sequence and continue generating |
| **Grammar** | Context-free grammar string for structured generation |
| **Grammar Lazy** | Enable lazy grammar evaluation |
| **Stop Sequences** | Semicolon-separated strings that halt generation |
| **Logit Bias** | JSON object mapping token IDs to bias values |
| **N Probs** | Number of token probabilities to return |
| **Min Keep** | Minimum tokens to keep regardless of thresholds |
| **Top N Sigma** | Filter tokens by standard deviations from mean logit |
| **Post Sampling Probs** | Return probabilities after sampling |
| **Chat Format** | Override the chat format template |
| **Speculative N Max** | Max draft tokens for speculative decoding |
| **Speculative N Min** | Min draft tokens before acceptance |
| **Speculative P Min** | Min probability to accept a draft token |
| **LoRA Adapters** | JSON array of `{name, scale}` LoRA configurations |

---

## MCP

Model Context Protocol settings:

| Setting | Description | Default |
|---------|-------------|---------|
| **Agentic Loop Max Turns** | Maximum tool execution cycles before stopping | 10 |
| **Always Show Agentic Turns** | Keep agentic turn messages visible in chat | Off |
| **Max Lines per Tool Preview** | Lines shown in tool output previews | 25 |
| **Show Tool Call in Progress** | Auto-expand tool call details during execution | Off |

---

## Multi-Model

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Multi-Model Mode** | Send queries to multiple models simultaneously | Off |
| **Model IDs** | Comma-separated list of model identifiers | Empty |
| **Display Mode** | Comparison (side-by-side) or Parallel (independent threads) | Comparison |

---

## Developer

| Setting | Description | Default |
|---------|-------------|---------|
| **Pre-fill KV Cache** | Re-submit conversation after response to cache for next turn | Off |
| **Reasoning Format** | How the server formats thinking content (auto/none/deepseek) | Auto |
| **Strip Thinking from History** | Remove reasoning content before sending context | Off |
| **Enable Raw Output Toggle** | Show button to switch between Markdown and plain text | Off |
| **Custom JSON** | Additional parameters sent directly to the API | Empty |

---

## Providers & Backend

Manage your local llama.cpp backend and external API providers.

### Local Backend (llama.cpp)

The **Providers** tab displays your current llama.cpp backend version and update status:

- **Current Version** — Shows the installed backend tag (e.g., `b4082`)
- **Update Status** — An indicator badge shows:
  - **Up to date** (green) — You are on the latest release
  - **Update available** (amber) — A newer release exists on GitHub

#### Checking for Updates

1. Open **Settings** → **Providers**
2. Click **Check for Updates** on the Local Backend card
3. The app queries the [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) page

#### Installing an Update

1. When an update is available, click **Update to `<version>`**
2. Watch the **progress bar** as the update moves through each phase:
   - **Checking** — Querying the latest release
   - **Downloading** — Fetching the backend binary for your hardware
   - **Extracting** — Unpacking the archive
   - **Restarting** — Stopping and restarting the llama-server
   - **Ready** — Server is online with the new backend
3. A **toast notification** appears when the server is ready for use
4. The chat window reloads automatically to reconnect

:::tip No Downtime Worry
If the server was not running when you update, the new backend will be used automatically on the next start. Your conversations and settings are never affected.
:::

### Custom Providers

Add OpenAI-compatible API endpoints to use alongside local models:

1. Click **Add Custom Provider**
2. Enter:
   - **Provider Name** — A label for your own reference
   - **Base URL** — The API endpoint (e.g., `https://api.openai.com/v1`)
   - **API Key** — Your authentication key (stored securely)
   - **Models** (optional) — Comma-separated list of model IDs
3. Click **Save Provider**

Providers are stored per-user account and are available in the model selector when logged in.

---

## Import / Export

- **Export All Conversations** — Save all chats as a JSON file
- **Import Conversations** — Restore from a previously exported JSON file

---

## Reset

Reset all settings to defaults via **Help > Reset Settings**.

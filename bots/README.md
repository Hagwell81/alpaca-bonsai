# Alpaca Chat Bots

This directory contains example bot implementations for Discord and Slack that connect to your local Alpaca instance via the Ollama-compatible API.

## Discord Bot

### Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Add a Bot to your application and copy the bot token
3. Enable `Message Content Intent` in the Bot settings
4. Invite the bot to your server with `Send Messages`, `Read Messages`, `Read Message History` permissions
5. Install dependencies:
   ```bash
   cd discord-bot
   npm install
   ```
6. Set environment variables:
   ```bash
   export DISCORD_BOT_TOKEN="your-bot-token"
   export ALPACA_API_URL="http://localhost:13439/v1/chat/completions"
   export ALPACA_MODEL="your-model-name"
   ```
7. Run the bot:
   ```bash
   npm start
   ```

## Slack Bot

### Setup
1. Go to [Slack API Apps](https://api.slack.com/apps) and create a new app from scratch
2. Go to OAuth & Permissions and add scopes: `app_mentions:read`, `chat:write`, `im:history`, `channels:history`
3. Install the app to your workspace
4. Go to Socket Mode and enable it
5. Generate an App-Level Token with `connections:write` scope
6. Install dependencies:
   ```bash
   cd slack-bot
   npm install
   ```
7. Set environment variables:
   ```bash
   export SLACK_BOT_TOKEN="xoxb-your-bot-token"
   export SLACK_APP_TOKEN="xapp-your-app-token"
   export ALPACA_API_URL="http://localhost:13439/v1/chat/completions"
   export ALPACA_MODEL="your-model-name"
   ```
8. Run the bot:
   ```bash
   npm start
   ```

## Ollama Integration Pattern

Both bots use the Ollama-compatible OpenAI API endpoint:
- Base URL: `http://localhost:13439/v1`
- API Key: `ollama` (ignored, but required by some clients)
- Endpoint: `/chat/completions`

This follows the [Ollama integration documentation](https://docs.ollama.com/integrations) pattern for connecting third-party tools.

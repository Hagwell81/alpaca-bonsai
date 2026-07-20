/**
 * Alpaca Slack Bot
 *
 * A simple Slack bot using Socket Mode that forwards messages to the local
 * Alpaca API (Ollama-compatible endpoint) and replies with the
 * generated response.
 *
 * Setup:
 * 1. Create a Slack app at https://api.slack.com/apps
 * 2. Enable Socket Mode and Event Subscriptions
 * 3. Subscribe to message.channels and message.im events
 * 4. Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN env vars
 * 5. npm install @slack/bolt axios
 * 6. node bot.js
 */

const { App } = require('@slack/bolt');
const axios = require('axios');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const ALPACA_API_URL = process.env.ALPACA_API_URL || 'http://localhost:13439/v1/chat/completions';
const MODEL_NAME = process.env.ALPACA_MODEL || 'local-model';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN and SLACK_APP_TOKEN environment variables are required');
  process.exit(1);
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true
});

const conversationHistory = new Map(); // threadTs -> messages[]
const MAX_HISTORY = 20;

async function queryModel(messages) {
  const response = await axios.post(
    ALPACA_API_URL,
    {
      model: MODEL_NAME,
      messages,
      stream: false,
      temperature: 0.7,
      max_tokens: 1024
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    }
  );
  return response.data.choices?.[0]?.message?.content || 'No response';
}

// Handle direct messages
app.message(async ({ message, say, client }) => {
  if (message.subtype || message.bot_id) return;

  const threadTs = message.thread_ts || message.ts;
  const userContent = message.text || '';

  if (!conversationHistory.has(threadTs)) {
    conversationHistory.set(threadTs, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  const history = conversationHistory.get(threadTs);
  history.push({ role: 'user', content: userContent });
  if (history.length > MAX_HISTORY) {
    history.splice(1, history.length - MAX_HISTORY);
  }

  try {
    // Post "thinking" message
    const thinking = await say({ text: ':thinking_face: Thinking...', thread_ts: threadTs });

    const assistantReply = await queryModel(history);
    history.push({ role: 'assistant', content: assistantReply });

    // Update thinking message with response
    await client.chat.update({
      channel: message.channel,
      ts: thinking.ts,
      text: assistantReply
    });
  } catch (error) {
    console.error('Slack bot error:', error.message);
    await say({ text: `Error: ${error.response?.data?.error?.message || error.message}`, thread_ts: threadTs });
  }
});

// Handle mentions in channels
app.event('app_mention', async ({ event, say, client }) => {
  const threadTs = event.thread_ts || event.ts;
  const userContent = event.text.replace(/<@U[A-Z0-9]+>/g, '').trim();

  if (!userContent) {
    await say({ text: 'Hello! How can I help you?', thread_ts: threadTs });
    return;
  }

  if (!conversationHistory.has(threadTs)) {
    conversationHistory.set(threadTs, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  const history = conversationHistory.get(threadTs);
  history.push({ role: 'user', content: userContent });
  if (history.length > MAX_HISTORY) {
    history.splice(1, history.length - MAX_HISTORY);
  }

  try {
    const thinking = await say({ text: ':thinking_face: Thinking...', thread_ts: threadTs });
    const assistantReply = await queryModel(history);
    history.push({ role: 'assistant', content: assistantReply });

    await client.chat.update({
      channel: event.channel,
      ts: thinking.ts,
      text: assistantReply
    });
  } catch (error) {
    console.error('Slack bot error:', error.message);
    await say({ text: `Error: ${error.response?.data?.error?.message || error.message}`, thread_ts: threadTs });
  }
});

(async () => {
  await app.start();
  console.log('Slack bot is running!');
  console.log(`Using API: ${ALPACA_API_URL}`);
})();

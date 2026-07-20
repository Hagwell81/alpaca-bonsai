/**
 * Alpaca Discord Bot
 *
 * A simple Discord bot that forwards messages to the local Alpaca
 * API (Ollama-compatible endpoint) and replies with the generated response.
 *
 * Setup:
 * 1. npm install discord.js axios
 * 2. Set DISCORD_BOT_TOKEN and ALPACA_API_URL env vars
 * 3. node bot.js
 */

const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ALPACA_API_URL = process.env.ALPACA_API_URL || 'http://localhost:13439/v1/chat/completions';
const MODEL_NAME = process.env.ALPACA_MODEL || 'local-model';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';

if (!DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const conversationHistory = new Map(); // channelId -> messages[]
const MAX_HISTORY = 20;

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  console.log(`Using API: ${ALPACA_API_URL}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Only respond to mentions or DMs
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.isDMBased?.() || message.guild === null;
  if (!isMentioned && !isDM) return;

  const userContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();
  if (!userContent) return;

  // Show typing indicator
  await message.channel.sendTyping();

  // Get or initialize conversation history
  const channelId = message.channel.id;
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, [
      { role: 'system', content: SYSTEM_PROMPT }
    ]);
  }
  const history = conversationHistory.get(channelId);
  history.push({ role: 'user', content: userContent });
  if (history.length > MAX_HISTORY) {
    history.splice(1, history.length - MAX_HISTORY); // keep system message
  }

  try {
    const response = await axios.post(
      ALPACA_API_URL,
      {
        model: MODEL_NAME,
        messages: history,
        stream: false,
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      }
    );

    const assistantReply = response.data.choices?.[0]?.message?.content || 'No response';
    history.push({ role: 'assistant', content: assistantReply });

    // Discord has a 2000 character limit per message
    if (assistantReply.length > 1900) {
      const chunks = assistantReply.match(/[\s\S]{1,1900}/g) || [assistantReply];
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.reply(assistantReply);
    }
  } catch (error) {
    console.error('Discord bot error:', error.message);
    await message.reply(`Error: ${error.response?.data?.error?.message || error.message}`);
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error.message);
});

client.login(DISCORD_BOT_TOKEN);

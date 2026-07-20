# Google AI (Gemini)

Use Google's Gemini models through the Gemini API.

## Overview

Google's Gemini models offer multimodal capabilities and strong reasoning.

## Configuration

```json
{
  "providers": {
    "google": {
      "enabled": true,
      "apiKey": "your-gemini-key",
      "model": "gemini-pro",
      "maxTokens": 8192
    }
  }
}
```

## Available Models

| Model | Context | Features |
|-------|---------|----------|
| gemini-pro | 32K | Text, code |
| gemini-pro-vision | 32K | Text + images |
| gemini-ultra | 32K | Best performance |

## API Key Setup

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create an API key
3. Add to Alpaca Settings

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'gemini-pro',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Multimodal Support

```typescript
const response = await client.chat.completions.create({
  model: 'gemini-pro-vision',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', url: 'data:image/jpeg;base64,...' }
      ]
    }
  ]
});
```

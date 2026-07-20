---
sidebar_position: 6
title: Building Systems with the API
description: Develop custom applications and integrations using the Alpaca API
---

# Building Systems with the API

This guide covers how to build complete applications and systems on top of the Alpaca API. Whether you're creating IDE plugins, automation tools, or standalone applications, this guide provides patterns and best practices.

## Architecture Patterns

### Client-Server Pattern

The most common pattern for API integration:

```
┌─────────────────┐      HTTP/SSE      ┌─────────────────┐
│   Your App      │ ◄────────────────► │ Alpaca │
│  (Client)       │                    │   (Server)      │
└─────────────────┘                    └─────────────────┘
```

**Use Cases:**
- IDE extensions
- Chat bots
- Automation scripts
- Web applications

### Embedded Pattern

Run the server as a subprocess within your application:

```javascript
// Node.js example
const { spawn } = require('child_process');

const server = spawn('alpaca', ['--server-mode']);

server.stdout.on('data', (data) => {
  console.log(`Server: ${data}`);
});

// Wait for server ready, then make API calls
```

**Use Cases:**
- Desktop applications
- Self-contained tools
- Test environments

### Proxy Pattern

Add a middleware layer between clients and Alpaca:

```
┌─────────┐    ┌──────────────┐    ┌─────────────────┐
│ Client  │───►│ Your Proxy   │───►│ Alpaca │
│         │◄───│ (Middleware) │◄───│                 │
└─────────┘    └──────────────┘    └─────────────────┘
```

**Use Cases:**
- Request logging
- Custom authentication
- Request transformation
- Multi-user access control

## Building IDE Extensions

### VS Code Extension

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:13434/v1',
  apiKey: 'not-needed'
});

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'alpaca.explainCode',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const code = editor.document.getText(editor.selection);

      const response = await client.chat.completions.create({
        model: 'llama-3-8b',
        messages: [
          {
            role: 'system',
            content: 'You are a code explanation assistant.'
          },
          {
            role: 'user',
            content: `Explain this code:\n\n${code}`
          }
        ],
        temperature: 0.3
      });

      const panel = vscode.window.createWebviewPanel(
        'explanation',
        'Code Explanation',
        vscode.ViewColumn.Beside,
        {}
      );

      panel.webview.html = `
        <html><body>
          <pre>${response.choices[0].message.content}</pre>
        </body></html>
      `;
    }
  );

  context.subscriptions.push(disposable);
}
```

### Cursor Integration

Configure Cursor to use Alpaca:

1. Open Cursor Settings
2. Navigate to **AI Providers** → **OpenAI API**
3. Set **Base URL** to `http://localhost:13434/v1`
4. Set **API Key** to any value (or your configured key)
5. Select your model from the dropdown

### JetBrains Plugin

```kotlin
// Kotlin example for IntelliJ plugin
class AlpacaService {
    private val client = OkHttpClient()
    private val gson = Gson()
    private val baseUrl = "http://localhost:13434/v1"

    fun generateCode(description: String): String {
        val request = ChatRequest(
            model = "llama-3-8b",
            messages = listOf(
                Message("user", "Generate Kotlin code: $description")
            )
        )

        val body = gson.toJson(request).toRequestBody("application/json".toMediaType())

        val httpRequest = Request.Builder()
            .url("$baseUrl/chat/completions")
            .post(body)
            .build()

        client.newCall(httpRequest).execute().use { response ->
            val result = gson.fromJson(response.body?.string(), ChatResponse::class.java)
            return result.choices[0].message.content
        }
    }
}
```

## Building Chat Bots

### Discord Bot

```python
import discord
from openai import OpenAI
import os

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")
intents = discord.Intents.default()
intents.message_content = True
bot = discord.Client(intents=intents)

conversation_history = {}

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    if not message.content.startswith('!ai'):
        return

    user_id = message.author.id
    prompt = message.content[4:].strip()

    # Maintain conversation history per user
    if user_id not in conversation_history:
        conversation_history[user_id] = []

    conversation_history[user_id].append({
        "role": "user",
        "content": prompt
    })

    # Call API
    response = client.chat.completions.create(
        model="llama-3-8b",
        messages=conversation_history[user_id],
        max_tokens=500
    )

    reply = response.choices[0].message.content
    conversation_history[user_id].append({
        "role": "assistant",
        "content": reply
    })

    # Limit history to last 10 messages
    if len(conversation_history[user_id]) > 20:
        conversation_history[user_id] = conversation_history[user_id][-20:]

    await message.reply(reply)

bot.run(os.getenv('DISCORD_TOKEN'))
```

### Slack Bot

```python
from slack_bolt import App
from openai import OpenAI

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")
app = App(token=os.environ["SLACK_BOT_TOKEN"])

@app.message("@alpaca")
def handle_mention(message, say):
    user_prompt = message['text'].replace('@alpaca', '').strip()

    response = client.chat.completions.create(
        model="llama-3-8b",
        messages=[
            {"role": "system", "content": "You are a helpful Slack assistant."},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.7
    )

    say(response.choices[0].message.content)

if __name__ == "__main__":
    app.start(port=3000)
```

## Building Automation Tools

### Document Processing Pipeline

```python
import os
from openai import OpenAI
from PyPDF2 import PdfReader

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")

def summarize_document(pdf_path):
    """Summarize a PDF document."""
    reader = PdfReader(pdf_path)
    text = "\n".join(page.extract_text() for page in reader.pages)

    # Chunk if too long
    max_chars = 8000
    if len(text) > max_chars:
        text = text[:max_chars] + "..."

    response = client.chat.completions.create(
        model="llama-3-8b",
        messages=[
            {
                "role": "system",
                "content": "Summarize the following document concisely."
            },
            {
                "role": "user",
                "content": f"Document:\n\n{text}\n\nProvide a 3-paragraph summary."
            }
        ],
        temperature=0.3,
        max_tokens=1024
    )

    return response.choices[0].message.content

# Process directory of documents
for filename in os.listdir('documents/'):
    if filename.endswith('.pdf'):
        summary = summarize_document(f'documents/{filename}')
        print(f"=== {filename} ===")
        print(summary)
        print()
```

### Code Review Automation

```python
import subprocess
from openai import OpenAI

client = OpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")

def review_diff(branch='main'):
    """Review git diff against a branch."""
    diff = subprocess.check_output(
        ['git', 'diff', branch],
        text=True
    )

    if not diff.strip():
        return "No changes to review."

    response = client.chat.completions.create(
        model="llama-3-8b",
        messages=[
            {
                "role": "system",
                "content": "You are a senior software engineer conducting code reviews."
            },
            {
                "role": "user",
                "content": f"Review this git diff. Identify bugs, security issues, style violations, and suggestions:\n\n```diff\n{diff[:8000]}\n```"
            }
        ],
        temperature=0.2,
        max_tokens=2048
    )

    return response.choices[0].message.content

# Run review
review = review_diff()
print(review)
```

## Building Web Applications

### React Chat Interface

```tsx
// components/Chat.tsx
import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => scrollToBottom(), [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:13434/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3-8b',
          messages: newMessages,
          stream: true
        })
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      // Add placeholder assistant message
      setMessages([...newMessages, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            assistantContent += content;
            setMessages([
              ...newMessages,
              { role: 'assistant', content: assistantContent }
            ]);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {isLoading && <div className="loading">Thinking...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage} disabled={isLoading}>
          Send
        </button>
      </div>
    </div>
  );
}
```

## Testing Your Integration

### Mock Server for Testing

```python
# test/conftest.py
import pytest
from unittest.mock import Mock, patch

@pytest.fixture
def mock_alpaca():
    """Mock Alpaca API responses."""
    mock_client = Mock()
    mock_client.chat.completions.create.return_value = Mock(
        choices=[Mock(message=Mock(content="Mocked response"))]
    )
    return mock_client

# test/test_chat.py
def test_chat_generation(mock_alpaca):
    response = mock_alpaca.chat.completions.create(
        model="llama-3-8b",
        messages=[{"role": "user", "content": "Hello"}]
    )
    assert response.choices[0].message.content == "Mocked response"
```

### Integration Tests

```python
# test/test_integration.py
import requests
import pytest

BASE_URL = "http://localhost:13434/v1"

class TestAlpacaAPI:
    def test_health(self):
        response = requests.get(f"{BASE_URL}/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_list_models(self):
        response = requests.get(f"{BASE_URL}/models")
        assert response.status_code == 200
        assert "data" in response.json()

    def test_chat_completion(self):
        response = requests.post(
            f"{BASE_URL}/chat/completions",
            json={
                "model": "llama-3-8b",
                "messages": [{"role": "user", "content": "Say hello"}],
                "max_tokens": 50
            }
        )
        assert response.status_code == 200
        assert "choices" in response.json()
```

## Deployment Considerations

### Local Development

```bash
# Start server in background
alpaca --server-mode &

# Wait for health check
until curl -s http://localhost:13434/health | grep -q "ok"; do
  sleep 1
done

# Run your application
npm start
```

### Docker Integration

```dockerfile
# Dockerfile for app using Alpaca
FROM node:20

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Assume Alpaca is running on host
ENV ALPACABITOLLAMA_URL=http://host.docker.internal:13434/v1

CMD ["node", "index.js"]
```

### Production Proxy

```nginx
# nginx.conf
server {
    listen 80;
    server_name api.yourapp.com;

    location /v1/ {
        proxy_pass http://localhost:13434/v1/;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;

        # Custom auth
        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }
}
```

## Performance Optimization

### Connection Pooling

```python
# Python with httpx
import httpx

client = httpx.Client(
    limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
    timeout=300.0
)

# Reuse client across requests
response = client.post("http://localhost:13434/v1/chat/completions", json={...})
```

### Request Batching

For processing multiple inputs, batch requests when possible:

```python
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI(base_url="http://localhost:13434/v1", api_key="not-needed")

async def process_batch(prompts):
    tasks = [
        client.chat.completions.create(
            model="llama-3-8b",
            messages=[{"role": "user", "content": p}],
            max_tokens=100
        )
        for p in prompts
    ]
    responses = await asyncio.gather(*tasks)
    return [r.choices[0].message.content for r in responses]

results = asyncio.run(process_batch(["Q1", "Q2", "Q3"]))
```

## Error Handling Patterns

### Circuit Breaker

```python
from enum import Enum
import time

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, failure_threshold=5, recovery_timeout=30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = CircuitState.CLOSED
        self.failures = 0
        self.last_failure_time = None

    def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
            else:
                raise Exception("Circuit breaker is OPEN")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise e

    def _on_success(self):
        self.failures = 0
        self.state = CircuitState.CLOSED

    def _on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN

# Usage
cb = CircuitBreaker()
response = cb.call(client.chat.completions.create, model="llama-3-8b", messages=[...])
```

## Security Best Practices

### API Key Management

```python
import os
from functools import lru_cache

@lru_cache
def get_api_key():
    """Load API key from environment or secure storage."""
    key = os.getenv("ALPACABITOLLAMA_API_KEY")
    if not key:
        raise ValueError("API key not configured")
    return key

# Use in client
client = OpenAI(
    base_url="http://localhost:13434/v1",
    api_key=get_api_key()
)
```

### Input Validation

```python
import re

MAX_PROMPT_LENGTH = 100000
ALLOWED_ROLES = {'system', 'user', 'assistant', 'tool'}

def validate_messages(messages):
    if not isinstance(messages, list):
        raise ValueError("Messages must be a list")

    for msg in messages:
        if msg.get('role') not in ALLOWED_ROLES:
            raise ValueError(f"Invalid role: {msg.get('role')}")
        if len(msg.get('content', '')) > MAX_PROMPT_LENGTH:
            raise ValueError("Message content too long")
```

## Next Steps

- **[REST API Reference](../api/rest-api.md)** — Complete endpoint documentation
- **[WebSocket API](../api/websocket.md)** — Real-time communication
- **[Architecture](../development/architecture.md)** — System design
- **[Testing](../development/testing.md)** — Test strategies

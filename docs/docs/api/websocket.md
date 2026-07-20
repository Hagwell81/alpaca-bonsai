# WebSocket API

Real-time communication with the Alpaca server.

## Overview

WebSocket support enables real-time updates for:
- Model downloads
- Server status
- Chat streaming
- System notifications

## Connection

```javascript
const ws = new WebSocket('ws://localhost:13434/ws');

ws.onopen = () => {
  console.log('Connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## Events

### Server Status

```json
{
  "type": "server.status",
  "data": {
    "running": true,
    "model": "llama-3-8b",
    "uptime": 3600
  }
}
```

### Download Progress

```json
{
  "type": "download.progress",
  "data": {
    "model": "llama-3-8b",
    "progress": 45,
    "speed": "5.2 MB/s",
    "remaining": "2m 30s"
  }
}
```

### Chat Stream

```json
{
  "type": "chat.chunk",
  "data": {
    "id": "chat-123",
    "content": "Hello",
    "done": false
  }
}
```

## Subscribing

```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['server.status', 'download.progress']
}));
```

## Sending Messages

```javascript
ws.send(JSON.stringify({
  type: 'chat.request',
  data: {
    model: 'llama-3',
    messages: [{ role: 'user', content: 'Hello' }]
  }
}));
```

## Authentication

Include token in connection URL:

```javascript
const ws = new WebSocket('ws://localhost:13434/ws?token=your-api-key');
```

## Error Handling

```javascript
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('Connection closed:', event.code, event.reason);
  // Reconnect logic here
};
```

## Reconnection

```javascript
function connectWithRetry() {
  const ws = new WebSocket('ws://localhost:13434/ws');
  
  ws.onclose = () => {
    setTimeout(connectWithRetry, 5000);
  };
}
```

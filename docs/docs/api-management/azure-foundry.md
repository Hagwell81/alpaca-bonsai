# Azure Foundry

Use Microsoft's Azure AI Foundry for enterprise-grade AI.

## Overview

Azure AI Foundry provides managed AI services with enterprise security and compliance.

## Configuration

```json
{
  "providers": {
    "azure-foundry": {
      "enabled": true,
      "endpoint": "https://your-resource.openai.azure.com/",
      "apiKey": "your-azure-key",
      "deploymentName": "your-deployment",
      "apiVersion": "2024-02-15-preview"
    }
  }
}
```

## Setup

1. Create Azure AI Foundry resource
2. Deploy a model (GPT-4, GPT-3.5, etc.)
3. Get endpoint and API key
4. Configure in Settings

## Usage

```typescript
const response = await client.chat.completions.create({
  model: 'your-deployment-name',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

## Features

- Enterprise security
- Private networking
- Compliance certifications
- Content filtering
- Monitoring and logging

# Pi-agent Integration

Pi-agent's `@earendil-works/pi-ai` package builds providers with `createProvider`
and `openAICompletionsApi`. Add a Alpaca provider entry:

```typescript
import { createProvider, createModels, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

const bonsaiModel: Model<'openai-completions'> = {
  id: 'bonsai-27b',
  name: 'Bonsai 27B',
  api: 'openai-completions',
  provider: 'Alpaca',
  baseUrl: 'http://127.0.0.1:15452/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  },
};

const bonsaiBeach = createProvider({
  id: 'Alpaca',
  name: 'Alpaca',
  baseUrl: 'http://127.0.0.1:15452/v1',
  auth: { apiKey: { name: 'Alpaca', resolve: async () => ({ auth: {} }) } },
  models: [bonsaiModel],
  api: openAICompletionsApi(),
});

const models = createModels();
models.setProvider(bonsaiBeach);
```

Use `bonsai-8b` on `http://127.0.0.1:15453/v1` for a lighter chat-only model.

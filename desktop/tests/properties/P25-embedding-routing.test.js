/**
 * Property Test P25: Embedding routing
 *
 * For any POST to `/v1/embeddings`, the gateway selects the embedding slot
 * (id 3, port 13437) for proxying regardless of the request body contents.
 *
 * Validates: Requirements 16.3
 */

const { expect } = require('chai');
const fc = require('fast-check');
const http = require('http');
const { ApiGateway } = require('../../api-gateway');

/**
 * Fast-check arbitrary for generating valid /v1/embeddings request bodies
 */
const embeddingsBodyArbitrary = () => {
  return fc.record({
    input: fc.oneof(
      fc.string({ maxLength: 1000 }),
      fc.array(fc.string({ maxLength: 500 }), { minLength: 1, maxLength: 10 })
    ),
    model: fc.string({ maxLength: 100 }),
    encoding_format: fc.option(fc.constantFrom('float', 'base64')),
    user: fc.option(fc.string({ maxLength: 100 })),
    // Extra fields that might be in the body
    extra_field: fc.option(fc.string({ maxLength: 100 })),
  });
};

/**
 * Make an HTTP request and return a promise
 */
function makeRequest(hostname, port, path, method, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          let responseBody = null;
          if (data) {
            responseBody = JSON.parse(data);
          }
          resolve({ statusCode: res.statusCode, body: responseBody });
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

describe('P25: Embedding routing', () => {
  let gateway;
  let port;
  let mockSlotManager;
  let selectedSlotId;
  let selectedSlotPort;

  beforeEach(async () => {
    // Track which slot was selected
    selectedSlotId = null;
    selectedSlotPort = null;

    // Create mock slots
    const slots = [
      { id: 0, port: 13434, purpose: 'primary', status: 'running' },
      { id: 1, port: 13435, purpose: 'secondary', status: 'running' },
      { id: 2, port: 13436, purpose: 'vision', status: 'running' },
      { id: 3, port: 13437, purpose: 'embedding', status: 'running' },
      { id: 4, port: 13438, purpose: 'coding', status: 'running' },
    ];

    // Create mock slot manager that tracks which slot is selected
    mockSlotManager = {
      listSlots: () => slots,
      getActiveSlots: () => slots.filter(s => s.status === 'running'),
      getSlot: (id) => {
        const slot = slots.find(s => s.id === id);
        if (slot) {
          selectedSlotId = id;
          selectedSlotPort = slot.port;
        }
        return slot;
      },
      getSlotByPort: (port) => slots.find(s => s.port === port) || null,
      getSlotByPurpose: (purpose) => slots.find(s => s.purpose === purpose) || null,
    };

    const mockVramBudgetManager = {};
    const mockGrammarLibrary = {};
    const mockToolRewriter = {};
    const mockLogger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    };

    gateway = new ApiGateway({
      slotManager: mockSlotManager,
      vramBudgetManager: mockVramBudgetManager,
      grammarLibrary: mockGrammarLibrary,
      toolRewriter: mockToolRewriter,
      logger: mockLogger,
    });

    // Start the gateway on a random port
    await new Promise((resolve, reject) => {
      gateway.server = http.createServer((req, res) => gateway._handleRequest(req, res));
      gateway.server.listen(0, '127.0.0.1', () => {
        port = gateway.server.address().port;
        resolve();
      });
      gateway.server.on('error', reject);
    });
  });

  afterEach(async () => {
    if (gateway && gateway.server) {
      await new Promise((resolve) => {
        gateway.server.close(resolve);
      });
    }
  });

  it('should always route /v1/embeddings to slot 3 (embedding slot)', async () => {
    const body = {
      input: 'test embedding',
      model: 'embedding-model',
    };

    // Make the request
    const response = await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    // Verify that slot 3 was selected
    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 regardless of input content (property test)', async () => {
    // Use a simpler approach: generate multiple bodies and test each one
    for (let i = 0; i < 50; i++) {
      const body = fc.sample(embeddingsBodyArbitrary(), 1)[0];
      
      // Reset tracking
      selectedSlotId = null;
      selectedSlotPort = null;

      // Make the request
      await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

      // Verify that slot 3 was selected
      expect(selectedSlotId).to.equal(3, `Failed for body: ${JSON.stringify(body)}`);
      expect(selectedSlotPort).to.equal(13437, `Failed for body: ${JSON.stringify(body)}`);
    }
  });

  it('should route to slot 3 with simple string input', async () => {
    const body = {
      input: 'Hello, world!',
      model: 'text-embedding-3-small',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with array input', async () => {
    const body = {
      input: ['Hello', 'world', 'test'],
      model: 'text-embedding-3-large',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with encoding_format specified', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      encoding_format: 'float',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with user field specified', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      user: 'user123',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with extra fields in body', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      extra_field: 'extra_value',
      another_field: 'another_value',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with empty input array', async () => {
    const body = {
      input: [],
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with very long input', async () => {
    const body = {
      input: 'x'.repeat(10000),
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with unicode input', async () => {
    const body = {
      input: '你好世界 🌍 مرحبا العالم',
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with special characters in input', async () => {
    const body = {
      input: 'Hello\n\t"\'<>&\u0000\uFFFF',
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with minimal body', async () => {
    const body = {
      input: 'test',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with empty string input', async () => {
    const body = {
      input: '',
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with null model', async () => {
    const body = {
      input: 'test',
      model: null,
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with missing model field', async () => {
    const body = {
      input: 'test',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with large array of inputs', async () => {
    const body = {
      input: Array.from({ length: 100 }, (_, i) => `text ${i}`),
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with mixed content in array', async () => {
    const body = {
      input: [
        'simple text',
        'text with\nnewlines',
        'text with "quotes"',
        'text with \'single quotes\'',
        '你好',
        '🌍',
      ],
      model: 'embedding-model',
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should always select slot 3 and never select other slots', async () => {
    // Use a simpler approach: generate multiple bodies and test each one
    for (let i = 0; i < 50; i++) {
      const body = fc.sample(embeddingsBodyArbitrary(), 1)[0];
      
      selectedSlotId = null;
      selectedSlotPort = null;

      await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

      // Verify that ONLY slot 3 is selected
      expect(selectedSlotId).to.equal(3, `Failed for body: ${JSON.stringify(body)}`);
      expect(selectedSlotPort).to.equal(13437, `Failed for body: ${JSON.stringify(body)}`);

      // Verify that no other slot was selected
      expect(selectedSlotId).to.not.equal(0);
      expect(selectedSlotId).to.not.equal(1);
      expect(selectedSlotId).to.not.equal(2);
      expect(selectedSlotId).to.not.equal(4);
    }
  });

  it('should route to slot 3 consistently across multiple requests', async () => {
    const bodies = [
      { input: 'test1', model: 'model1' },
      { input: 'test2', model: 'model2' },
      { input: 'test3', model: 'model3' },
      { input: ['test4', 'test5'], model: 'model4' },
    ];

    for (const body of bodies) {
      selectedSlotId = null;
      selectedSlotPort = null;

      await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

      expect(selectedSlotId).to.equal(3);
      expect(selectedSlotPort).to.equal(13437);
    }
  });

  it('should route to slot 3 with all optional fields present', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      encoding_format: 'float',
      user: 'user123',
      dimensions: 1536,
      timeout: 30000,
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with numeric values in body', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      dimensions: 1536,
      timeout: 30000,
      max_retries: 3,
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with boolean values in body', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      normalize: true,
      cache: false,
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });

  it('should route to slot 3 with nested objects in body', async () => {
    const body = {
      input: 'test',
      model: 'embedding-model',
      options: {
        normalize: true,
        cache: false,
        timeout: 30000,
      },
    };

    selectedSlotId = null;
    selectedSlotPort = null;

    await makeRequest('127.0.0.1', port, '/v1/embeddings', 'POST', body);

    expect(selectedSlotId).to.equal(3);
    expect(selectedSlotPort).to.equal(13437);
  });
});

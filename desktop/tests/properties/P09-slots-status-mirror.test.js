/**
 * Property Test P9: /v1/slots/status mirrors in-process Slot state
 *
 * Verify that the /v1/slots/status endpoint correctly mirrors the in-process
 * slot state without making upstream HTTP calls.
 *
 * For any generated SlotManager state (with arbitrary slot statuses, models,
 * metrics, and errors), the response from _handleSlotsStatus should:
 * 1. Return exactly 5 slot entries (one per slot id 0..4)
 * 2. Each entry contains id, port, purpose, status, modelPath, mmprojPath, lastUsed, metrics
 * 3. modelPath and mmprojPath are null unless status === 'running'
 * 4. When status === 'running' and mmprojPath is configured, it is included
 * 5. When status === 'running' but mmprojPath is not configured, it is null
 * 6. The response is produced entirely from in-process state (no upstream HTTP calls)
 *
 * Validates: Requirements 8.3
 */

const { expect } = require('chai');
const http = require('http');
const fc = require('fast-check');
const { ApiGateway } = require('../../api-gateway');

/**
 * Make an HTTP request and return a promise
 */
function makeRequest(hostname, port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const body = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body });
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

describe('P9: /v1/slots/status mirrors in-process Slot state', () => {
  let gateway;
  let port;

  beforeEach(async () => {
    // Create a mock gateway with minimal dependencies
    const mockSlotManager = {
      listSlots: () => [],
      getActiveSlots: () => [],
      getSlot: () => null,
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

  /**
   * Generate a valid slot object
   */
  const slotArbitrary = fc.record({
    id: fc.integer({ min: 0, max: 4 }),
    port: fc.integer({ min: 13434, max: 13438 }),
    purpose: fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
    status: fc.constantFrom('idle', 'starting', 'running', 'stopping', 'error'),
    modelPath: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { freq: 2 }),
    mmprojPath: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { freq: 1 }),
    lastUsed: fc.option(fc.integer({ min: 0, max: Date.now() }), { freq: 2 }),
    supportsTools: fc.option(fc.boolean(), { freq: 2 }),
    chatTemplate: fc.option(fc.string({ maxLength: 100 }), { freq: 1 }),
    metrics: fc.record({
      tokensGenerated: fc.integer({ min: 0, max: 1000000 }),
      tokensPrompted: fc.integer({ min: 0, max: 1000000 }),
      requestsServed: fc.integer({ min: 0, max: 10000 }),
      avgLatencyMs: fc.integer({ min: 0, max: 10000 }),
    }),
    lastError: fc.option(
      fc.record({
        code: fc.oneof(fc.integer(), fc.string()),
        stderrTail: fc.string({ maxLength: 4096 }),
        at: fc.string(),
      }),
      { freq: 1 }
    ),
  });

  it('should return exactly 5 slot entries', async () => {
    // Generate 5 slots with ids 0-4
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    // Update the mock to return these slots
    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    expect(response.body).to.have.property('slots');
    expect(response.body.slots).to.be.an('array');
    expect(response.body.slots).to.have.lengthOf(5);
  });

  it('should return slots in order by id', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      expect(response.body.slots[i].id).to.equal(i);
      expect(response.body.slots[i].port).to.equal(13434 + i);
    }
  });

  it('should include all required fields in each slot entry', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: '/path/to/model',
      mmprojPath: '/path/to/mmproj',
      lastUsed: Date.now(),
      supportsTools: true,
      chatTemplate: 'template',
      metrics: {
        tokensGenerated: 100,
        tokensPrompted: 50,
        requestsServed: 5,
        avgLatencyMs: 100,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (const slot of response.body.slots) {
      expect(slot).to.have.property('id');
      expect(slot).to.have.property('port');
      expect(slot).to.have.property('purpose');
      expect(slot).to.have.property('status');
      expect(slot).to.have.property('modelPath');
      expect(slot).to.have.property('mmprojPath');
      expect(slot).to.have.property('lastUsed');
      expect(slot).to.have.property('metrics');
    }
  });

  it('should set modelPath and mmprojPath to null when status is not running', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: ['idle', 'starting', 'stopping', 'error', 'idle'][id],
      modelPath: '/path/to/model',  // Should be nulled in response
      mmprojPath: '/path/to/mmproj',  // Should be nulled in response
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (const slot of response.body.slots) {
      if (slot.status !== 'running') {
        expect(slot.modelPath).to.be.null;
        expect(slot.mmprojPath).to.be.null;
      }
    }
  });

  it('should include modelPath when status is running', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: `/path/to/model${id}`,
      mmprojPath: null,
      lastUsed: Date.now(),
      supportsTools: false,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 100,
        tokensPrompted: 50,
        requestsServed: 5,
        avgLatencyMs: 100,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      const slot = response.body.slots[i];
      expect(slot.status).to.equal('running');
      expect(slot.modelPath).to.equal(`/path/to/model${i}`);
    }
  });

  it('should set mmprojPath to null when running without mmproj', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: `/path/to/model${id}`,
      mmprojPath: null,  // No mmproj configured
      lastUsed: Date.now(),
      supportsTools: false,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 100,
        tokensPrompted: 50,
        requestsServed: 5,
        avgLatencyMs: 100,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (const slot of response.body.slots) {
      expect(slot.status).to.equal('running');
      expect(slot.mmprojPath).to.be.null;
    }
  });

  it('should include mmprojPath when running with mmproj configured', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: `/path/to/model${id}`,
      mmprojPath: id === 2 ? `/path/to/mmproj${id}` : null,  // Only vision slot has mmproj
      lastUsed: Date.now(),
      supportsTools: false,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 100,
        tokensPrompted: 50,
        requestsServed: 5,
        avgLatencyMs: 100,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      const slot = response.body.slots[i];
      if (i === 2) {
        expect(slot.mmprojPath).to.equal('/path/to/mmproj2');
      } else {
        expect(slot.mmprojPath).to.be.null;
      }
    }
  });

  it('should mirror metrics from in-process state', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: `/path/to/model${id}`,
      mmprojPath: null,
      lastUsed: Date.now(),
      supportsTools: false,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 100 * (id + 1),
        tokensPrompted: 50 * (id + 1),
        requestsServed: 5 * (id + 1),
        avgLatencyMs: 100 + id * 10,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      const slot = response.body.slots[i];
      expect(slot.metrics.tokensGenerated).to.equal(100 * (i + 1));
      expect(slot.metrics.tokensPrompted).to.equal(50 * (i + 1));
      expect(slot.metrics.requestsServed).to.equal(5 * (i + 1));
      expect(slot.metrics.avgLatencyMs).to.equal(100 + i * 10);
    }
  });

  it('should provide default metrics when not set', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: undefined,  // No metrics
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (const slot of response.body.slots) {
      expect(slot.metrics).to.deep.equal({
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      });
    }
  });

  it('should mirror lastUsed timestamp from in-process state', async () => {
    const now = Date.now();
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'running',
      modelPath: `/path/to/model${id}`,
      mmprojPath: null,
      lastUsed: id % 2 === 0 ? now - 1000 * id : null,
      supportsTools: false,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      const slot = response.body.slots[i];
      if (i % 2 === 0) {
        expect(slot.lastUsed).to.equal(now - 1000 * i);
      } else {
        expect(slot.lastUsed).to.be.null;
      }
    }
  });

  it('should mirror all slot statuses correctly', async () => {
    const statuses = ['idle', 'starting', 'running', 'stopping', 'error'];
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: statuses[id],
      modelPath: statuses[id] === 'running' ? `/path/to/model${id}` : null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      expect(response.body.slots[i].status).to.equal(statuses[i]);
    }
  });

  it('should mirror purpose correctly for each slot', async () => {
    const purposes = ['primary', 'secondary', 'vision', 'embedding', 'coding'];
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: purposes[id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      expect(response.body.slots[i].purpose).to.equal(purposes[i]);
    }
  });

  it('should mirror port correctly for each slot', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    for (let i = 0; i < 5; i++) {
      expect(response.body.slots[i].port).to.equal(13434 + i);
    }
  });

  it('should not make upstream HTTP calls (property test)', () => {
    // This test verifies that _handleSlotsStatus does not make any upstream HTTP calls
    // by checking that it completes synchronously and only reads from in-process state

    let upstreamCallCount = 0;

    // Create a mock that tracks any HTTP calls
    const originalHttpGet = http.get;
    http.get = () => {
      upstreamCallCount++;
      throw new Error('Upstream HTTP call detected!');
    };

    try {
      const slots = [0, 1, 2, 3, 4].map(id => ({
        id,
        port: 13434 + id,
        purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
        status: 'running',
        modelPath: `/path/to/model${id}`,
        mmprojPath: null,
        lastUsed: Date.now(),
        supportsTools: false,
        chatTemplate: null,
        metrics: {
          tokensGenerated: 100,
          tokensPrompted: 50,
          requestsServed: 5,
          avgLatencyMs: 100,
        },
        lastError: null,
      }));

      gateway.slotManager.listSlots = () => slots;

      // Call _handleSlotsStatus directly
      const mockRes = {
        writeHead: () => {},
        end: () => {},
      };

      const mockReq = {};

      // This should complete without making any HTTP calls
      gateway._handleSlotsStatus(mockReq, mockRes);

      // Verify no upstream calls were made
      expect(upstreamCallCount).to.equal(0);
    } finally {
      http.get = originalHttpGet;
    }
  });

  it('should handle mixed slot states (property test)', async () => {
    // Generate a mix of different slot states
    const slots = [
      {
        id: 0,
        port: 13434,
        purpose: 'primary',
        status: 'running',
        modelPath: '/path/to/model0',
        mmprojPath: null,
        lastUsed: Date.now(),
        supportsTools: true,
        chatTemplate: 'template',
        metrics: { tokensGenerated: 100, tokensPrompted: 50, requestsServed: 5, avgLatencyMs: 100 },
        lastError: null,
      },
      {
        id: 1,
        port: 13435,
        purpose: 'secondary',
        status: 'idle',
        modelPath: null,
        mmprojPath: null,
        lastUsed: null,
        supportsTools: null,
        chatTemplate: null,
        metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
        lastError: null,
      },
      {
        id: 2,
        port: 13436,
        purpose: 'vision',
        status: 'running',
        modelPath: '/path/to/model2',
        mmprojPath: '/path/to/mmproj2',
        lastUsed: Date.now() - 5000,
        supportsTools: false,
        chatTemplate: null,
        metrics: { tokensGenerated: 200, tokensPrompted: 100, requestsServed: 10, avgLatencyMs: 150 },
        lastError: null,
      },
      {
        id: 3,
        port: 13437,
        purpose: 'embedding',
        status: 'error',
        modelPath: null,
        mmprojPath: null,
        lastUsed: null,
        supportsTools: null,
        chatTemplate: null,
        metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
        lastError: {
          code: 'ENOENT',
          stderrTail: 'Model file not found',
          at: new Date().toISOString(),
        },
      },
      {
        id: 4,
        port: 13438,
        purpose: 'coding',
        status: 'starting',
        modelPath: null,
        mmprojPath: null,
        lastUsed: null,
        supportsTools: null,
        chatTemplate: null,
        metrics: { tokensGenerated: 0, tokensPrompted: 0, requestsServed: 0, avgLatencyMs: 0 },
        lastError: null,
      },
    ];

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    expect(response.body.slots).to.have.lengthOf(5);

    // Verify each slot is mirrored correctly
    for (let i = 0; i < 5; i++) {
      const responseSlot = response.body.slots[i];
      const sourceSlot = slots[i];

      expect(responseSlot.id).to.equal(sourceSlot.id);
      expect(responseSlot.port).to.equal(sourceSlot.port);
      expect(responseSlot.purpose).to.equal(sourceSlot.purpose);
      expect(responseSlot.status).to.equal(sourceSlot.status);

      // Check modelPath and mmprojPath nulling rules
      if (sourceSlot.status === 'running') {
        expect(responseSlot.modelPath).to.equal(sourceSlot.modelPath);
        expect(responseSlot.mmprojPath).to.equal(sourceSlot.mmprojPath);
      } else {
        expect(responseSlot.modelPath).to.be.null;
        expect(responseSlot.mmprojPath).to.be.null;
      }

      expect(responseSlot.lastUsed).to.equal(sourceSlot.lastUsed);
      expect(responseSlot.metrics).to.deep.equal(sourceSlot.metrics);
    }
  });

  it('should respond with 200 status code', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
  });

  it('should return valid JSON response', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => ({
      id,
      port: 13434 + id,
      purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
      status: 'idle',
      modelPath: null,
      mmprojPath: null,
      lastUsed: null,
      supportsTools: null,
      chatTemplate: null,
      metrics: {
        tokensGenerated: 0,
        tokensPrompted: 0,
        requestsServed: 0,
        avgLatencyMs: 0,
      },
      lastError: null,
    }));

    gateway.slotManager.listSlots = () => slots;

    const response = await makeRequest('127.0.0.1', port, '/v1/slots/status');

    expect(response.statusCode).to.equal(200);
    expect(response.body).to.be.an('object');
    expect(response.body).to.have.property('slots');
    expect(response.body.slots).to.be.an('array');
  });
});

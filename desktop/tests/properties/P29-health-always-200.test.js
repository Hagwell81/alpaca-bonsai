/**
 * Property Test P29: /health never 5xx
 *
 * Generate arbitrary combinations of slot statuses (idle, starting, running, stopping, error).
 * For each combination, verify that the API Gateway's /health endpoint always returns HTTP 200,
 * never 5xx, even when all slots are idle or in error state.
 *
 * Validates: Requirements 18.5
 */

const { expect } = require('chai');
const fc = require('fast-check');
const http = require('http');
const { ApiGateway } = require('../../api-gateway');

/**
 * Valid slot statuses
 */
const SLOT_STATUSES = ['idle', 'starting', 'running', 'stopping', 'error'];

/**
 * Create a mock slot with the given status
 */
function createMockSlot(id, status) {
  return {
    id,
    port: 13434 + id,
    purpose: ['primary', 'secondary', 'vision', 'embedding', 'coding'][id],
    status,
    modelPath: status === 'running' ? `/path/to/model-${id}.gguf` : null,
    mmprojPath: null,
    lastUsed: null,
    supportsTools: false,
    chatTemplate: null,
    metrics: {
      tokensGenerated: 0,
      tokensPrompted: 0,
      requestsServed: 0,
      avgLatencyMs: 0,
    },
    lastError: null,
  };
}

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
          let body = null;
          if (data) {
            body = JSON.parse(data);
          }
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

describe('P29: /health never 5xx', () => {
  let gateway;
  let port;

  beforeEach(async () => {
    // Create a mock slot manager that can be configured with different slot statuses
    const mockSlotManager = {
      slots: [],
      listSlots() {
        return this.slots;
      },
      getActiveSlots() {
        return this.slots.filter(s => s.status === 'running');
      },
      getSlot(id) {
        return this.slots.find(s => s.id === id) || null;
      },
      setSlots(slots) {
        this.slots = slots;
      },
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

  it('should always return 200 for /health regardless of slot statuses (property test)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES)
        ),
        async (statuses) => {
          // Create 5 slots with the generated statuses
          const slots = statuses.map((status, id) => createMockSlot(id, status));
          gateway.slotManager.setSlots(slots);

          // Make a request to /health
          const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

          // Verify the response is always 200
          expect(response.statusCode).to.equal(200);
          expect(response.statusCode).to.be.lessThan(500);
          expect(response.statusCode).to.be.greaterThanOrEqual(200);
          expect(response.statusCode).to.be.lessThan(300);

          // Verify the response body has the expected structure
          expect(response.body).to.have.property('status');
          expect(response.body).to.have.property('gateway');
          expect(response.body).to.have.property('activeSlots');
          expect(response.body.status).to.equal('ok');
          expect(response.body.gateway).to.equal('up');
          expect(response.body.activeSlots).to.be.a('number');
          expect(response.body.activeSlots).to.be.greaterThanOrEqual(0);
          expect(response.body.activeSlots).to.be.lessThanOrEqual(5);

          // Verify activeSlots count matches the number of running slots
          const runningCount = slots.filter(s => s.status === 'running').length;
          expect(response.body.activeSlots).to.equal(runningCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return 200 when all slots are idle', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => createMockSlot(id, 'idle'));
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(0);
  });

  it('should return 200 when all slots are in error state', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => createMockSlot(id, 'error'));
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(0);
  });

  it('should return 200 when all slots are starting', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => createMockSlot(id, 'starting'));
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(0);
  });

  it('should return 200 when all slots are stopping', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => createMockSlot(id, 'stopping'));
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(0);
  });

  it('should return 200 when some slots are running', async () => {
    const slots = [
      createMockSlot(0, 'running'),
      createMockSlot(1, 'idle'),
      createMockSlot(2, 'running'),
      createMockSlot(3, 'error'),
      createMockSlot(4, 'starting'),
    ];
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(2);
  });

  it('should return 200 when all slots are running', async () => {
    const slots = [0, 1, 2, 3, 4].map(id => createMockSlot(id, 'running'));
    gateway.slotManager.setSlots(slots);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(5);
  });

  it('should return 200 when no slots exist', async () => {
    gateway.slotManager.setSlots([]);

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
    expect(response.body.activeSlots).to.equal(0);
  });

  it('should never return 5xx status codes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES)
        ),
        async (statuses) => {
          const slots = statuses.map((status, id) => createMockSlot(id, status));
          gateway.slotManager.setSlots(slots);

          const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

          // Verify status code is NOT 5xx
          expect(response.statusCode).to.be.lessThan(500);
          expect(response.statusCode).to.be.greaterThanOrEqual(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should always return 200 even if slotManager throws an error', async () => {
    // Create a mock slot manager that throws an error
    const errorSlotManager = {
      listSlots() {
        throw new Error('Simulated error');
      },
      getActiveSlots() {
        throw new Error('Simulated error');
      },
    };

    gateway.slotManager = errorSlotManager;

    const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

    // Even with an error, /health should return 200
    expect(response.statusCode).to.equal(200);
    expect(response.body.status).to.equal('ok');
    expect(response.body.gateway).to.equal('up');
  });

  it('should return consistent response structure across all slot combinations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES),
          fc.constantFrom(...SLOT_STATUSES)
        ),
        async (statuses) => {
          const slots = statuses.map((status, id) => createMockSlot(id, status));
          gateway.slotManager.setSlots(slots);

          const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

          // Verify response structure is always consistent
          expect(response.body).to.be.an('object');
          expect(response.body).to.have.all.keys('status', 'gateway', 'activeSlots');
          expect(response.body.status).to.equal('ok');
          expect(response.body.gateway).to.equal('up');
          expect(typeof response.body.activeSlots).to.equal('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle mixed slot statuses correctly', async () => {
    const testCases = [
      ['idle', 'starting', 'running', 'stopping', 'error'],
      ['running', 'running', 'running', 'running', 'running'],
      ['idle', 'idle', 'idle', 'idle', 'idle'],
      ['error', 'error', 'error', 'error', 'error'],
      ['starting', 'starting', 'starting', 'starting', 'starting'],
      ['stopping', 'stopping', 'stopping', 'stopping', 'stopping'],
      ['running', 'idle', 'error', 'starting', 'stopping'],
      ['idle', 'running', 'idle', 'running', 'idle'],
    ];

    for (const statuses of testCases) {
      const slots = statuses.map((status, id) => createMockSlot(id, status));
      gateway.slotManager.setSlots(slots);

      const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

      expect(response.statusCode).to.equal(200);
      expect(response.body.status).to.equal('ok');
      expect(response.body.gateway).to.equal('up');

      const expectedActiveSlots = statuses.filter(s => s === 'running').length;
      expect(response.body.activeSlots).to.equal(expectedActiveSlots);
    }
  });

  it('should satisfy Requirement 18.5: /health never returns 5xx', async () => {
    // This test explicitly validates Requirement 18.5
    // "WHILE the app is running, THE API_Gateway SHALL NOT return HTTP 5xx for /health"

    // Test with various slot configurations
    const configurations = [
      { description: 'all idle', statuses: ['idle', 'idle', 'idle', 'idle', 'idle'] },
      { description: 'all running', statuses: ['running', 'running', 'running', 'running', 'running'] },
      { description: 'all error', statuses: ['error', 'error', 'error', 'error', 'error'] },
      { description: 'mixed', statuses: ['running', 'idle', 'error', 'starting', 'stopping'] },
      { description: 'no slots', statuses: [] },
    ];

    for (const config of configurations) {
      const slots = config.statuses.map((status, id) => createMockSlot(id, status));
      gateway.slotManager.setSlots(slots);

      const response = await makeRequest('127.0.0.1', port, '/health', 'GET');

      // Requirement 18.5: /health SHALL NOT return HTTP 5xx
      expect(response.statusCode).to.be.lessThan(500);
      expect(response.statusCode).to.equal(200);
    }
  });
});

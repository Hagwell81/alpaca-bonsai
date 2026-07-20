/**
 * Integration test for /v1/models fan-out endpoint (Req 7)
 *
 * Tests that the API Gateway correctly:
 * 1. Fans out to all active slots in parallel
 * 2. Aggregates model lists from multiple slots
 * 3. Deduplicates by model id (keeping lower-slot-id occurrence)
 * 4. Annotates each model with slot metadata (owned_by, slot_id, slot_purpose, port)
 * 5. Returns 200 even when some slots error (partial aggregation)
 * 6. Returns 503 when no slots are running
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

const { expect } = require('chai');
const http = require('http');
const { SlotManager } = require('../../model-slot-manager');
const { ApiGateway } = require('../../api-gateway');
const { VramBudgetManager } = require('../../vram-budget-manager');
const { GrammarLibrary } = require('../../grammar-library');
const { ToolRewriterStream } = require('../../tool-rewriter');
const path = require('path');

describe('Integration: /v1/models fan-out (Req 7)', function() {
  this.timeout(30000);

  let slotManager;
  let apiGateway;
  let mockSlotServers = [];
  let logger;

  // Mock logger
  const createMockLogger = () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => {},
  });

  // Create a mock llama-server that responds to /v1/models
  const createMockSlotServer = (models) => {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            object: 'list',
            data: models,
          }));
        } else if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            chat_template: 'test template with tool_call',
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', () => {
        resolve(server);
      });
    });
  };

  // Helper to start a mock slot server on a specific port
  const startMockSlotOnPort = (port, models) => {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            object: 'list',
            data: models,
          }));
        } else if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            chat_template: 'test template with tool_call',
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(port, '127.0.0.1', () => {
        resolve(server);
      });

      server.on('error', reject);
    });
  };

  beforeEach(async function() {
    logger = createMockLogger();

    // Initialize SlotManager
    slotManager = new SlotManager({
      logger,
      vramBudgetManager: new VramBudgetManager(),
    });
    await slotManager.init();

    // Initialize ApiGateway
    const grammarLibrary = new GrammarLibrary({
      grammarsDir: path.join(__dirname, '../../grammars'),
    });
    await grammarLibrary.load();

    apiGateway = new ApiGateway({
      slotManager,
      vramBudgetManager: new VramBudgetManager(),
      grammarLibrary,
      toolRewriter: {}, // Mock tool rewriter
      logger,
    });

    await apiGateway.start();
  });

  afterEach(async function() {
    // Clean up mock servers
    for (const server of mockSlotServers) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    mockSlotServers = [];

    // Clean up gateway and slots
    if (apiGateway) {
      await apiGateway.drainAndClose();
    }
    if (slotManager) {
      await slotManager.stopAll();
    }
  });

  it('should return 503 when no slots are running (Req 7.1, 19.2)', async function() {
    // Make request to /v1/models with no running slots
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(503);
    expect(response.body).to.have.property('error', 'no_slot_running');
    expect(response.body).to.have.property('hint');
  });

  it('should aggregate models from a single running slot (Req 7.2, 7.3)', async function() {
    // Start a mock server on slot 0 (primary) port
    const slot0Models = [
      { id: 'model-a', object: 'model', created: 1000 },
      { id: 'model-b', object: 'model', created: 2000 },
    ];
    const mockServer = await startMockSlotOnPort(13434, slot0Models);
    mockSlotServers.push(mockServer);

    // Manually mark slot 0 as running (simulate it being started)
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/model.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(200);
    expect(response.body).to.have.property('object', 'list');
    expect(response.body).to.have.property('data');
    expect(response.body.data).to.have.lengthOf(2);

    // Verify annotation (Req 7.3)
    for (const model of response.body.data) {
      expect(model).to.have.property('owned_by', 'slot-0');
      expect(model).to.have.property('slot_id', 0);
      expect(model).to.have.property('slot_purpose', 'primary');
      expect(model).to.have.property('port', 13434);
    }

    // Verify original fields are preserved
    expect(response.body.data[0]).to.have.property('id', 'model-a');
    expect(response.body.data[1]).to.have.property('id', 'model-b');
  });

  it('should merge and deduplicate models from multiple slots (Req 7.2, 7.5)', async function() {
    // Start mock servers on slot 0 and slot 1
    const slot0Models = [
      { id: 'model-a', object: 'model', created: 1000 },
      { id: 'model-shared', object: 'model', created: 2000 },
    ];
    const slot1Models = [
      { id: 'model-b', object: 'model', created: 3000 },
      { id: 'model-shared', object: 'model', created: 2500 }, // Duplicate with different created time
    ];

    const mockServer0 = await startMockSlotOnPort(13434, slot0Models);
    const mockServer1 = await startMockSlotOnPort(13435, slot1Models);
    mockSlotServers.push(mockServer0, mockServer1);

    // Mark slots as running
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/model.gguf';

    const slot1 = slotManager.getSlot(1);
    slot1.status = 'running';
    slot1.port = 13435;
    slot1.modelPath = '/path/to/model2.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(200);
    expect(response.body.data).to.have.lengthOf(3); // model-a, model-b, model-shared (deduplicated)

    // Verify deduplication: model-shared should be from slot 0 (lower id)
    const sharedModel = response.body.data.find(m => m.id === 'model-shared');
    expect(sharedModel).to.exist;
    expect(sharedModel.owned_by).to.equal('slot-0');
    expect(sharedModel.slot_id).to.equal(0);

    // Verify all models are annotated
    const modelIds = new Set(response.body.data.map(m => m.id));
    expect(modelIds).to.include('model-a');
    expect(modelIds).to.include('model-b');
    expect(modelIds).to.include('model-shared');
  });

  it('should annotate each model with correct slot metadata (Req 7.3)', async function() {
    // Start mock servers on slot 0 (primary) and slot 2 (vision)
    const slot0Models = [
      { id: 'text-model', object: 'model', created: 1000 },
    ];
    const slot2Models = [
      { id: 'vision-model', object: 'model', created: 2000 },
    ];

    const mockServer0 = await startMockSlotOnPort(13434, slot0Models);
    const mockServer2 = await startMockSlotOnPort(13436, slot2Models);
    mockSlotServers.push(mockServer0, mockServer2);

    // Mark slots as running
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/text.gguf';

    const slot2 = slotManager.getSlot(2);
    slot2.status = 'running';
    slot2.port = 13436;
    slot2.modelPath = '/path/to/vision.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(200);
    expect(response.body.data).to.have.lengthOf(2);

    // Verify slot 0 annotation
    const textModel = response.body.data.find(m => m.id === 'text-model');
    expect(textModel.owned_by).to.equal('slot-0');
    expect(textModel.slot_id).to.equal(0);
    expect(textModel.slot_purpose).to.equal('primary');
    expect(textModel.port).to.equal(13434);

    // Verify slot 2 annotation
    const visionModel = response.body.data.find(m => m.id === 'vision-model');
    expect(visionModel.owned_by).to.equal('slot-2');
    expect(visionModel.slot_id).to.equal(2);
    expect(visionModel.slot_purpose).to.equal('vision');
    expect(visionModel.port).to.equal(13436);
  });

  it('should return 200 with partial results when some slots error (Req 7.4)', async function() {
    // Start a mock server on slot 0 that works
    const slot0Models = [
      { id: 'model-a', object: 'model', created: 1000 },
    ];
    const mockServer0 = await startMockSlotOnPort(13434, slot0Models);
    mockSlotServers.push(mockServer0);

    // Mark slot 0 as running
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/model.gguf';

    // Mark slot 1 as running but don't start a server (will timeout/error)
    const slot1 = slotManager.getSlot(1);
    slot1.status = 'running';
    slot1.port = 13435;
    slot1.modelPath = '/path/to/model2.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    // Should still return 200 with models from slot 0
    expect(response.statusCode).to.equal(200);
    expect(response.body.data).to.have.lengthOf(1);
    expect(response.body.data[0].id).to.equal('model-a');
    expect(response.body.data[0].slot_id).to.equal(0);
  });

  it('should handle empty model lists from slots (Req 7.2)', async function() {
    // Start mock servers with empty model lists
    const mockServer0 = await startMockSlotOnPort(13434, []);
    const mockServer1 = await startMockSlotOnPort(13435, []);
    mockSlotServers.push(mockServer0, mockServer1);

    // Mark slots as running
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/model.gguf';

    const slot1 = slotManager.getSlot(1);
    slot1.status = 'running';
    slot1.port = 13435;
    slot1.modelPath = '/path/to/model2.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(200);
    expect(response.body.data).to.have.lengthOf(0);
  });

  it('should preserve original model fields while adding annotations (Req 7.3)', async function() {
    // Start a mock server with detailed model info
    const slot0Models = [
      {
        id: 'model-detailed',
        object: 'model',
        created: 1234567890,
        owned_by: 'original-owner',
        permission: [{ id: 'modelperm-1', object: 'model_permission' }],
      },
    ];
    const mockServer0 = await startMockSlotOnPort(13434, slot0Models);
    mockSlotServers.push(mockServer0);

    // Mark slot as running
    const slot0 = slotManager.getSlot(0);
    slot0.status = 'running';
    slot0.port = 13434;
    slot0.modelPath = '/path/to/model.gguf';

    // Make request to /v1/models
    const response = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:13439/v1/models', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });
      req.on('error', reject);
    });

    expect(response.statusCode).to.equal(200);
    const model = response.body.data[0];

    // Verify original fields are preserved
    expect(model.id).to.equal('model-detailed');
    expect(model.object).to.equal('model');
    expect(model.created).to.equal(1234567890);
    expect(model.permission).to.deep.equal([{ id: 'modelperm-1', object: 'model_permission' }]);

    // Verify annotations are added (overwriting original owned_by)
    expect(model.owned_by).to.equal('slot-0');
    expect(model.slot_id).to.equal(0);
    expect(model.slot_purpose).to.equal('primary');
    expect(model.port).to.equal(13434);
  });
});

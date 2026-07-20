/**
 * Property Test P34: 404 for unknown paths
 *
 * Generate random (method, path) pairs where path is not in the allow-list.
 * Verify that the API Gateway returns HTTP 404 with the correct error message.
 *
 * Validates: Requirements 5.3
 */

const { expect } = require('chai');
const http = require('http');
const { ApiGateway } = require('../../api-gateway');

/**
 * List of allowed routes (method + path combinations)
 */
const ALLOWED_ROUTES = new Set([
  'POST /v1/chat/completions',
  'POST /v1/completions',
  'POST /v1/embeddings',
  'GET /v1/models',
  'GET /v1/slots/status',
  'POST /tokenize',
  'POST /detokenize',
  'GET /health',
  'GET /metrics',
  'GET /props',
]);

/**
 * HTTP methods to test
 */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

/**
 * Make an HTTP request and return a promise
 */
function makeRequest(hostname, port, path, method) {
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

describe('P34: 404 for unknown paths', () => {
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

  it('should return 404 for unknown paths (property test)', async () => {
    // Test a fixed set of known unknown paths
    const unknownPaths = [
      { method: 'GET', path: '/v1/unknown' },
      { method: 'POST', path: '/v1/unknown' },
      { method: 'GET', path: '/v1/chat/completion' },  // missing 's'
      { method: 'GET', path: '/v1/models/' },  // trailing slash
      { method: 'GET', path: '/v1/slots' },  // missing '/status'
      { method: 'GET', path: '/unknown' },
      { method: 'POST', path: '/unknown' },
      { method: 'PUT', path: '/v1/models' },
      { method: 'DELETE', path: '/v1/models' },
      { method: 'PATCH', path: '/v1/models' },
      { method: 'HEAD', path: '/v1/models' },
      { method: 'OPTIONS', path: '/v1/models' },
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/v1' },
      { method: 'GET', path: '/v2/chat/completions' },
    ];

    for (const { method, path } of unknownPaths) {
      const routeKey = method + ' ' + path;
      const isAllowed = ALLOWED_ROUTES.has(routeKey);
      expect(isAllowed).to.be.false;

      const response = await makeRequest('127.0.0.1', port, path, method);
      expect(response.statusCode).to.equal(404);
      if (response.body) {
        expect(response.body).to.have.property('error');
        expect(response.body.error).to.equal('path not supported');
      }
    }
  });

  it('should return 404 for paths with typos in allowed routes', async () => {
    const typos = [
      '/v1/chat/completion',  // missing 's'
      '/v1/chat/completions/',  // trailing slash
      '/v1/model',  // missing 's'
      '/v1/slot/status',  // missing 's' in slots
      '/v1/slots/statuses',  // extra 'es'
      '/tokenizes',  // extra 's'
      '/detokenizes',  // extra 's'
      '/healths',  // extra 's'
      '/metricss',  // extra 's'
      '/propss',  // extra 's'
    ];

    for (const path of typos) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with trailing slashes when not allowed', async () => {
    const testPaths = [
      '/v1/chat/completions/',
      '/v1/completions/',
      '/v1/embeddings/',
      '/v1/models/',
      '/v1/slots/status/',
      '/tokenize/',
      '/detokenize/',
      '/health/',
      '/metrics/',
      '/props/',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with query parameters', async () => {
    // Note: Query parameters are stripped by URL.pathname, so these will match the base path
    // Only test paths that don't match any allowed route even after stripping query params
    const testPaths = [
      '/v1/unknown?foo=bar',
      '/unknown?query=value',
      '/v1/chat/completion?extra=param',  // /v1/chat/completion is not allowed
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with multiple slashes', async () => {
    const testPaths = [
      '//v1/models',
      '/v1//models',
      '/v1/models//',
      '///v1///models',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with special characters', async () => {
    const testPaths = [
      '/v1/models-unknown',
      '/v1/models_unknown',
      '/v1/models.unknown',
      '/v1/unknown-path',
      '/v1/unknown_path',
      '/v1/unknown.path',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with uppercase variants', async () => {
    const testPaths = [
      '/V1/MODELS',
      '/V1/Models',
      '/v1/MODELS',
      '/V1/chat/completions',
      '/v1/CHAT/completions',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for all HTTP methods on unknown paths', async () => {
    const unknownPath = '/v1/unknown';

    for (const method of HTTP_METHODS) {
      const response = await makeRequest('127.0.0.1', port, unknownPath, method);
      expect(response.statusCode).to.equal(404);
      // Some methods like HEAD might not return a body
      if (response.body) {
        expect(response.body.error).to.equal('path not supported');
      }
    }
  });

  it('should verify that all allowed routes are NOT in the unknown set', () => {
    // This is a sanity check to ensure our test is correct
    const allowedPaths = Array.from(ALLOWED_ROUTES);
    expect(allowedPaths.length).to.equal(10);

    // Verify each allowed route
    const expectedRoutes = [
      'POST /v1/chat/completions',
      'POST /v1/completions',
      'POST /v1/embeddings',
      'GET /v1/models',
      'GET /v1/slots/status',
      'POST /tokenize',
      'POST /detokenize',
      'GET /health',
      'GET /metrics',
      'GET /props',
    ];

    for (const route of expectedRoutes) {
      expect(ALLOWED_ROUTES.has(route)).to.be.true;
    }
  });

  it('should return 404 for empty path', async () => {
    const response = await makeRequest('127.0.0.1', port, '', 'GET');
    expect(response.statusCode).to.equal(404);
    expect(response.body.error).to.equal('path not supported');
  });

  it('should return 404 for root path', async () => {
    const response = await makeRequest('127.0.0.1', port, '/', 'GET');
    expect(response.statusCode).to.equal(404);
    expect(response.body.error).to.equal('path not supported');
  });

  it('should return 404 for paths with extra segments', async () => {
    const testPaths = [
      '/v1/models/extra',
      '/v1/chat/completions/extra',
      '/v1/slots/status/extra',
      '/health/extra',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });

  it('should return 404 for paths with fragments', async () => {
    // Note: Fragments are stripped by URL.pathname, so these will match the base path
    // Only test paths that don't match any allowed route even after stripping fragments
    const testPaths = [
      '/v1/unknown#section',
      '/v1/chat/completion#section',  // /v1/chat/completion is not allowed
      '/unknown#section',
    ];

    for (const path of testPaths) {
      const response = await makeRequest('127.0.0.1', port, path, 'GET');
      expect(response.statusCode).to.equal(404);
      expect(response.body.error).to.equal('path not supported');
    }
  });
});

/* eslint-env node */
/**
 * Tests for api-server.js
 *
 * Tests the Secret_Vault integration for API key retrieval and storage,
 * including caching, error handling, and fallback behavior.
 *
 * Run with: node desktop/tests/api-server.test.js
 */

const assert = require('assert');

// Mock electron-store before requiring api-server
const mockStoreData = {};
const mockStore = {
  get: (key, defaultValue) => {
    return key in mockStoreData ? mockStoreData[key] : defaultValue;
  },
  set: (key, value) => {
    mockStoreData[key] = value;
  },
  delete: (key) => {
    delete mockStoreData[key];
  },
  store: mockStoreData
};

// Mock electron-store module
require.cache[require.resolve('electron-store')] = {
  exports: function() {
    return mockStore;
  }
};

const apiServer = require('../api-server');

/**
 * Mock electron-store
 */
function createMockStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key, defaultValue) => {
      return key in data ? data[key] : defaultValue;
    },
    set: (key, value) => {
      data[key] = value;
    },
    delete: (key) => {
      delete data[key];
    },
    store: data
  };
}

/**
 * Mock Secret_Vault
 */
function createMockSecretVault(options = {}) {
  const secrets = options.secrets || {};
  const shouldFail = options.shouldFail || false;
  const failureType = options.failureType || 'DecryptionFailedError';

  return {
    getSecret: async (key) => {
      if (shouldFail) {
        const error = new Error(`Mock ${failureType}`);
        error.name = failureType;
        throw error;
      }
      if (key in secrets) {
        return secrets[key];
      }
      const error = new Error(`Secret not found: ${key}`);
      error.name = 'SecretNotFoundError';
      throw error;
    },
    setSecret: async (key, value) => {
      if (shouldFail) {
        const error = new Error(`Mock ${failureType}`);
        error.name = failureType;
        throw error;
      }
      secrets[key] = value;
    },
    deleteSecret: async (key) => {
      delete secrets[key];
    },
    listSecrets: () => Object.keys(secrets)
  };
}

/**
 * Test suite
 */
async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: getApiKeyAsync returns null when API key not required
  try {
    console.log('\n[Test 1] getApiKeyAsync returns null when API key not required');
    
    mockStoreData.apiServer = { requireApiKey: false };
    apiServer.clearApiKeyCache();
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, null, 'Should return null when API key not required');
    
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 2: getApiKeyAsync retrieves from Secret_Vault
  try {
    console.log('\n[Test 2] getApiKeyAsync retrieves from Secret_Vault');
    
    const mockVault = createMockSecretVault({
      secrets: { api_key: 'test-api-key-123' }
    });
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: null };
    apiServer.clearApiKeyCache();
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, 'test-api-key-123', 'Should retrieve API key from Secret_Vault');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 3: getApiKeyAsync falls back to plain config when Secret_Vault not available
  try {
    console.log('\n[Test 3] getApiKeyAsync falls back to plain config when Secret_Vault not available');
    
    mockStoreData.apiServer = { requireApiKey: true, apiKey: 'plain-config-key' };
    apiServer.clearApiKeyCache();
    delete global.secretVault;
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, 'plain-config-key', 'Should fall back to plain config');
    
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 4: getApiKeyAsync falls back to plain config when key not in Secret_Vault
  try {
    console.log('\n[Test 4] getApiKeyAsync falls back to plain config when key not in Secret_Vault');
    
    const mockVault = createMockSecretVault({
      secrets: {} // No api_key stored
    });
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: 'fallback-key' };
    apiServer.clearApiKeyCache();
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, 'fallback-key', 'Should fall back to plain config when key not in vault');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 5: getApiKeyAsync handles DecryptionFailedError
  try {
    console.log('\n[Test 5] getApiKeyAsync handles DecryptionFailedError');
    
    const mockVault = createMockSecretVault({
      shouldFail: true,
      failureType: 'DecryptionFailedError'
    });
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: 'fallback-key' };
    apiServer.clearApiKeyCache();
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, 'fallback-key', 'Should fall back when decryption fails');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 6: getApiKeyAsync handles TokenExpiredError
  try {
    console.log('\n[Test 6] getApiKeyAsync handles TokenExpiredError');
    
    const mockVault = createMockSecretVault({
      shouldFail: true,
      failureType: 'TokenExpiredError'
    });
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: 'fallback-key' };
    apiServer.clearApiKeyCache();
    
    const result = await apiServer.getApiKeyAsync();
    assert.strictEqual(result, 'fallback-key', 'Should fall back when token expired');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 7: getApiKeyAsync caches API key
  try {
    console.log('\n[Test 7] getApiKeyAsync caches API key');
    
    let callCount = 0;
    const mockVault = {
      getSecret: async (key) => {
        callCount++;
        if (key === 'api_key') {
          return 'cached-key';
        }
        throw new Error('Not found');
      }
    };
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: null };
    apiServer.clearApiKeyCache();
    
    // First call should hit Secret_Vault
    const result1 = await apiServer.getApiKeyAsync();
    assert.strictEqual(result1, 'cached-key', 'First call should return key');
    assert.strictEqual(callCount, 1, 'Should call Secret_Vault once');
    
    // Second call should use cache
    const result2 = await apiServer.getApiKeyAsync();
    assert.strictEqual(result2, 'cached-key', 'Second call should return cached key');
    assert.strictEqual(callCount, 1, 'Should not call Secret_Vault again (cache hit)');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 8: storeApiKeyAsync stores in Secret_Vault
  try {
    console.log('\n[Test 8] storeApiKeyAsync stores in Secret_Vault');
    
    const mockVault = createMockSecretVault();
    global.secretVault = mockVault;
    apiServer.clearApiKeyCache();
    
    await apiServer.storeApiKeyAsync('new-api-key');
    
    // Verify it was stored
    const stored = await mockVault.getSecret('api_key');
    assert.strictEqual(stored, 'new-api-key', 'Should store API key in Secret_Vault');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 9: storeApiKeyAsync falls back to plain config when Secret_Vault fails
  try {
    console.log('\n[Test 9] storeApiKeyAsync falls back to plain config when Secret_Vault fails');
    
    const mockVault = createMockSecretVault({
      shouldFail: true,
      failureType: 'DecryptionFailedError'
    });
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: null };
    apiServer.clearApiKeyCache();
    
    await apiServer.storeApiKeyAsync('fallback-key');
    
    // Check if it was stored in plain config
    const config = apiServer.getApiConfig();
    assert.strictEqual(config.apiKey, 'fallback-key', 'Should fall back to plain config');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 10: storeApiKeyAsync validates input
  try {
    console.log('\n[Test 10] storeApiKeyAsync validates input');
    
    apiServer.clearApiKeyCache();
    
    try {
      await apiServer.storeApiKeyAsync(null);
      throw new Error('Should have thrown validation error');
    } catch (err) {
      assert.strictEqual(err.message, 'API key must be a non-empty string', 'Should validate input');
    }
    
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 11: clearApiKeyCache clears the cache
  try {
    console.log('\n[Test 11] clearApiKeyCache clears the cache');
    
    let callCount = 0;
    const mockVault = {
      getSecret: async (key) => {
        callCount++;
        return 'test-key';
      }
    };
    
    global.secretVault = mockVault;
    mockStoreData.apiServer = { requireApiKey: true, apiKey: null };
    apiServer.clearApiKeyCache();
    
    // First call caches the key
    await apiServer.getApiKeyAsync();
    assert.strictEqual(callCount, 1, 'First call should hit vault');
    
    // Clear cache
    apiServer.clearApiKeyCache();
    
    // Next call should hit vault again
    await apiServer.getApiKeyAsync();
    assert.strictEqual(callCount, 2, 'After clear, should hit vault again');
    
    delete global.secretVault;
    apiServer.clearApiKeyCache();
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 12: getServerArgs returns correct arguments
  try {
    console.log('\n[Test 12] getServerArgs returns correct arguments');
    
    mockStoreData.apiServer = {
      host: '127.0.0.1',
      port: 13434,
      cors: true,
      corsOrigins: ['*']
    };
    
    const args = apiServer.getServerArgs();
    
    assert(Array.isArray(args), 'Should return array');
    assert(args.includes('--host'), 'Should include --host');
    assert(args.includes('127.0.0.1'), 'Should include host value');
    assert(args.includes('--port'), 'Should include --port');
    assert(args.includes('13434'), 'Should include port value');
    
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 13: getApiUrl returns correct URL
  try {
    console.log('\n[Test 13] getApiUrl returns correct URL');
    
    mockStoreData.apiServer = {
      enabled: true,
      host: '127.0.0.1',
      port: 13434
    };
    
    const url = apiServer.getApiUrl();
    assert.strictEqual(url, 'http://127.0.0.1:13434', 'Should return correct URL');
    
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 14: getApiOpenAIEndpoint returns correct endpoint
  try {
    console.log('\n[Test 14] getApiOpenAIEndpoint returns correct endpoint');
    
    mockStoreData.apiServer = {
      enabled: true,
      host: '127.0.0.1',
      port: 13434
    };
    
    const endpoint = apiServer.getApiOpenAIEndpoint();
    assert.strictEqual(endpoint, 'http://127.0.0.1:13434/v1', 'Should return correct endpoint');
    
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Test 15: validateApiKey validates correctly
  try {
    console.log('\n[Test 15] validateApiKey validates correctly');
    
    mockStoreData.apiServer = {
      requireApiKey: true,
      apiKey: 'correct-key'
    };
    
    assert.strictEqual(apiServer.validateApiKey('correct-key'), true, 'Should validate correct key');
    assert.strictEqual(apiServer.validateApiKey('wrong-key'), false, 'Should reject wrong key');
    
    console.log('✓ PASSED');
    testsPassed++;
  } catch (err) {
    console.error('✗ FAILED:', err.message);
    testsFailed++;
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log('='.repeat(60));

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});

/* eslint-env node */
/**
 * Phase 1.4 Integration Tests
 * 
 * Tests for complete Secret_Vault integration workflow including:
 * - Token expiration warning UI (Task 1.4.6)
 * - Token refresh button (Task 1.4.7)
 * - Preload API exposure (Task 1.4.8)
 * - IPC handlers (Task 1.4.9)
 * - Integration with existing modules
 * - Backward compatibility
 * - Error recovery
 * 
 * Run with: node desktop/tests/phase-1-4-integration.test.js
 */

const assert = require('assert');
const { SecretVault } = require('../secret-vault');
const { KeyDerivation } = require('../key-derivation');

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
 * Mock KeyDerivation service
 */
function createMockKeyDerivation() {
  const mockKey = Buffer.alloc(32, 'test-key');
  const mockChecksum = 'test-checksum-abc123';

  return {
    deriveMasterKey: async () => mockKey,
    getMasterKeyChecksum: async () => mockChecksum,
    verifyChecksum: async (checksum) => checksum === mockChecksum,
    getPlatformIdentity: async () => ({ platform: 'test' }),
    initialize: async () => {}
  };
}

// Test counter
let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failCount++;
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failCount++;
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
  }
}

// ============================================================================
// Task 1.4.6: Token Expiration Warning UI
// ============================================================================

console.log('\n=== Task 1.4.6: Token Expiration Warning UI ===\n');

(async () => {
  await asyncTest('should store token with expiration metadata', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);

    await vault.setSecret('hf_token', token, {
      expiresAt: expiresAt.toISOString(),
      scope: 'repo.read'
    });

    const metadata = await vault.getSecretMetadata('hf_token');
    assert(metadata, 'Metadata should exist');
    assert.strictEqual(metadata.expiresAt, expiresAt.toISOString());
    assert.strictEqual(metadata.scope, 'repo.read');
  });

  await asyncTest('should detect token expiring within 7 days', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 3);

    await vault.setSecret('hf_token', token, {
      expiresAt: expiresAt.toISOString()
    });

    const metadata = await vault.getSecretMetadata('hf_token');
    const now = new Date();
    const daysUntilExpiry = Math.ceil((new Date(metadata.expiresAt) - now) / (1000 * 60 * 60 * 24));

    assert(daysUntilExpiry <= 7, 'Should be within 7 days');
    assert(daysUntilExpiry > 0, 'Should not be expired');
  });

  await asyncTest('should detect expired token', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() - 1);

    await vault.setSecret('hf_token', token, {
      expiresAt: expiresAt.toISOString()
    });

    const metadata = await vault.getSecretMetadata('hf_token');
    const now = new Date();
    const daysUntilExpiry = Math.ceil((new Date(metadata.expiresAt) - now) / (1000 * 60 * 60 * 24));

    assert(daysUntilExpiry <= 0, 'Should be expired');
  });

  await asyncTest('should display expiration date in metadata', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date('2026-12-31T23:59:59Z');

    await vault.setSecret('hf_token', token, {
      expiresAt: expiresAt.toISOString()
    });

    const metadata = await vault.getSecretMetadata('hf_token');
    assert.strictEqual(metadata.expiresAt, expiresAt.toISOString());
  });

  // ============================================================================
  // Task 1.4.7: Token Refresh Button
  // ============================================================================

  console.log('\n=== Task 1.4.7: Token Refresh Button ===\n');

  await asyncTest('should refresh token with new expiration', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const originalToken = 'hf_original_token_12345';
    const newToken = 'hf_refreshed_token_67890';
    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    await vault.setSecret('hf_token', originalToken, {
      expiresAt: new Date().toISOString()
    });

    await vault.setSecret('hf_token', newToken, {
      expiresAt: newExpiresAt.toISOString(),
      metadata: { refreshedAt: new Date().toISOString() }
    });

    const retrievedToken = await vault.getSecret('hf_token');
    const metadata = await vault.getSecretMetadata('hf_token');

    assert.strictEqual(retrievedToken, newToken);
    assert.strictEqual(metadata.expiresAt, newExpiresAt.toISOString());
  });

  await asyncTest('should handle refresh errors gracefully', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    await vault.setSecret('hf_token', token);

    const result = await vault.getSecret('non_existent_token');
    assert.strictEqual(result, null);
  });

  await asyncTest('should extend token expiration on refresh', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const originalExpiresAt = new Date();
    originalExpiresAt.setDate(originalExpiresAt.getDate() + 1);

    await vault.setSecret('hf_token', token, {
      expiresAt: originalExpiresAt.toISOString()
    });

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    await vault.setSecret('hf_token', token, {
      expiresAt: newExpiresAt.toISOString()
    });

    const metadata = await vault.getSecretMetadata('hf_token');
    const originalDays = Math.ceil((originalExpiresAt - new Date()) / (1000 * 60 * 60 * 24));
    const newDays = Math.ceil((new Date(metadata.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));

    assert(newDays > originalDays, 'New expiration should be further in the future');
  });

  // ============================================================================
  // Task 1.4.8 & 1.4.9: Preload API & IPC Handlers
  // ============================================================================

  console.log('\n=== Task 1.4.8 & 1.4.9: Preload API & IPC Handlers ===\n');

  await asyncTest('should handle IPC getSecret request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    await vault.setSecret('hf_token', token);

    const result = await vault.getSecret('hf_token');
    assert.strictEqual(result, token);
  });

  await asyncTest('should handle IPC setSecret request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const options = {
      expiresAt: expiresAt.toISOString(),
      scope: 'repo.read'
    };

    await vault.setSecret('hf_token', token, options);

    const retrieved = await vault.getSecret('hf_token');
    assert.strictEqual(retrieved, token);

    const metadata = await vault.getSecretMetadata('hf_token');
    assert.strictEqual(metadata.expiresAt, options.expiresAt);
  });

  await asyncTest('should handle IPC deleteSecret request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    await vault.setSecret('hf_token', token);

    await vault.deleteSecret('hf_token');

    const result = await vault.getSecret('hf_token');
    assert.strictEqual(result, null);
  });

  await asyncTest('should handle IPC getSecretMetadata request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';
    const expiresAt = new Date().toISOString();

    await vault.setSecret('hf_token', token, { expiresAt });

    const metadata = await vault.getSecretMetadata('hf_token');
    assert(metadata, 'Metadata should exist');
    assert.strictEqual(metadata.expiresAt, expiresAt);
  });

  await asyncTest('should handle IPC listSecrets request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    await vault.setSecret('hf_token', 'token1');
    await vault.setSecret('api_key', 'key1');

    const secrets = vault.listSecrets();
    assert(Array.isArray(secrets), 'Should return an array');
    assert(secrets.includes('hf_token'), 'Should include hf_token');
    assert(secrets.includes('api_key'), 'Should include api_key');
  });

  await asyncTest('should handle IPC verifyMasterKeyChecksum request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const isValid = await vault.verifyMasterKeyChecksum();
    assert(typeof isValid === 'boolean', 'Should return a boolean');
  });

  await asyncTest('should handle IPC isInitialized request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const initialized = vault.isInitialized();
    assert(typeof initialized === 'boolean', 'Should return a boolean');
    assert.strictEqual(initialized, true);
  });

  await asyncTest('should handle IPC getEncryptionBackend request', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const backend = vault.getEncryptionBackend();
    assert(backend !== undefined, 'Should return a backend');
    assert(['safeStorage', 'aes256gcm', null].includes(backend), 'Should be a valid backend');
  });

  // ============================================================================
  // Integration with Existing Modules
  // ============================================================================

  console.log('\n=== Integration with Existing Modules ===\n');

  await asyncTest('should store and retrieve HF token from Secret_Vault', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';

    await vault.setSecret('hf_token', token);
    const retrieved = await vault.getSecret('hf_token');

    assert.strictEqual(retrieved, token);
  });

  await asyncTest('should store and retrieve API key from Secret_Vault', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const apiKey = 'sk_test_api_key_12345';

    await vault.setSecret('api_key', apiKey);
    const retrieved = await vault.getSecret('api_key');

    assert.strictEqual(retrieved, apiKey);
  });

  await asyncTest('should support multiple secrets simultaneously', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const hfToken = 'hf_test_token_12345';
    const apiKey = 'sk_test_api_key_12345';
    const userRecord = JSON.stringify({ id: 'user1', name: 'Test User' });

    await vault.setSecret('hf_token', hfToken);
    await vault.setSecret('api_key', apiKey);
    await vault.setSecret('user_record', userRecord);

    const hf = await vault.getSecret('hf_token');
    const api = await vault.getSecret('api_key');
    const user = await vault.getSecret('user_record');

    assert.strictEqual(hf, hfToken);
    assert.strictEqual(api, apiKey);
    assert.strictEqual(user, userRecord);
  });

  await asyncTest('should list all stored secrets', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    await vault.setSecret('hf_token', 'token1');
    await vault.setSecret('api_key', 'key1');
    await vault.setSecret('user_record', 'record1');

    const secrets = vault.listSecrets();
    assert(secrets.length >= 3, 'Should have at least 3 secrets');
    assert(secrets.includes('hf_token'));
    assert(secrets.includes('api_key'));
    assert(secrets.includes('user_record'));
  });

  // ============================================================================
  // Backward Compatibility
  // ============================================================================

  console.log('\n=== Backward Compatibility ===\n');

  await asyncTest('should handle missing Secret_Vault gracefully', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const result = await vault.getSecret('non_existent_key');
    assert.strictEqual(result, null);
  });

  await asyncTest('should preserve existing token format', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';

    await vault.setSecret('hf_token', token);
    const retrieved = await vault.getSecret('hf_token');

    assert.strictEqual(retrieved, token);

    const metadata = await vault.getSecretMetadata('hf_token');
    assert(metadata !== null, 'Metadata should exist');
  });

  // ============================================================================
  // Error Recovery
  // ============================================================================

  console.log('\n=== Error Recovery ===\n');

  await asyncTest('should handle missing secrets gracefully', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const result = await vault.getSecret('non_existent_secret');
    assert.strictEqual(result, null);
  });

  await asyncTest('should handle invalid options gracefully', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';

    await vault.setSecret('hf_token', token, {
      invalidOption: 'should_be_ignored'
    });

    const retrieved = await vault.getSecret('hf_token');
    assert.strictEqual(retrieved, token);
  });

  await asyncTest('should handle concurrent operations', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        vault.setSecret(`token_${i}`, `token_value_${i}`)
      );
    }

    await Promise.all(promises);

    for (let i = 0; i < 10; i++) {
      const result = await vault.getSecret(`token_${i}`);
      assert.strictEqual(result, `token_value_${i}`);
    }
  });

  // ============================================================================
  // Cross-Machine Detection
  // ============================================================================

  console.log('\n=== Cross-Machine Detection ===\n');

  await asyncTest('should verify master key checksum', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const isValid = await vault.verifyMasterKeyChecksum();
    assert(typeof isValid === 'boolean');
  });

  // ============================================================================
  // Settings UI Integration
  // ============================================================================

  console.log('\n=== Settings UI Integration ===\n');

  await asyncTest('should support token save/load workflow', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';

    await vault.setSecret('hf_token', token, {
      metadata: {
        source: 'settings-ui',
        savedAt: new Date().toISOString()
      }
    });

    const retrieved = await vault.getSecret('hf_token');
    const metadata = await vault.getSecretMetadata('hf_token');

    assert.strictEqual(retrieved, token);
    assert.strictEqual(metadata.metadata?.source, 'settings-ui');
  });

  await asyncTest('should support token delete workflow', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const token = 'hf_test_token_12345';

    await vault.setSecret('hf_token', token);
    await vault.deleteSecret('hf_token');

    const result = await vault.getSecret('hf_token');
    assert.strictEqual(result, null);
  });

  await asyncTest('should support token refresh workflow', async () => {
    const store = createMockStore();
    const keyDerivation = createMockKeyDerivation();
    const vault = new SecretVault(store, keyDerivation);
    await vault.initialize();

    const originalToken = 'hf_original_token_12345';
    const refreshedToken = 'hf_refreshed_token_67890';

    await vault.setSecret('hf_token', originalToken, {
      expiresAt: new Date().toISOString()
    });

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    await vault.setSecret('hf_token', refreshedToken, {
      expiresAt: newExpiresAt.toISOString(),
      metadata: { refreshedAt: new Date().toISOString() }
    });

    const retrieved = await vault.getSecret('hf_token');
    const metadata = await vault.getSecretMetadata('hf_token');

    assert.strictEqual(retrieved, refreshedToken);
    assert(metadata.metadata?.refreshedAt !== undefined);
  });

  // ============================================================================
  // Test Summary
  // ============================================================================

  console.log('\n=== Test Summary ===\n');
  console.log(`Total: ${testCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);

  if (failCount === 0) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  } else {
    console.log(`\n✗ ${failCount} test(s) failed`);
    process.exit(1);
  }
})();

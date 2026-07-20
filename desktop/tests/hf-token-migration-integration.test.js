/* eslint-env node */
/**
 * Integration tests for hf-token-migration.js with Secret_Vault
 *
 * Run with: node desktop/tests/hf-token-migration-integration.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { HFTokenMigration } = require('../hf-token-migration');
const { SecretVault } = require('../secret-vault');
const { KeyDerivation } = require('../key-derivation');

// Mock electron-store
class MockStore {
  constructor(initial = {}) {
    this.data = { ...initial };
  }

  get(key, defaultValue) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
  }

  delete(key) {
    delete this.data[key];
  }

  clear() {
    this.data = {};
  }
}

// Mock KeyDerivation service
function createMockKeyDerivation() {
  const mockKey = Buffer.alloc(32, 'test-key');
  const mockChecksum = 'test-checksum-abc123';

  return {
    deriveMasterKey: async () => mockKey,
    getMasterKeyChecksum: async () => mockChecksum,
    verifyChecksum: async (checksum) => checksum === mockChecksum,
    getPlatformIdentity: async () => ({ platform: 'test' })
  };
}

/**
 * Test suite
 */
async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Integration with SecretVault
  {
    const testName = 'Integration with SecretVault - full migration flow';
    try {
      const store = new MockStore({ hf_token: 'hf_integration_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // Check migration is needed
      const needed = await migration.isMigrationNeeded();
      assert.strictEqual(needed, true, 'Migration should be needed');

      // Perform migration
      const result = await migration.migrate();
      assert.strictEqual(result.success, true, 'Migration should succeed');
      assert.strictEqual(result.skipped, false, 'Migration should not be skipped');

      // Verify token is in vault
      const vaultToken = await secretVault.getSecret('hf_token');
      assert.strictEqual(vaultToken, 'hf_integration_test_token_12345', 'Token should be in vault');

      // Verify token is deleted from localStorage
      assert.strictEqual(store.get('hf_token'), undefined, 'Token should be deleted from localStorage');

      // Verify migration is no longer needed
      const stillNeeded = await migration.isMigrationNeeded();
      assert.strictEqual(stillNeeded, false, 'Migration should not be needed after completion');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 2: Rollback with SecretVault
  {
    const testName = 'Rollback with SecretVault - restore token to localStorage';
    try {
      const store = new MockStore();
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      // Store token in vault
      await secretVault.setSecret('hf_token', 'hf_rollback_test_token_12345');

      const migration = new HFTokenMigration(store, secretVault);

      // Perform rollback
      const result = await migration.rollback();
      assert.strictEqual(result.success, true, 'Rollback should succeed');

      // Verify token is restored to localStorage
      assert.strictEqual(store.get('hf_token'), 'hf_rollback_test_token_12345', 'Token should be restored to localStorage');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 3: Multiple migrations should be idempotent
  {
    const testName = 'Multiple migrations should be idempotent';
    try {
      const store = new MockStore({ hf_token: 'hf_idempotent_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // First migration
      const result1 = await migration.migrate();
      assert.strictEqual(result1.success, true, 'First migration should succeed');

      // Second migration (should be skipped)
      const result2 = await migration.migrate();
      assert.strictEqual(result2.success, true, 'Second migration should succeed');
      assert.strictEqual(result2.skipped, true, 'Second migration should be skipped');

      // Verify token is still in vault
      const vaultToken = await secretVault.getSecret('hf_token');
      assert.strictEqual(vaultToken, 'hf_idempotent_test_token_12345', 'Token should still be in vault');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 4: Migration with custom keys
  {
    const testName = 'Migration with custom keys';
    try {
      const store = new MockStore({ custom_hf_key: 'hf_custom_key_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault, {
        localStorageKey: 'custom_hf_key',
        vaultKey: 'custom_vault_key'
      });

      // Perform migration
      const result = await migration.migrate();
      assert.strictEqual(result.success, true, 'Migration should succeed');

      // Verify token is in vault with custom key
      const vaultToken = await secretVault.getSecret('custom_vault_key');
      assert.strictEqual(vaultToken, 'hf_custom_key_test_token_12345', 'Token should be in vault with custom key');

      // Verify token is deleted from localStorage
      assert.strictEqual(store.get('custom_hf_key'), undefined, 'Token should be deleted from localStorage');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 5: Migration status should reflect current state
  {
    const testName = 'Migration status should reflect current state';
    try {
      const store = new MockStore({ hf_token: 'hf_status_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // Check status before migration
      let status = await migration.getMigrationStatus();
      assert.strictEqual(status.hasInLocalStorage, true, 'Should have token in localStorage');
      assert.strictEqual(status.hasInVault, false, 'Should not have token in vault');
      assert.strictEqual(status.migrationNeeded, true, 'Migration should be needed');

      // Perform migration
      await migration.migrate();

      // Check status after migration
      status = await migration.getMigrationStatus();
      assert.strictEqual(status.hasInLocalStorage, false, 'Should not have token in localStorage');
      assert.strictEqual(status.hasInVault, true, 'Should have token in vault');
      assert.strictEqual(status.migrationNeeded, false, 'Migration should not be needed');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 6: Event emission during migration
  {
    const testName = 'Event emission during migration';
    try {
      const store = new MockStore({ hf_token: 'hf_event_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      let completeEventFired = false;
      let completeEventData = null;

      migration.on('migration-complete', (data) => {
        completeEventFired = true;
        completeEventData = data;
      });

      // Perform migration
      await migration.migrate();

      assert.strictEqual(completeEventFired, true, 'migration-complete event should be fired');
      assert(completeEventData, 'Event data should be provided');
      assert.strictEqual(completeEventData.success, true, 'Event should indicate success');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 7: Token encryption/decryption round-trip
  {
    const testName = 'Token encryption/decryption round-trip';
    try {
      const store = new MockStore({ hf_token: 'hf_roundtrip_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // Get original token
      const originalToken = migration.getTokenFromLocalStorage();

      // Perform migration
      await migration.migrate();

      // Retrieve token from vault
      const retrievedToken = await secretVault.getSecret('hf_token');

      // Verify round-trip
      assert.strictEqual(retrievedToken, originalToken, 'Token should survive encryption/decryption round-trip');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 8: Migration with very long token
  {
    const testName = 'Migration with very long token';
    try {
      const longToken = 'hf_' + 'x'.repeat(500); // 503 character token
      const store = new MockStore({ hf_token: longToken });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // Perform migration
      const result = await migration.migrate();
      assert.strictEqual(result.success, true, 'Migration should succeed with long token');

      // Verify token is in vault
      const vaultToken = await secretVault.getSecret('hf_token');
      assert.strictEqual(vaultToken, longToken, 'Long token should be preserved');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 9: Migration should handle special characters in token
  {
    const testName = 'Migration should handle special characters in token';
    try {
      const specialToken = 'hf_test_token_!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const store = new MockStore({ hf_token: specialToken });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault);

      // Perform migration
      const result = await migration.migrate();
      assert.strictEqual(result.success, true, 'Migration should succeed with special characters');

      // Verify token is in vault
      const vaultToken = await secretVault.getSecret('hf_token');
      assert.strictEqual(vaultToken, specialToken, 'Special characters should be preserved');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 10: Migration should not delete from localStorage if deleteAfterMigration is false
  {
    const testName = 'Migration should not delete from localStorage if deleteAfterMigration is false';
    try {
      const store = new MockStore({ hf_token: 'hf_nodelete_test_token_12345' });
      const vaultStore = new MockStore();
      const keyDerivation = createMockKeyDerivation();
      const secretVault = new SecretVault(vaultStore, keyDerivation);
      await secretVault.initialize();

      const migration = new HFTokenMigration(store, secretVault, {
        deleteAfterMigration: false
      });

      // Perform migration
      const result = await migration.migrate();
      assert.strictEqual(result.success, true, 'Migration should succeed');

      // Verify token is still in localStorage
      assert.strictEqual(store.get('hf_token'), 'hf_nodelete_test_token_12345', 'Token should still be in localStorage');

      // Verify token is in vault
      const vaultToken = await secretVault.getSecret('hf_token');
      assert.strictEqual(vaultToken, 'hf_nodelete_test_token_12345', 'Token should be in vault');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Integration tests passed: ${testsPassed}`);
  console.log(`Integration tests failed: ${testsFailed}`);
  console.log('='.repeat(50));

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Integration test suite error:', error);
  process.exit(1);
});

/* eslint-env node */
/**
 * Tests for hf-token-migration.js
 *
 * Run with: node desktop/tests/hf-token-migration.test.js
 */

const assert = require('assert');
const {
  HFTokenMigration,
  HFTokenMigrationError,
  TokenNotFoundError,
  MigrationFailedError,
  ValidationError
} = require('../hf-token-migration');

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
 * Mock SecretVault
 */
function createMockSecretVault(initialSecrets = {}) {
  const secrets = { ...initialSecrets };
  const { SecretNotFoundError } = require('../secret-vault');

  return {
    getSecret: async (key) => {
      if (!(key in secrets)) {
        const error = new SecretNotFoundError(key);
        throw error;
      }
      return secrets[key];
    },
    setSecret: async (key, value, options = {}) => {
      secrets[key] = value;
    },
    deleteSecret: async (key) => {
      delete secrets[key];
    },
    listSecrets: () => Object.keys(secrets),
    getSecrets: () => ({ ...secrets })
  };
}

/**
 * Test suite
 */
async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Constructor validation
  {
    const testName = 'Constructor should validate required parameters';
    try {
      assert.throws(() => {
        new HFTokenMigration(null, {});
      }, ValidationError);
      assert.throws(() => {
        new HFTokenMigration({}, null);
      }, ValidationError);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 2: Constructor should initialize with defaults
  {
    const testName = 'Constructor should initialize with default options';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      assert.strictEqual(migration.localStorageKey, 'hf_token');
      assert.strictEqual(migration.vaultKey, 'hf_token');
      assert.strictEqual(migration.deleteAfterMigration, true);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 3: Constructor should accept custom options
  {
    const testName = 'Constructor should accept custom options';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault, {
        localStorageKey: 'custom_hf_token',
        vaultKey: 'custom_vault_key',
        deleteAfterMigration: false
      });

      assert.strictEqual(migration.localStorageKey, 'custom_hf_token');
      assert.strictEqual(migration.vaultKey, 'custom_vault_key');
      assert.strictEqual(migration.deleteAfterMigration, false);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 4: hasTokenInLocalStorage should return false when no token
  {
    const testName = 'hasTokenInLocalStorage should return false when no token';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      assert.strictEqual(migration.hasTokenInLocalStorage(), false);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 5: hasTokenInLocalStorage should return true when token exists
  {
    const testName = 'hasTokenInLocalStorage should return true when token exists';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      assert.strictEqual(migration.hasTokenInLocalStorage(), true);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 6: hasTokenInVault should return false when no token
  {
    const testName = 'hasTokenInVault should return false when no token';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.hasTokenInVault();
      assert.strictEqual(result, false);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 7: hasTokenInVault should return true when token exists
  {
    const testName = 'hasTokenInVault should return true when token exists';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault({ hf_token: 'hf_vault_token_123' });
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.hasTokenInVault();
      assert.strictEqual(result, true);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 8: isMigrationNeeded should return false when no token in localStorage
  {
    const testName = 'isMigrationNeeded should return false when no token in localStorage';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.isMigrationNeeded();
      assert.strictEqual(result, false);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 9: isMigrationNeeded should return false when token already in vault
  {
    const testName = 'isMigrationNeeded should return false when token already in vault';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault({ hf_token: 'hf_vault_token_123' });
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.isMigrationNeeded();
      assert.strictEqual(result, false);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 10: isMigrationNeeded should return true when token in localStorage but not in vault
  {
    const testName = 'isMigrationNeeded should return true when token in localStorage but not in vault';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.isMigrationNeeded();
      assert.strictEqual(result, true);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 11: getTokenFromLocalStorage should return null when no token
  {
    const testName = 'getTokenFromLocalStorage should return null when no token';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = migration.getTokenFromLocalStorage();
      assert.strictEqual(result, null);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 12: getTokenFromLocalStorage should return token when exists
  {
    const testName = 'getTokenFromLocalStorage should return token when exists';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = migration.getTokenFromLocalStorage();
      assert.strictEqual(result, 'hf_test_token_123');
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 13: migrate should skip when migration not needed
  {
    const testName = 'migrate should skip when migration not needed';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.migrate();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.skipped, true);
      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 14: migrate should successfully migrate token
  {
    const testName = 'migrate should successfully migrate token';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.migrate();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.skipped, false);

      // Verify token is in vault
      const vaultToken = await vault.getSecret('hf_token');
      assert.strictEqual(vaultToken, 'hf_test_token_123');

      // Verify token is deleted from localStorage
      assert.strictEqual(store.get('hf_token'), undefined);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 15: migrate should not delete from localStorage if deleteAfterMigration is false
  {
    const testName = 'migrate should not delete from localStorage if deleteAfterMigration is false';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault, { deleteAfterMigration: false });

      const result = await migration.migrate();
      assert.strictEqual(result.success, true);

      // Verify token is still in localStorage
      assert.strictEqual(store.get('hf_token'), 'hf_test_token_123');

      // Verify token is in vault
      const vaultToken = await vault.getSecret('hf_token');
      assert.strictEqual(vaultToken, 'hf_test_token_123');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 16: migrate should handle invalid token format
  {
    const testName = 'migrate should handle invalid token format';
    try {
      const store = createMockStore({ hf_token: 'short' }); // Token too short (< 10 chars)
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.migrate();
      assert.strictEqual(result.success, false);
      assert(result.error);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 17: rollback should restore token to localStorage
  {
    const testName = 'rollback should restore token to localStorage';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault({ hf_token: 'hf_vault_token_123' });
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.rollback();
      assert.strictEqual(result.success, true);

      // Verify token is restored to localStorage
      assert.strictEqual(store.get('hf_token'), 'hf_vault_token_123');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 18: rollback should fail when token not in vault
  {
    const testName = 'rollback should fail when token not in vault';
    try {
      const store = createMockStore();
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const result = await migration.rollback();
      assert.strictEqual(result.success, false);
      assert(result.error);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 19: getMigrationStatus should return correct status
  {
    const testName = 'getMigrationStatus should return correct status';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const status = await migration.getMigrationStatus();
      assert.strictEqual(status.hasInLocalStorage, true);
      assert.strictEqual(status.hasInVault, false);
      assert.strictEqual(status.migrationNeeded, true);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 20: Event listeners should work
  {
    const testName = 'Event listeners should work';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      let eventFired = false;
      let eventData = null;

      migration.on('migration-complete', (data) => {
        eventFired = true;
        eventData = data;
      });

      await migration.migrate();

      assert.strictEqual(eventFired, true);
      assert(eventData);
      assert.strictEqual(eventData.success, true);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 21: Event listeners should be removable
  {
    const testName = 'Event listeners should be removable';
    try {
      const store = createMockStore({ hf_token: 'hf_test_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      let eventFired = false;

      const callback = () => {
        eventFired = true;
      };

      migration.on('migration-complete', callback);
      migration.off('migration-complete', callback);

      await migration.migrate();

      assert.strictEqual(eventFired, false);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 22: Custom localStorage key should work
  {
    const testName = 'Custom localStorage key should work';
    try {
      const store = createMockStore({ custom_key: 'hf_custom_token_123' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault, {
        localStorageKey: 'custom_key',
        vaultKey: 'custom_vault_key'
      });

      const result = await migration.migrate();
      assert.strictEqual(result.success, true);

      // Verify token is in vault with custom key
      const vaultToken = await vault.getSecret('custom_vault_key');
      assert.strictEqual(vaultToken, 'hf_custom_token_123');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 23: Whitespace should be trimmed from token
  {
    const testName = 'Whitespace should be trimmed from token';
    try {
      const store = createMockStore({ hf_token: '  hf_test_token_123  ' });
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      const token = migration.getTokenFromLocalStorage();
      assert.strictEqual(token, 'hf_test_token_123');

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Test 24: Migration should emit migration-failed event on error
  {
    const testName = 'Migration should emit migration-failed event on error';
    try {
      const store = createMockStore({ hf_token: 'short' }); // Invalid token (too short)
      const vault = createMockSecretVault();
      const migration = new HFTokenMigration(store, vault);

      let eventFired = false;
      let eventData = null;

      migration.on('migration-failed', (data) => {
        eventFired = true;
        eventData = data;
      });

      await migration.migrate();

      assert.strictEqual(eventFired, true);
      assert(eventData);
      assert(eventData.error);

      console.log(`✓ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.log(`✗ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log('='.repeat(50));

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});

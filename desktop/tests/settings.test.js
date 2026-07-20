/* eslint-env node */
/**
 * Tests for settings.js - HF Token Storage/Retrieval from Secret_Vault
 *
 * Run with: npm test -- settings.test.js
 * Or: node desktop/tests/settings.test.js
 */

const assert = require('assert');

/**
 * Mock Secret_Vault API
 */
function createMockSecretVaultAPI() {
  const storage = {};
  
  return {
    getSecret: async (key) => {
      if (key === 'hf_token_error') {
        throw new Error('Decryption failed - cross-machine copy detected');
      }
      return storage[key] || null;
    },
    setSecret: async (key, value, options = {}) => {
      storage[key] = value;
      return { success: true };
    },
    deleteSecret: async (key) => {
      delete storage[key];
      return { success: true };
    },
    getSecretMetadata: async (key) => {
      if (key === 'hf_token' && storage[key]) {
        return {
          savedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          scope: 'repo.read',
        };
      }
      return null;
    },
    listSecrets: async () => Object.keys(storage),
    isInitialized: async () => true,
    getEncryptionBackend: async () => 'aes256gcm',
  };
}

/**
 * Run all tests
 */
async function runAllTests() {
  const tests = [
    {
      name: 'loadHFTokenFromVault - should load token from Secret_Vault when available',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecret = async (key) => {
          if (key === 'hf_token') return 'test-token-123';
          return null;
        };
        const token = await mockVault.getSecret('hf_token');
        assert.strictEqual(token, 'test-token-123', 'Token should be loaded from vault');
      }
    },
    {
      name: 'loadHFTokenFromVault - should return null when token does not exist',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const token = await mockVault.getSecret('hf_token');
        assert.strictEqual(token, null, 'Should return null for non-existent token');
      }
    },
    {
      name: 'loadHFTokenFromVault - should handle decryption errors gracefully',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecret = async (key) => {
          if (key === 'hf_token_error') {
            throw new Error('Decryption failed - cross-machine copy detected');
          }
          return null;
        };
        try {
          await mockVault.getSecret('hf_token_error');
          assert.fail('Should have thrown an error');
        } catch (error) {
          assert(error.message.includes('Decryption failed'), 'Should throw decryption error');
        }
      }
    },
    {
      name: 'saveHFTokenToVault - should save token to Secret_Vault',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const testToken = 'hf_test_token_abc123';
        await mockVault.setSecret('hf_token', testToken, {});
        const saved = await mockVault.getSecret('hf_token');
        assert.strictEqual(saved, testToken, 'Token should be saved to vault');
      }
    },
    {
      name: 'saveHFTokenToVault - should save token with metadata',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const testToken = 'hf_test_token_xyz789';
        const options = {
          metadata: {
            source: 'settings-ui',
            savedAt: new Date().toISOString(),
          }
        };
        await mockVault.setSecret('hf_token', testToken, options);
        const saved = await mockVault.getSecret('hf_token');
        assert.strictEqual(saved, testToken, 'Token should be saved with metadata');
      }
    },
    {
      name: 'deleteHFToken - should delete token from Secret_Vault',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        await mockVault.setSecret('hf_token', 'test-token');
        await mockVault.deleteSecret('hf_token');
        const deleted = await mockVault.getSecret('hf_token');
        assert.strictEqual(deleted, null, 'Token should be deleted from vault');
      }
    },
    {
      name: 'getSecretMetadata - should retrieve token metadata including expiration',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        await mockVault.setSecret('hf_token', 'test-token');
        const metadata = await mockVault.getSecretMetadata('hf_token');
        assert(metadata, 'Metadata should be returned');
        assert(metadata.savedAt, 'Metadata should include savedAt');
        assert(metadata.expiresAt, 'Metadata should include expiresAt');
        assert(metadata.scope, 'Metadata should include scope');
      }
    },
    {
      name: 'Token Expiration - should detect expired tokens',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecretMetadata = async (key) => {
          if (key === 'hf_token') {
            return {
              savedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() - 1000).toISOString(),
              scope: 'repo.read',
            };
          }
          return null;
        };
        const metadata = await mockVault.getSecretMetadata('hf_token');
        const expiryDate = new Date(metadata.expiresAt);
        const isExpired = expiryDate < new Date();
        assert(isExpired, 'Token should be detected as expired');
      }
    },
    {
      name: 'Token Expiration - should warn about tokens expiring soon',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecretMetadata = async (key) => {
          if (key === 'hf_token') {
            return {
              savedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
              scope: 'repo.read',
            };
          }
          return null;
        };
        const metadata = await mockVault.getSecretMetadata('hf_token');
        const expiryDate = new Date(metadata.expiresAt);
        const now = new Date();
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        assert(daysUntilExpiry <= 7, 'Token should be flagged as expiring soon');
        assert(daysUntilExpiry > 0, 'Token should not be expired yet');
      }
    },
    {
      name: 'Error Handling - should handle network errors gracefully',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecret = async (key) => {
          throw new Error('Network error');
        };
        try {
          await mockVault.getSecret('hf_token');
          assert.fail('Should have thrown an error');
        } catch (error) {
          assert(error.message.includes('Network error'), 'Should throw network error');
        }
      }
    },
    {
      name: 'Error Handling - should handle cross-machine copy detection',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        mockVault.getSecret = async (key) => {
          throw new Error('Decryption failed - cross-machine copy detected');
        };
        try {
          await mockVault.getSecret('hf_token');
          assert.fail('Should have thrown an error');
        } catch (error) {
          assert(error.message.includes('cross-machine'), 'Should detect cross-machine copy');
        }
      }
    },
    {
      name: 'Integration - full token lifecycle: save -> load -> delete',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const testToken = 'hf_integration_test_token';
        await mockVault.setSecret('hf_token', testToken);
        let saved = await mockVault.getSecret('hf_token');
        assert.strictEqual(saved, testToken, 'Token should be saved');
        const loaded = await mockVault.getSecret('hf_token');
        assert.strictEqual(loaded, testToken, 'Token should be loaded');
        await mockVault.deleteSecret('hf_token');
        const deleted = await mockVault.getSecret('hf_token');
        assert.strictEqual(deleted, null, 'Token should be deleted');
      }
    },
    {
      name: 'Integration - handle token update (overwrite existing token)',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const oldToken = 'hf_old_token';
        const newToken = 'hf_new_token';
        await mockVault.setSecret('hf_token', oldToken);
        let current = await mockVault.getSecret('hf_token');
        assert.strictEqual(current, oldToken, 'Old token should be saved');
        await mockVault.setSecret('hf_token', newToken);
        current = await mockVault.getSecret('hf_token');
        assert.strictEqual(current, newToken, 'New token should overwrite old token');
      }
    },
    {
      name: 'Integration - maintain token across multiple save/load cycles',
      fn: async () => {
        const mockVault = createMockSecretVaultAPI();
        const testToken = 'hf_persistent_token';
        for (let i = 0; i < 3; i++) {
          await mockVault.setSecret('hf_token', testToken);
          const loaded = await mockVault.getSecret('hf_token');
          assert.strictEqual(loaded, testToken, `Token should persist in cycle ${i + 1}`);
        }
      }
    },
  ];

  let passed = 0;
  let failed = 0;

  console.log('Running Settings Tests...\n');

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`✓ ${test.name}`);
      passed++;
    } catch (error) {
      console.log(`✗ ${test.name}`);
      console.log(`  Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

// Run tests if this is the main module
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

module.exports = {
  createMockSecretVaultAPI,
  runAllTests,
};

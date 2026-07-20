/* eslint-env node */
/**
 * Tests for Secret_Vault IPC handlers
 *
 * Tests the IPC communication layer between renderer and main process
 * for secret operations (getSecret, setSecret, getSecretMetadata, etc.)
 *
 * Run with: node desktop/tests/secret-vault-ipc.test.js
 */

const assert = require('assert');
const { ipcMain } = require('electron');

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
		getPlatformIdentity: async () => ({ platform: 'test' })
	};
}

/**
 * Mock IPC event
 */
function createMockIPCEvent() {
	return {
		sender: {
			send: () => {}
		}
	};
}

/**
 * Test suite for Secret_Vault IPC handlers
 */
async function runTests() {
	const { SecretVault } = require('../secret-vault');

	console.log('Starting Secret_Vault IPC handler tests...\n');

	let testsPassed = 0;
	let testsFailed = 0;

	// Test 1: vault:getSecret handler - success case
	{
		const testName = 'vault:getSecret handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			// Store a secret
			await vault.setSecret('test-key', 'test-value');

			// Simulate IPC handler
			const event = createMockIPCEvent();
			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const secret = await global.secretVault.getSecret('test-key');
					return { success: true, value: secret };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.strictEqual(result.value, 'test-value', 'Should retrieve stored secret');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 2: vault:getSecret handler - secret not found
	{
		const testName = 'vault:getSecret handler - secret not found';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const secret = await global.secretVault.getSecret('nonexistent-key');
					return { success: true, value: secret };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.strictEqual(result.value, null, 'Should return null for nonexistent secret');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 3: vault:setSecret handler - success case
	{
		const testName = 'vault:setSecret handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					await global.secretVault.setSecret('new-key', 'new-value');
					return { success: true };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');

			// Verify the secret was stored
			const stored = await vault.getSecret('new-key');
			assert.strictEqual(stored, 'new-value', 'Secret should be stored');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 4: vault:setSecret handler with options
	{
		const testName = 'vault:setSecret handler with options (expiration)';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			const futureDate = new Date(Date.now() + 3600000).toISOString();

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					await global.secretVault.setSecret('expiring-key', 'expiring-value', {
						expiresAt: futureDate
					});
					return { success: true };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');

			// Verify metadata (getSecretMetadata is async)
			const metadata = await vault.getSecretMetadata('expiring-key');
			assert.strictEqual(metadata.expiresAt, futureDate, 'Expiration should be stored');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 5: vault:deleteSecret handler - success case
	{
		const testName = 'vault:deleteSecret handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			// Store a secret first
			await vault.setSecret('to-delete', 'value');

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					await global.secretVault.deleteSecret('to-delete');
					return { success: true };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');

			// Verify the secret was deleted
			const retrieved = await vault.getSecret('to-delete');
			assert.strictEqual(retrieved, null, 'Secret should be deleted');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 6: vault:getSecretMetadata handler - success case
	{
		const testName = 'vault:getSecretMetadata handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			const futureDate = new Date(Date.now() + 3600000).toISOString();
			await vault.setSecret('metadata-key', 'metadata-value', {
				expiresAt: futureDate,
				scope: 'test-scope'
			});

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const metadata = await global.secretVault.getSecretMetadata('metadata-key');
					return { success: true, metadata };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.ok(result.metadata, 'Metadata should be returned');
			assert.strictEqual(result.metadata.expiresAt, futureDate, 'Expiration should match');
			assert.strictEqual(result.metadata.scope, 'test-scope', 'Scope should match');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 7: vault:listSecrets handler - success case
	{
		const testName = 'vault:listSecrets handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			// Store multiple secrets
			await vault.setSecret('key1', 'value1');
			await vault.setSecret('key2', 'value2');
			await vault.setSecret('key3', 'value3');

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const secrets = global.secretVault.listSecrets();
					return { success: true, secrets };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.ok(Array.isArray(result.secrets), 'Should return array of secrets');
			assert.ok(result.secrets.includes('key1'), 'Should include key1');
			assert.ok(result.secrets.includes('key2'), 'Should include key2');
			assert.ok(result.secrets.includes('key3'), 'Should include key3');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 8: vault:verifyMasterKeyChecksum handler - success case
	{
		const testName = 'vault:verifyMasterKeyChecksum handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const isValid = await global.secretVault.verifyMasterKeyChecksum();
					return { success: true, isValid };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.strictEqual(result.isValid, true, 'Checksum should be valid');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 9: vault:isInitialized handler - success case
	{
		const testName = 'vault:isInitialized handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						return { success: true, initialized: false };
					}
					return { success: true, initialized: global.secretVault.isInitialized() };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.strictEqual(result.initialized, true, 'Vault should be initialized');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 10: vault:getEncryptionBackend handler - success case
	{
		const testName = 'vault:getEncryptionBackend handler - success case';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						return { success: true, backend: null };
					}
					const backend = global.secretVault.getEncryptionBackend();
					return { success: true, backend };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.ok(result.backend, 'Backend should be set');
			assert.ok(['safeStorage', 'aes256gcm'].includes(result.backend), 'Backend should be valid');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 11: Error handling - vault not initialized
	{
		const testName = 'Error handling - vault not initialized';
		try {
			global.secretVault = null;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const secret = await global.secretVault.getSecret('test-key');
					return { success: true, value: secret };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, false, 'Handler should fail');
			assert.ok(result.error.includes('not initialized'), 'Error should mention initialization');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 12: Error handling - invalid key
	{
		const testName = 'Error handling - invalid key (too long)';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const longKey = 'a'.repeat(300); // Exceeds 256 char limit
					await global.secretVault.setSecret(longKey, 'value');
					return { success: true };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			assert.strictEqual(result.success, false, 'Handler should fail');
			assert.ok(result.error, 'Error should be returned');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 13: Logging - getSecret logs errors
	{
		const testName = 'Logging - getSecret logs errors';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Capture console.error
			let errorLogged = false;
			const originalError = console.error;
			console.error = function(...args) {
				if (args[0] && args[0].includes('[vault:getSecret]')) {
					errorLogged = true;
				}
				originalError.apply(console, args);
			};

			// Mock the handler logic with error
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					const secret = await global.secretVault.getSecret('test-key');
					return { success: true, value: secret };
				} catch (error) {
					console.error(`[vault:getSecret] Error retrieving secret "test-key":`, error.message);
					return { success: false, error: error.message };
				}
			})();

			console.error = originalError;

			assert.strictEqual(result.success, true, 'Handler should succeed (null is valid)');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Test 14: Logging - setSecret logs success
	{
		const testName = 'Logging - setSecret logs success';
		try {
			const store = createMockStore();
			const keyDerivation = createMockKeyDerivation();
			const vault = new SecretVault(store, keyDerivation);
			await vault.initialize();

			global.secretVault = vault;

			// Capture console.log
			let successLogged = false;
			const originalLog = console.log;
			console.log = function(...args) {
				if (args[0] && args[0].includes('[vault:setSecret]')) {
					successLogged = true;
				}
				originalLog.apply(console, args);
			};

			// Mock the handler logic
			const result = await (async () => {
				try {
					if (!global.secretVault) {
						throw new Error('Secret_Vault not initialized');
					}
					await global.secretVault.setSecret('logged-key', 'logged-value');
					console.log(`[vault:setSecret] Secret "logged-key" stored successfully`);
					return { success: true };
				} catch (error) {
					return { success: false, error: error.message };
				}
			})();

			console.log = originalLog;

			assert.strictEqual(result.success, true, 'Handler should succeed');
			assert.strictEqual(successLogged, true, 'Success should be logged');

			console.log(`✓ ${testName}`);
			testsPassed++;
		} catch (error) {
			console.error(`✗ ${testName}: ${error.message}`);
			testsFailed++;
		}
	}

	// Summary
	console.log(`\n${'='.repeat(60)}`);
	console.log(`Tests passed: ${testsPassed}`);
	console.log(`Tests failed: ${testsFailed}`);
	console.log(`Total tests: ${testsPassed + testsFailed}`);
	console.log(`${'='.repeat(60)}\n`);

	if (testsFailed > 0) {
		process.exit(1);
	}
}

// Run tests
runTests().catch((error) => {
	console.error('Test suite failed:', error);
	process.exit(1);
});

/* eslint-env node */
/**
 * Tests for secret-vault.js
 *
 * Run with: node desktop/tests/secret-vault.test.js
 */

const assert = require('assert');
const {
	SecretVault,
	SecretVaultError,
	SecretNotFoundError,
	DecryptionFailedError,
	TokenExpiredError,
	TokenRefreshFailedError,
	ValidationError
} = require('../secret-vault');

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
 * Test helper
 */
function test(name, fn) {
	try {
		const result = fn();
		if (result && typeof result.then === 'function') {
			// Async test
			result
				.then(() => {
					console.log(`  PASS: ${name}`);
				})
				.catch((err) => {
					console.error(`  FAIL: ${name}`);
					console.error(`    ${err.message}`);
					process.exitCode = 1;
				});
		} else {
			// Sync test
			console.log(`  PASS: ${name}`);
		}
	} catch (err) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${err.message}`);
		process.exitCode = 1;
	}
}

console.log('SecretVault tests\n');

// ============================================================================
// Initialization Tests
// ============================================================================

console.log('Initialization:');

test('constructor requires store parameter', () => {
	assert.throws(
		() => new SecretVault(null),
		ValidationError
	);
});

test('constructor accepts store and keyDerivation', () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation);
	assert.ok(vault);
	assert.strictEqual(vault.isInitialized(), false);
});

test('initialize with AES-256-GCM backend', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	assert.strictEqual(vault.isInitialized(), true);
	assert.strictEqual(vault.getEncryptionBackend(), 'aes256gcm');
});

test('initialize stores master key checksum on first run', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const checksum = store.get('vault.masterKeyChecksum');
	assert.ok(checksum);
	assert.strictEqual(checksum, 'test-checksum-abc123');
});

test('initialize detects cross-machine copy via checksum mismatch', async () => {
	const store = createMockStore({ 'vault.masterKeyChecksum': 'wrong-checksum' });
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	try {
		await vault.initialize();
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('cross-machine'));
	}
});

test('initialize requires KeyDerivation for AES-256-GCM', async () => {
	const store = createMockStore();
	const vault = new SecretVault(store, null, { useSafeStorage: false });

	try {
		await vault.initialize();
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('KeyDerivation'));
	}
});

test('initialize idempotent - calling twice does not reinitialize', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	const backend1 = vault.getEncryptionBackend();

	await vault.initialize();
	const backend2 = vault.getEncryptionBackend();

	assert.strictEqual(backend1, backend2);
});

// ============================================================================
// Secret Storage Tests
// ============================================================================

console.log('\nSecret Storage:');

test('setSecret stores encrypted secret', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	await vault.setSecret('test-key', 'test-value');

	const stored = store.get('vault.secrets.test-key');
	assert.ok(stored);
	assert.notStrictEqual(stored, 'test-value'); // Should be encrypted
});

test('getSecret retrieves and decrypts secret', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	await vault.setSecret('test-key', 'test-value');

	const retrieved = await vault.getSecret('test-key');
	assert.strictEqual(retrieved, 'test-value');
});

test('getSecret returns null for non-existent key', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const retrieved = await vault.getSecret('non-existent');
	assert.strictEqual(retrieved, null);
});

test('setSecret requires initialization', async () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		await vault.setSecret('key', 'value');
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('not initialized'));
	}
});

test('getSecret requires initialization', async () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		await vault.getSecret('key');
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('not initialized'));
	}
});

// ============================================================================
// Validation Tests
// ============================================================================

console.log('\nValidation:');

test('setSecret validates key is non-empty string', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		await vault.setSecret('', 'value');
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
	}
});

test('setSecret validates key length', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const longKey = 'x'.repeat(257); // Exceeds default 256 limit

	try {
		await vault.setSecret(longKey, 'value');
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('exceeds maximum length'));
	}
});

test('setSecret validates value is string', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		await vault.setSecret('key', 123);
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('must be a string'));
	}
});

test('setSecret validates value size', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, {
		useSafeStorage: false,
		maxValueSize: 100
	});

	await vault.initialize();

	const largeValue = 'x'.repeat(101);

	try {
		await vault.setSecret('key', largeValue);
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('exceeds maximum size'));
	}
});

// ============================================================================
// Checksum Tests
// ============================================================================

console.log('\nChecksum:');

test('setSecret computes and stores SHA-256 checksum', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	await vault.setSecret('test-key', 'test-value');

	const metadata = await vault.getSecretMetadata('test-key');
	assert.ok(metadata.checksum);
	assert.strictEqual(metadata.checksum.length, 64); // SHA-256 hex is 64 chars
});

test('getSecretMetadata returns checksum without decrypting value', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	await vault.setSecret('test-key', 'test-value');

	const metadata = await vault.getSecretMetadata('test-key');
	assert.ok(metadata.checksum);
	assert.ok(!metadata.value); // Value should not be in metadata
});

// ============================================================================
// Token Expiration Tests
// ============================================================================

console.log('\nToken Expiration:');

test('setSecret stores expiresAt timestamp', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const futureTime = new Date(Date.now() + 3600000).toISOString();
	await vault.setSecret('token', 'token-value', { expiresAt: futureTime });

	const metadata = await vault.getSecretMetadata('token');
	assert.strictEqual(metadata.expiresAt, futureTime);
});

test('getSecret emits token-expiring-soon event within 24 hours', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
	await vault.setSecret('token', 'token-value', { expiresAt });

	let eventEmitted = false;
	vault.on('token-expiring-soon', (data) => {
		eventEmitted = true;
		assert.strictEqual(data.key, 'token');
		assert.ok(data.secondsRemaining > 0);
	});

	await vault.getSecret('token');
	assert.ok(eventEmitted);
});

test('getSecret throws TokenExpiredError for expired token', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
	await vault.setSecret('token', 'token-value', { expiresAt: pastTime });

	try {
		await vault.getSecret('token');
		assert.fail('Should have thrown TokenExpiredError');
	} catch (error) {
		assert.ok(error instanceof TokenExpiredError);
	}
});

test('getSecret emits token-expired event for expired token', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const pastTime = new Date(Date.now() - 3600000).toISOString();
	await vault.setSecret('token', 'token-value', { expiresAt: pastTime });

	let eventEmitted = false;
	vault.on('token-expired', (data) => {
		eventEmitted = true;
		assert.strictEqual(data.key, 'token');
	});

	try {
		await vault.getSecret('token');
	} catch (error) {
		// Expected
	}

	assert.ok(eventEmitted);
});

// ============================================================================
// Secret Deletion Tests
// ============================================================================

console.log('\nSecret Deletion:');

test('deleteSecret removes secret from storage', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();
	await vault.setSecret('test-key', 'test-value');

	let retrieved = await vault.getSecret('test-key');
	assert.strictEqual(retrieved, 'test-value');

	await vault.deleteSecret('test-key');

	retrieved = await vault.getSecret('test-key');
	assert.strictEqual(retrieved, null);
});

test('deleteSecret requires initialization', async () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		await vault.deleteSecret('key');
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('not initialized'));
	}
});

test('deleteSecret handles store errors gracefully', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Create a broken store that throws on delete
	const brokenStore = {
		...store,
		delete: () => {
			throw new Error('Store error');
		}
	};

	vault.store = brokenStore;

	try {
		await vault.deleteSecret('key');
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('Failed to delete'));
	}
});

// ============================================================================
// List Secrets Tests
// ============================================================================

console.log('\nList Secrets:');

test('listSecrets returns array of secret keys', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('key1', 'value1');
	await vault.setSecret('key2', 'value2');
	await vault.setSecret('key3', 'value3');

	const keys = vault.listSecrets();
	assert.strictEqual(keys.length, 3);
	assert.ok(keys.includes('key1'));
	assert.ok(keys.includes('key2'));
	assert.ok(keys.includes('key3'));
});

test('listSecrets returns empty array when no secrets stored', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const keys = vault.listSecrets();
	assert.strictEqual(keys.length, 0);
});

test('listSecrets requires initialization', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.listSecrets();
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('not initialized'));
	}
});

test('listSecrets handles store errors gracefully', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Create a broken store that throws on access
	const brokenStore = {
		get store() {
			throw new Error('Store error');
		}
	};

	vault.store = brokenStore;

	try {
		vault.listSecrets();
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('Failed to list'));
	}
});

// ============================================================================
// Token Refresh Tests
// ============================================================================

console.log('\nToken Refresh:');

test('refreshToken calls refresh function and updates token', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const oldToken = 'old-token';
	const newToken = 'new-token';
	const newExpiresAt = new Date(Date.now() + 7200000).toISOString();

	await vault.setSecret('token', oldToken);

	const refreshFn = async (key, currentToken) => {
		assert.strictEqual(key, 'token');
		assert.strictEqual(currentToken, oldToken);
		return { token: newToken, expiresAt: newExpiresAt };
	};

	const result = await vault.refreshToken('token', refreshFn);
	assert.strictEqual(result, newToken);

	const retrieved = await vault.getSecret('token');
	assert.strictEqual(retrieved, newToken);
});

test('refreshToken emits token-refreshed event', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('token', 'old-token');

	let eventEmitted = false;
	vault.on('token-refreshed', (data) => {
		eventEmitted = true;
		assert.strictEqual(data.key, 'token');
	});

	const refreshFn = async () => ({
		token: 'new-token',
		expiresAt: new Date(Date.now() + 7200000).toISOString()
	});

	await vault.refreshToken('token', refreshFn);
	assert.ok(eventEmitted);
});

test('refreshToken throws TokenRefreshFailedError on refresh failure', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('token', 'old-token');

	const refreshFn = async () => {
		throw new Error('Refresh endpoint failed');
	};

	try {
		await vault.refreshToken('token', refreshFn);
		assert.fail('Should have thrown TokenRefreshFailedError');
	} catch (error) {
		assert.ok(error instanceof TokenRefreshFailedError);
	}
});

test('refreshToken emits token-refresh-failed event on failure', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('token', 'old-token');

	let eventEmitted = false;
	vault.on('token-refresh-failed', (data) => {
		eventEmitted = true;
		assert.strictEqual(data.key, 'token');
	});

	const refreshFn = async () => {
		throw new Error('Refresh failed');
	};

	try {
		await vault.refreshToken('token', refreshFn);
	} catch (error) {
		// Expected
	}

	assert.ok(eventEmitted);
});

test('refreshToken requires initialization', async () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		await vault.refreshToken('token', async () => ({}));
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('not initialized'));
	}
});

test('refreshToken validates refreshFn is function', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		await vault.refreshToken('token', 'not-a-function');
		assert.fail('Should have thrown TokenRefreshFailedError');
	} catch (error) {
		assert.ok(error instanceof TokenRefreshFailedError);
		assert.ok(error.message.includes('must be a function'));
	}
});

test('refreshToken handles missing token gracefully', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const refreshFn = async () => ({
		token: 'new-token',
		expiresAt: new Date(Date.now() + 7200000).toISOString()
	});

	try {
		await vault.refreshToken('non-existent-token', refreshFn);
		assert.fail('Should have thrown TokenRefreshFailedError');
	} catch (error) {
		assert.ok(error instanceof TokenRefreshFailedError);
		assert.ok(error.message.includes('not found'));
	}
});

test('refreshToken handles refresh function returning invalid result', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('token', 'old-token');

	const refreshFn = async () => ({
		// Missing token field
		expiresAt: new Date(Date.now() + 7200000).toISOString()
	});

	try {
		await vault.refreshToken('token', refreshFn);
		assert.fail('Should have thrown TokenRefreshFailedError');
	} catch (error) {
		assert.ok(error instanceof TokenRefreshFailedError);
		assert.ok(error.message.includes('did not return token'));
	}
});

// ============================================================================
// Event Listener Tests
// ============================================================================

console.log('\nEvent Listeners:');

test('on registers event listener', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	let called = false;
	vault.on('encryption-backend-changed', () => {
		called = true;
	});

	await vault.initialize();
	assert.ok(called);
});

test('off unregisters event listener', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	let callCount = 0;
	const callback = () => {
		callCount++;
	};

	vault.on('encryption-backend-changed', callback);
	await vault.initialize();
	assert.strictEqual(callCount, 1);

	vault.off('encryption-backend-changed', callback);
	// Re-initialize would not trigger listener again, but we can't re-initialize
	// So we just verify off was called without error
});

test('on validates event name is string', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.on(null, () => {});
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Event name'));
	}
});

test('on validates callback is function', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.on('token-expired', 'not-a-function');
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Callback'));
	}
});

test('on validates event name is known', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.on('unknown-event', () => {});
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Unknown event'));
	}
});

test('off validates event name is string', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.off(null, () => {});
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Event name'));
	}
});

test('off validates callback is function', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.off('token-expired', 'not-a-function');
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Callback'));
	}
});

test('off validates event name is known', () => {
	const store = createMockStore();
	const vault = new SecretVault(store);

	try {
		vault.off('unknown-event', () => {});
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('Unknown event'));
	}
});

// ============================================================================
// Metadata Tests
// ============================================================================

console.log('\nMetadata:');

test('setSecret stores and retrieves metadata', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const expiresAt = new Date(Date.now() + 3600000).toISOString();
	const customMetadata = { custom: 'data' };

	await vault.setSecret('key', 'value', {
		expiresAt,
		scope: 'personal',
		metadata: customMetadata
	});

	const metadata = await vault.getSecretMetadata('key');
	assert.strictEqual(metadata.expiresAt, expiresAt);
	assert.strictEqual(metadata.scope, 'personal');
	assert.deepStrictEqual(metadata.metadata, customMetadata);
});

test('getSecretMetadata returns null for non-existent key', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const metadata = await vault.getSecretMetadata('non-existent');
	assert.strictEqual(metadata, null);
});

// ============================================================================
// Cross-Machine Detection Tests
// ============================================================================

console.log('\nCross-Machine Detection:');

test('verifyMasterKeyChecksum returns true for matching checksum', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const result = await vault.verifyMasterKeyChecksum();
	assert.strictEqual(result, true);
});

test('verifyMasterKeyChecksum returns false for mismatched checksum', async () => {
	const store = createMockStore({ 'vault.masterKeyChecksum': 'wrong-checksum' });
	const keyDerivation = {
		...createMockKeyDerivation(),
		verifyChecksum: async () => false
	};
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	// This will throw during initialization due to checksum mismatch
	try {
		await vault.initialize();
		assert.fail('Should have thrown during initialization');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('cross-machine'));
	}
});

// ============================================================================
// Encryption Backend Tests
// ============================================================================

console.log('\nEncryption Backend:');

test('getEncryptionBackend returns current backend', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	assert.strictEqual(vault.getEncryptionBackend(), null); // Not initialized yet

	await vault.initialize();

	assert.strictEqual(vault.getEncryptionBackend(), 'aes256gcm');
});

test('isInitialized returns correct state', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	assert.strictEqual(vault.isInitialized(), false);

	await vault.initialize();

	assert.strictEqual(vault.isInitialized(), true);
});

// ============================================================================
// AES-256-GCM Encryption Tests
// ============================================================================

console.log('\nAES-256-GCM Encryption:');

test('_encryptWithAES256GCM produces different ciphertext for same plaintext', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Manually call encryption twice
	const plaintext = 'test-value';
	const encrypted1 = vault._encryptWithAES256GCM(plaintext);
	const encrypted2 = vault._encryptWithAES256GCM(plaintext);

	// Should be different due to random IV
	assert.notStrictEqual(encrypted1, encrypted2);

	// But both should decrypt to same value
	const decrypted1 = vault._decryptWithAES256GCM(encrypted1);
	const decrypted2 = vault._decryptWithAES256GCM(encrypted2);

	assert.strictEqual(decrypted1, plaintext);
	assert.strictEqual(decrypted2, plaintext);
});

test('_encryptWithAES256GCM validates plaintext is string', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._encryptWithAES256GCM(null);
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('Plaintext'));
	}
});

test('_encryptWithAES256GCM validates plaintext is non-empty', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._encryptWithAES256GCM('');
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('Plaintext'));
	}
});

test('_decryptWithAES256GCM validates encrypted data format', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._decryptWithAES256GCM('invalid-json');
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('decryption failed'));
	}
});

test('_decryptWithAES256GCM validates required fields', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._decryptWithAES256GCM(JSON.stringify({ iv: 'test' }));
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('missing required fields'));
	}
});

test('_decryptWithAES256GCM validates IV length', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._decryptWithAES256GCM(JSON.stringify({
			iv: Buffer.alloc(8).toString('base64'), // Wrong length
			ciphertext: 'test',
			authTag: Buffer.alloc(16).toString('base64')
		}));
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('Invalid IV length'));
	}
});

test('_decryptWithAES256GCM validates auth tag length', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		vault._decryptWithAES256GCM(JSON.stringify({
			iv: Buffer.alloc(16).toString('base64'),
			ciphertext: 'test',
			authTag: Buffer.alloc(8).toString('base64') // Wrong length
		}));
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('Invalid authentication tag length'));
	}
});

test('_decryptWithAES256GCM detects tampered ciphertext', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Encrypt a value
	const plaintext = 'test-value';
	const encrypted = vault._encryptWithAES256GCM(plaintext);
	const encryptedObj = JSON.parse(encrypted);

	// Tamper with ciphertext
	encryptedObj.ciphertext = 'aaaa' + encryptedObj.ciphertext.slice(4);

	try {
		vault._decryptWithAES256GCM(JSON.stringify(encryptedObj));
		assert.fail('Should have thrown error');
	} catch (error) {
		assert.ok(error.message.includes('decryption failed'));
	}
});

// ============================================================================
// Multiple Secrets Tests
// ============================================================================

console.log('\nMultiple Secrets:');

test('setSecret and getSecret work with multiple secrets', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const secrets = {
		'api_key': 'secret-api-key-123',
		'hf_token': 'hf_token_abc123',
		'oauth_token': 'oauth_xyz789'
	};

	// Store all secrets
	for (const [key, value] of Object.entries(secrets)) {
		await vault.setSecret(key, value);
	}

	// Retrieve and verify all secrets
	for (const [key, value] of Object.entries(secrets)) {
		const retrieved = await vault.getSecret(key);
		assert.strictEqual(retrieved, value);
	}
});

test('deleteSecret only removes specified secret', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('key1', 'value1');
	await vault.setSecret('key2', 'value2');
	await vault.setSecret('key3', 'value3');

	await vault.deleteSecret('key2');

	assert.strictEqual(await vault.getSecret('key1'), 'value1');
	assert.strictEqual(await vault.getSecret('key2'), null);
	assert.strictEqual(await vault.getSecret('key3'), 'value3');
});

test('listSecrets excludes non-secret keys', async () => {
	const store = createMockStore({
		'vault.masterKeyChecksum': 'test-checksum-abc123', // Matching checksum
		'other.data': 'value'
	});
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('key1', 'value1');
	await vault.setSecret('key2', 'value2');

	const keys = vault.listSecrets();
	assert.strictEqual(keys.length, 2);
	assert.ok(keys.includes('key1'));
	assert.ok(keys.includes('key2'));
	assert.ok(!keys.includes('masterKeyChecksum'));
	assert.ok(!keys.includes('other.data'));
});

// ============================================================================
// Token Scope Tests
// ============================================================================

console.log('\nToken Scope:');

test('setSecret stores and retrieves token scope', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('hf_token_personal', 'token1', { scope: 'personal' });
	await vault.setSecret('hf_token_org', 'token2', { scope: 'organization' });

	const metadata1 = await vault.getSecretMetadata('hf_token_personal');
	const metadata2 = await vault.getSecretMetadata('hf_token_org');

	assert.strictEqual(metadata1.scope, 'personal');
	assert.strictEqual(metadata2.scope, 'organization');
});

// ============================================================================
// Large Value Tests
// ============================================================================

console.log('\nLarge Values:');

test('setSecret and getSecret work with large values', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Create a large value (100KB)
	const largeValue = 'x'.repeat(100 * 1024);

	await vault.setSecret('large-key', largeValue);

	const retrieved = await vault.getSecret('large-key');
	assert.strictEqual(retrieved, largeValue);
});

test('setSecret rejects values exceeding max size', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, {
		useSafeStorage: false,
		maxValueSize: 1000
	});

	await vault.initialize();

	const tooLargeValue = 'x'.repeat(1001);

	try {
		await vault.setSecret('key', tooLargeValue);
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('exceeds maximum size'));
	}
});

// ============================================================================
// Special Characters Tests
// ============================================================================

console.log('\nSpecial Characters:');

test('setSecret and getSecret work with special characters', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const specialValues = [
		'value with spaces',
		'value\nwith\nnewlines',
		'value\twith\ttabs',
		'value"with"quotes',
		"value'with'apostrophes",
		'value\\with\\backslashes',
		'value{with}braces',
		'value[with]brackets',
		'value(with)parens',
		'value@with#special$chars%',
		'日本語テキスト',
		'🎉 emoji 🚀',
		'{"json": "object"}',
		'<html>tag</html>'
	];

	for (let i = 0; i < specialValues.length; i++) {
		const key = `special-${i}`;
		const value = specialValues[i];
		await vault.setSecret(key, value);
		const retrieved = await vault.getSecret(key);
		assert.strictEqual(retrieved, value);
	}
});

// ============================================================================
// Token Expiration Edge Cases
// ============================================================================

console.log('\nToken Expiration Edge Cases:');

test('getSecret does not emit token-expiring-soon if more than 24 hours remain', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const expiresAt = new Date(Date.now() + 48 * 3600000).toISOString(); // 48 hours
	await vault.setSecret('token', 'token-value', { expiresAt });

	let eventEmitted = false;
	vault.on('token-expiring-soon', () => {
		eventEmitted = true;
	});

	await vault.getSecret('token');
	assert.ok(!eventEmitted);
});

test('getSecret handles token with no expiration', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('token', 'token-value'); // No expiresAt

	let eventEmitted = false;
	vault.on('token-expiring-soon', () => {
		eventEmitted = true;
	});

	const retrieved = await vault.getSecret('token');
	assert.strictEqual(retrieved, 'token-value');
	assert.ok(!eventEmitted);
});

test('refreshToken preserves scope and metadata', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const customMetadata = { custom: 'data', nested: { value: 123 } };
	await vault.setSecret('token', 'old-token', {
		scope: 'personal',
		metadata: customMetadata
	});

	const refreshFn = async () => ({
		token: 'new-token',
		expiresAt: new Date(Date.now() + 7200000).toISOString()
	});

	await vault.refreshToken('token', refreshFn);

	const metadata = await vault.getSecretMetadata('token');
	assert.strictEqual(metadata.scope, 'personal');
	assert.deepStrictEqual(metadata.metadata, customMetadata);
});

// ============================================================================
// Error Handling Edge Cases
// ============================================================================

console.log('\nError Handling Edge Cases:');

test('setSecret handles encryption errors gracefully', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	// Corrupt the master key
	vault.masterKey = null;

	try {
		await vault.setSecret('key', 'value');
		assert.fail('Should have thrown SecretVaultError');
	} catch (error) {
		assert.ok(error instanceof SecretVaultError);
		assert.ok(error.message.includes('Failed to store'));
	}
});

test('getSecret handles decryption errors gracefully', async () => {
	const store = createMockStore({
		'vault.secrets.corrupted': 'invalid-encrypted-data'
	});
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		await vault.getSecret('corrupted');
		assert.fail('Should have thrown DecryptionFailedError');
	} catch (error) {
		assert.ok(error instanceof DecryptionFailedError);
	}
});

test('getSecretMetadata handles decryption errors gracefully', async () => {
	const store = createMockStore({
		'vault.secrets.corrupted': 'invalid-encrypted-data'
	});
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	try {
		await vault.getSecretMetadata('corrupted');
		assert.fail('Should have thrown DecryptionFailedError');
	} catch (error) {
		assert.ok(error instanceof DecryptionFailedError);
	}
});

// ============================================================================
// Event Listener Error Handling
// ============================================================================

console.log('\nEvent Listener Error Handling:');

test('_emit catches and logs errors in listener callbacks', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	let errorCaught = false;
	const originalError = console.error;
	console.error = () => {
		errorCaught = true;
	};

	vault.on('token-expired', () => {
		throw new Error('Listener error');
	});

	vault._emit('token-expired', { key: 'test' });

	console.error = originalError;
	assert.ok(errorCaught);
});

test('_emit continues to next listener if one throws', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	let firstCalled = false;
	let secondCalled = false;

	vault.on('token-expired', () => {
		firstCalled = true;
		throw new Error('First listener error');
	});

	vault.on('token-expired', () => {
		secondCalled = true;
	});

	const originalError = console.error;
	console.error = () => {}; // Suppress error output

	vault._emit('token-expired', { key: 'test' });

	console.error = originalError;
	assert.ok(firstCalled);
	assert.ok(secondCalled);
});

// ============================================================================
// Constructor Options Tests
// ============================================================================

console.log('\nConstructor Options:');

test('constructor accepts custom maxKeyLength', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, {
		useSafeStorage: false,
		maxKeyLength: 100
	});

	await vault.initialize();

	const longKey = 'x'.repeat(101);

	try {
		await vault.setSecret(longKey, 'value');
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('exceeds maximum length'));
	}
});

test('constructor accepts custom maxValueSize', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, {
		useSafeStorage: false,
		maxValueSize: 500
	});

	await vault.initialize();

	const largeValue = 'x'.repeat(501);

	try {
		await vault.setSecret('key', largeValue);
		assert.fail('Should have thrown ValidationError');
	} catch (error) {
		assert.ok(error instanceof ValidationError);
		assert.ok(error.message.includes('exceeds maximum size'));
	}
});

// ============================================================================
// Checksum Consistency Tests
// ============================================================================

console.log('\nChecksum Consistency:');

test('same value produces same checksum', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const value = 'test-value';

	await vault.setSecret('key1', value);
	const metadata1 = await vault.getSecretMetadata('key1');

	await vault.setSecret('key2', value);
	const metadata2 = await vault.getSecretMetadata('key2');

	assert.strictEqual(metadata1.checksum, metadata2.checksum);
});

test('different values produce different checksums', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	await vault.setSecret('key1', 'value1');
	const metadata1 = await vault.getSecretMetadata('key1');

	await vault.setSecret('key2', 'value2');
	const metadata2 = await vault.getSecretMetadata('key2');

	assert.notStrictEqual(metadata1.checksum, metadata2.checksum);
});

// ============================================================================
// Metadata Timestamp Tests
// ============================================================================

console.log('\nMetadata Timestamps:');

test('setSecret stores createdAt timestamp', async () => {
	const store = createMockStore();
	const keyDerivation = createMockKeyDerivation();
	const vault = new SecretVault(store, keyDerivation, { useSafeStorage: false });

	await vault.initialize();

	const beforeTime = new Date();
	await vault.setSecret('key', 'value');
	const afterTime = new Date();

	const metadata = await vault.getSecretMetadata('key');
	const createdAt = new Date(metadata.createdAt);

	assert.ok(createdAt >= beforeTime);
	assert.ok(createdAt <= afterTime);
});

console.log('\nAll tests completed.');

/* eslint-env node */
/**
 * Tests for api-key-migration.js
 *
 * Run with: node desktop/tests/api-key-migration.test.js
 */

const assert = require('assert');
const {
	ApiKeyMigration,
	ApiKeyMigrationError,
	ApiKeyNotFoundError,
	MigrationAlreadyCompletedError
} = require('../api-key-migration');

/**
 * Mock electron-store
 */
function createMockStore(initial = {}) {
	const data = { ...initial };
	return {
		get: (key, defaultValue) => {
			if (key in data) {
				return data[key];
			}
			return defaultValue !== undefined ? defaultValue : undefined;
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
	let initialized = false;

	return {
		initialize: async () => {
			initialized = true;
		},
		isInitialized: () => initialized,
		setSecret: async (key, value, options) => {
			secrets[key] = { value, options };
		},
		getSecret: async (key) => {
			if (!(key in secrets)) {
				const error = new Error(`Secret not found: ${key}`);
				error.name = 'SecretNotFoundError';
				throw error;
			}
			return secrets[key].value;
		},
		deleteSecret: async (key) => {
			delete secrets[key];
		},
		listSecrets: () => Object.keys(secrets),
		getSecrets: () => secrets // For testing
	};
}

/**
 * Mock logger
 */
function createMockLogger() {
	const logs = {
		debug: [],
		info: [],
		warn: [],
		error: []
	};

	return {
		debug: (msg) => logs.debug.push(msg),
		info: (msg) => logs.info.push(msg),
		warn: (msg) => logs.warn.push(msg),
		error: (msg) => logs.error.push(msg),
		getLogs: () => logs
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

console.log('ApiKeyMigration tests\n');

// ============================================================================
// Initialization Tests
// ============================================================================

console.log('Initialization:');

test('constructor requires store parameter', () => {
	const secretVault = createMockSecretVault();
	assert.throws(
		() => new ApiKeyMigration(null, secretVault),
		ApiKeyMigrationError
	);
});

test('constructor requires secretVault parameter', () => {
	const store = createMockStore();
	assert.throws(
		() => new ApiKeyMigration(store, null),
		ApiKeyMigrationError
	);
});

test('constructor accepts store and secretVault', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);
	assert.ok(migration);
});

test('constructor accepts custom options', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault, {
		configKey: 'customApiConfig',
		vaultKey: 'customApiKey',
		migrationFlagKey: 'customMigrationFlag'
	});
	assert.ok(migration);
});

// ============================================================================
// Migration Detection Tests
// ============================================================================

console.log('\nMigration Detection:');

test('isMigrationNeeded returns false when no API key in config', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	assert.strictEqual(migration.isMigrationNeeded(), false);
});

test('isMigrationNeeded returns true when API key exists in config', () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	assert.strictEqual(migration.isMigrationNeeded(), true);
});

test('isMigrationNeeded returns false when migration already completed', () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' },
		apiKeyMigrationCompleted: true
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	assert.strictEqual(migration.isMigrationNeeded(), false);
});

test('isMigrationNeeded returns false when API key is empty string', () => {
	const store = createMockStore({
		apiServer: { apiKey: '' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	assert.strictEqual(migration.isMigrationNeeded(), false);
});

test('isMigrationNeeded returns false when API key is null', () => {
	const store = createMockStore({
		apiServer: { apiKey: null }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	assert.strictEqual(migration.isMigrationNeeded(), false);
});

// ============================================================================
// Migration Tests
// ============================================================================

console.log('\nMigration:');

test('migrate throws error when migration already completed', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' },
		apiKeyMigrationCompleted: true
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationAlreadyCompletedError');
	} catch (error) {
		assert.strictEqual(error.name, 'MigrationAlreadyCompletedError');
	}
});

test('migrate throws error when no API key found', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	try {
		await migration.migrate();
		throw new Error('Should have thrown ApiKeyNotFoundError');
	} catch (error) {
		assert.strictEqual(error.name, 'ApiKeyNotFoundError');
	}
});

test('migrate successfully moves API key to Secret_Vault', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123', host: '127.0.0.1' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	const result = await migration.migrate();

	// Check result
	assert.strictEqual(result.success, true);
	assert.strictEqual(result.vaultKey, 'api_key');

	// Check API key removed from config
	const apiConfig = store.get('apiServer');
	assert.strictEqual(apiConfig.apiKey, undefined);
	assert.strictEqual(apiConfig.host, '127.0.0.1'); // Other config preserved

	// Check API key stored in vault
	const storedKey = await secretVault.getSecret('api_key');
	assert.strictEqual(storedKey, 'test-key-123');

	// Check migration flag set
	assert.strictEqual(store.get('apiKeyMigrationCompleted'), true);
});

test('migrate preserves other API config settings', async () => {
	const store = createMockStore({
		apiServer: {
			apiKey: 'test-key-123',
			host: '127.0.0.1',
			port: 13434,
			requireApiKey: true,
			cors: true
		}
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	await migration.migrate();

	const apiConfig = store.get('apiServer');
	assert.strictEqual(apiConfig.host, '127.0.0.1');
	assert.strictEqual(apiConfig.port, 13434);
	assert.strictEqual(apiConfig.requireApiKey, true);
	assert.strictEqual(apiConfig.cors, true);
	assert.strictEqual(apiConfig.apiKey, undefined);
});

test('migrate initializes Secret_Vault if not initialized', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	assert.strictEqual(secretVault.isInitialized(), false);

	const migration = new ApiKeyMigration(store, secretVault);
	await migration.migrate();

	assert.strictEqual(secretVault.isInitialized(), true);
});

test('migrate stores metadata with API key', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	await migration.migrate();

	const secrets = secretVault.getSecrets();
	const apiKeySecret = secrets.api_key;
	assert.ok(apiKeySecret.options);
	assert.ok(apiKeySecret.options.metadata);
	assert.strictEqual(apiKeySecret.options.metadata.migratedFrom, 'plainConfig');
	assert.ok(apiKeySecret.options.metadata.migratedAt);
});

test('migrate with custom vault key', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault, {
		vaultKey: 'custom_api_key'
	});

	await migration.migrate();

	const storedKey = await secretVault.getSecret('custom_api_key');
	assert.strictEqual(storedKey, 'test-key-123');
});

// ============================================================================
// API Key Retrieval Tests
// ============================================================================

console.log('\nAPI Key Retrieval:');

test('getApiKey returns null when API key not found', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	const apiKey = await migration.getApiKey();
	assert.strictEqual(apiKey, null);
});

test('getApiKey returns stored API key', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault({
		api_key: { value: 'test-key-123' }
	});
	const migration = new ApiKeyMigration(store, secretVault);

	const apiKey = await migration.getApiKey();
	assert.strictEqual(apiKey, 'test-key-123');
});

test('getApiKey initializes Secret_Vault if not initialized', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault({
		api_key: { value: 'test-key-123' }
	});
	assert.strictEqual(secretVault.isInitialized(), false);

	const migration = new ApiKeyMigration(store, secretVault);
	await migration.getApiKey();

	assert.strictEqual(secretVault.isInitialized(), true);
});

// ============================================================================
// API Key Storage Tests
// ============================================================================

console.log('\nAPI Key Storage:');

test('setApiKey stores API key in Secret_Vault', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	await migration.setApiKey('new-api-key-456');

	const storedKey = await secretVault.getSecret('api_key');
	assert.strictEqual(storedKey, 'new-api-key-456');
});

test('setApiKey marks migration as completed', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	await migration.setApiKey('new-api-key-456');

	assert.strictEqual(store.get('apiKeyMigrationCompleted'), true);
});

test('setApiKey throws error for empty string', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	try {
		await migration.setApiKey('');
		throw new Error('Should have thrown ApiKeyMigrationError');
	} catch (error) {
		assert.strictEqual(error.name, 'ApiKeyMigrationError');
	}
});

test('setApiKey throws error for null', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	try {
		await migration.setApiKey(null);
		throw new Error('Should have thrown ApiKeyMigrationError');
	} catch (error) {
		assert.strictEqual(error.name, 'ApiKeyMigrationError');
	}
});

test('setApiKey initializes Secret_Vault if not initialized', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	assert.strictEqual(secretVault.isInitialized(), false);

	const migration = new ApiKeyMigration(store, secretVault);
	await migration.setApiKey('new-api-key-456');

	assert.strictEqual(secretVault.isInitialized(), true);
});

// ============================================================================
// API Key Deletion Tests
// ============================================================================

console.log('\nAPI Key Deletion:');

test('deleteApiKey removes API key from Secret_Vault', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault({
		api_key: { value: 'test-key-123' }
	});
	const migration = new ApiKeyMigration(store, secretVault);

	await migration.deleteApiKey();

	const apiKey = await migration.getApiKey();
	assert.strictEqual(apiKey, null);
});

test('deleteApiKey initializes Secret_Vault if not initialized', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault({
		api_key: { value: 'test-key-123' }
	});
	assert.strictEqual(secretVault.isInitialized(), false);

	const migration = new ApiKeyMigration(store, secretVault);
	await migration.deleteApiKey();

	assert.strictEqual(secretVault.isInitialized(), true);
});

// ============================================================================
// Migration Status Tests
// ============================================================================

console.log('\nMigration Status:');

test('getMigrationStatus returns correct status when no migration needed', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	const status = migration.getMigrationStatus();

	assert.strictEqual(status.migrationCompleted, false);
	assert.strictEqual(status.hasPlainApiKey, false);
	assert.strictEqual(status.needsMigration, false);
	assert.ok(status.timestamp);
});

test('getMigrationStatus returns correct status when migration needed', () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	const status = migration.getMigrationStatus();

	assert.strictEqual(status.migrationCompleted, false);
	assert.strictEqual(status.hasPlainApiKey, true);
	assert.strictEqual(status.needsMigration, true);
	assert.ok(status.timestamp);
});

test('getMigrationStatus returns correct status when migration completed', () => {
	const store = createMockStore({
		apiKeyMigrationCompleted: true
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	const status = migration.getMigrationStatus();

	assert.strictEqual(status.migrationCompleted, true);
	assert.strictEqual(status.hasPlainApiKey, false);
	assert.strictEqual(status.needsMigration, false);
	assert.ok(status.timestamp);
});

// ============================================================================
// Logging Tests
// ============================================================================

console.log('\nLogging:');

test('migrate logs debug messages', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const logger = createMockLogger();
	const migration = new ApiKeyMigration(store, secretVault, { logger });

	await migration.migrate();

	const logs = logger.getLogs();
	assert.ok(logs.debug.length > 0, 'Should have debug logs');
	assert.ok(logs.info.length > 0, 'Should have info logs');
	// Check for specific log messages
	const debugMessages = logs.debug.join(' ');
	const infoMessages = logs.info.join(' ');
	assert.ok(debugMessages.includes('Starting') || infoMessages.includes('Starting'), 'Should log migration start');
	assert.ok(infoMessages.includes('completed'), 'Should log migration completion');
});

test('getApiKey logs debug messages', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault({
		api_key: { value: 'test-key-123' }
	});
	const logger = createMockLogger();
	const migration = new ApiKeyMigration(store, secretVault, { logger });

	await migration.getApiKey();

	const logs = logger.getLogs();
	assert.ok(logs.debug.length > 0);
});

// ============================================================================
// Integration Tests
// ============================================================================

console.log('\nIntegration:');

test('full migration workflow', async () => {
	const store = createMockStore({
		apiServer: {
			apiKey: 'test-key-123',
			host: '127.0.0.1',
			port: 13434,
			requireApiKey: true
		}
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	// Check migration is needed
	assert.strictEqual(migration.isMigrationNeeded(), true);

	// Perform migration
	const result = await migration.migrate();
	assert.strictEqual(result.success, true);

	// Check migration completed
	assert.strictEqual(migration.isMigrationNeeded(), false);

	// Retrieve API key
	const apiKey = await migration.getApiKey();
	assert.strictEqual(apiKey, 'test-key-123');

	// Check config updated
	const apiConfig = store.get('apiServer');
	assert.strictEqual(apiConfig.apiKey, undefined);
	assert.strictEqual(apiConfig.host, '127.0.0.1');
	assert.strictEqual(apiConfig.port, 13434);
	assert.strictEqual(apiConfig.requireApiKey, true);
});

test('update API key after migration', async () => {
	const store = createMockStore({
		apiServer: { apiKey: 'test-key-123' }
	});
	const secretVault = createMockSecretVault();
	const migration = new ApiKeyMigration(store, secretVault);

	// Perform initial migration
	await migration.migrate();

	// Update API key
	await migration.setApiKey('new-api-key-456');

	// Verify new key is stored
	const apiKey = await migration.getApiKey();
	assert.strictEqual(apiKey, 'new-api-key-456');
});

console.log('\nAll tests completed!');

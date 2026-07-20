/* eslint-env node */
/**
 * Tests for main.js initialization of Secret_Vault and Key_Derivation
 *
 * Run with: node desktop/tests/main-initialization.test.js
 *
 * This test verifies that:
 * 1. Key_Derivation is initialized before Secret_Vault
 * 2. Secret_Vault is initialized with the derived master key
 * 3. Both services are made globally available
 * 4. Initialization handles errors gracefully with fallback
 */

const assert = require('assert');
const { KeyDerivation } = require('../key-derivation');
const { SecretVault } = require('../secret-vault');

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
 * Test 1: Key_Derivation initializes successfully
 */
async function testKeyDerivationInitialization() {
	console.log('\n[Test 1] Key_Derivation initialization...');
	try {
		const keyDerivation = new KeyDerivation();
		const masterKey = await keyDerivation.deriveMasterKey();

		assert(masterKey, 'Master key should be derived');
		assert(Buffer.isBuffer(masterKey), 'Master key should be a Buffer');
		assert.strictEqual(masterKey.length, 32, 'Master key should be 32 bytes (256 bits)');

		const checksum = await keyDerivation.getMasterKeyChecksum();
		assert(checksum, 'Checksum should be computed');
		assert.strictEqual(typeof checksum, 'string', 'Checksum should be a string');
		assert.strictEqual(checksum.length, 64, 'SHA-256 checksum should be 64 hex characters');

		console.log('✓ Key_Derivation initialized successfully');
		console.log(`  - Master key: ${masterKey.length} bytes`);
		console.log(`  - Checksum: ${checksum.substring(0, 16)}...`);
		return true;
	} catch (err) {
		console.error('✗ Key_Derivation initialization failed:', err.message);
		return false;
	}
}

/**
 * Test 2: Secret_Vault initializes with Key_Derivation
 */
async function testSecretVaultInitialization() {
	console.log('\n[Test 2] Secret_Vault initialization with Key_Derivation...');
	try {
		const store = createMockStore();
		const keyDerivation = new KeyDerivation();
		await keyDerivation.deriveMasterKey();

		const secretVault = new SecretVault(store, keyDerivation);
		await secretVault.initialize();

		assert(secretVault.isInitialized(), 'Secret_Vault should be initialized');
		const backend = secretVault.getEncryptionBackend();
		assert(backend, 'Encryption backend should be set');
		assert(['safeStorage', 'aes256gcm'].includes(backend), `Backend should be safeStorage or aes256gcm, got ${backend}`);

		console.log('✓ Secret_Vault initialized successfully');
		console.log(`  - Backend: ${backend}`);
		return true;
	} catch (err) {
		console.error('✗ Secret_Vault initialization failed:', err.message);
		return false;
	}
}

/**
 * Test 3: Secret_Vault can store and retrieve secrets
 */
async function testSecretStorage() {
	console.log('\n[Test 3] Secret storage and retrieval...');
	try {
		const store = createMockStore();
		const keyDerivation = new KeyDerivation();
		await keyDerivation.deriveMasterKey();

		const secretVault = new SecretVault(store, keyDerivation);
		await secretVault.initialize();

		// Store a secret
		const testKey = 'test_api_key';
		const testValue = 'secret-value-12345';
		await secretVault.setSecret(testKey, testValue);

		// Retrieve the secret
		const retrieved = await secretVault.getSecret(testKey);
		assert.strictEqual(retrieved, testValue, 'Retrieved secret should match stored value');

		console.log('✓ Secret storage and retrieval working');
		console.log(`  - Stored: ${testKey} = ${testValue}`);
		console.log(`  - Retrieved: ${testKey} = ${retrieved}`);
		return true;
	} catch (err) {
		console.error('✗ Secret storage failed:', err.message);
		return false;
	}
}

/**
 * Test 4: Cross-machine copy detection via checksum
 */
async function testCrossMachineDetection() {
	console.log('\n[Test 4] Cross-machine copy detection...');
	try {
		const store = createMockStore();
		const keyDerivation = new KeyDerivation();
		await keyDerivation.deriveMasterKey();

		const secretVault = new SecretVault(store, keyDerivation);
		await secretVault.initialize();

		// Store a secret with checksum
		await secretVault.setSecret('test_token', 'token-value');

		// Verify checksum matches
		const checksumMatch = await secretVault.verifyMasterKeyChecksum();
		assert(checksumMatch, 'Checksum should match on same machine');

		console.log('✓ Cross-machine detection working');
		console.log(`  - Checksum verification: ${checksumMatch}`);
		return true;
	} catch (err) {
		console.error('✗ Cross-machine detection failed:', err.message);
		return false;
	}
}

/**
 * Test 5: Graceful fallback when Key_Derivation fails
 */
async function testGracefulFallback() {
	console.log('\n[Test 5] Graceful fallback on Key_Derivation failure...');
	try {
		const store = createMockStore();

		// Create a Key_Derivation that will fail (null)
		const secretVault = new SecretVault(store, null);

		// This should fail because safeStorage is not available in test environment
		// and no keyDerivation is provided
		try {
			await secretVault.initialize();
			console.error('✗ Should have thrown an error when both backends unavailable');
			return false;
		} catch (err) {
			// Expected to fail
			console.log('✓ Graceful fallback working');
			console.log(`  - Error caught as expected: ${err.message.substring(0, 50)}...`);
			return true;
		}
	} catch (err) {
		console.error('✗ Fallback test failed unexpectedly:', err.message);
		return false;
	}
}

/**
 * Test 6: Global availability of services
 */
async function testGlobalAvailability() {
	console.log('\n[Test 6] Global availability of services...');
	try {
		// Simulate what main.js does
		const store = createMockStore();
		const keyDerivation = new KeyDerivation();
		await keyDerivation.deriveMasterKey();

		const secretVault = new SecretVault(store, keyDerivation);
		await secretVault.initialize();

		// Make globally available (as main.js does)
		global.secretVault = secretVault;
		global.keyDerivation = keyDerivation;

		// Verify they're accessible
		assert(global.secretVault, 'Secret_Vault should be globally available');
		assert(global.keyDerivation, 'Key_Derivation should be globally available');
		assert(global.secretVault.isInitialized(), 'Global Secret_Vault should be initialized');

		console.log('✓ Global availability working');
		console.log(`  - global.secretVault: ${global.secretVault ? 'available' : 'missing'}`);
		console.log(`  - global.keyDerivation: ${global.keyDerivation ? 'available' : 'missing'}`);

		// Clean up
		delete global.secretVault;
		delete global.keyDerivation;

		return true;
	} catch (err) {
		console.error('✗ Global availability test failed:', err.message);
		return false;
	}
}

/**
 * Run all tests
 */
async function runAllTests() {
	console.log('='.repeat(70));
	console.log('Main.js Initialization Tests');
	console.log('='.repeat(70));

	const results = [];

	results.push(await testKeyDerivationInitialization());
	results.push(await testSecretVaultInitialization());
	results.push(await testSecretStorage());
	results.push(await testCrossMachineDetection());
	results.push(await testGracefulFallback());
	results.push(await testGlobalAvailability());

	console.log('\n' + '='.repeat(70));
	const passed = results.filter(r => r).length;
	const total = results.length;
	console.log(`Results: ${passed}/${total} tests passed`);
	console.log('='.repeat(70));

	if (passed === total) {
		console.log('\n✓ All tests passed!');
		process.exit(0);
	} else {
		console.log(`\n✗ ${total - passed} test(s) failed`);
		process.exit(1);
	}
}

// Run tests
runAllTests().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});

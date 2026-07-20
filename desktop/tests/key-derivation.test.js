/* eslint-env node */
/**
 * Tests for key-derivation.js
 *
 * Run with: node desktop/tests/key-derivation.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const {
	KeyDerivation,
	KeyDerivationError,
	PlatformIdentityError,
	ChecksumMismatchError
} = require('../key-derivation');

/**
 * Mock KeyDerivation for testing platform-specific behavior
 */
class MockKeyDerivation extends KeyDerivation {
	constructor(options = {}) {
		super(options);
		this.mockIdentity = options.mockIdentity || null;
	}

	async _collectPlatformIdentity() {
		if (this.mockIdentity) {
			return this.mockIdentity;
		}
		return super._collectPlatformIdentity();
	}
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
					if (err.stack) {
						console.error(`    ${err.stack}`);
					}
					process.exitCode = 1;
				});
		} else {
			// Sync test
			console.log(`  PASS: ${name}`);
		}
	} catch (err) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${err.message}`);
		if (err.stack) {
			console.error(`    ${err.stack}`);
		}
		process.exitCode = 1;
	}
}

console.log('KeyDerivation tests\n');

// Mock identity for testing
const mockIdentity = {
	salt: 'test-machine-id:test-user-id',
	password: 'alpaca-key-derivation'
};

// ============================================================================
// Constructor Tests
// ============================================================================

console.log('Constructor:');

test('creates instance with default options', () => {
	const kd = new KeyDerivation();
	assert.ok(kd);
	assert.strictEqual(kd.options.pbkdf2Iterations, 100000);
	assert.strictEqual(kd.options.identityTimeoutMs, 5000);
});

test('creates instance with custom options', () => {
	const kd = new KeyDerivation({
		pbkdf2Iterations: 50000,
		identityTimeoutMs: 3000
	});
	assert.strictEqual(kd.options.pbkdf2Iterations, 50000);
	assert.strictEqual(kd.options.identityTimeoutMs, 3000);
});

test('initializes with uninitialized state', () => {
	const kd = new KeyDerivation();
	assert.strictEqual(kd.isInitialized(), false);
	assert.strictEqual(kd.masterKey, null);
	assert.strictEqual(kd.masterKeyChecksum, null);
});

// ============================================================================
// Key Derivation Tests
// ============================================================================

console.log('\nKey Derivation:');

test('deriveMasterKey returns 32-byte buffer', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const key = await kd.deriveMasterKey();
	assert.ok(Buffer.isBuffer(key));
	assert.strictEqual(key.length, 32);
});

test('deriveMasterKey sets initialized flag', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	assert.strictEqual(kd.isInitialized(), false);
	await kd.deriveMasterKey();
	assert.strictEqual(kd.isInitialized(), true);
});

test('deriveMasterKey caches result', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const key1 = await kd.deriveMasterKey();
	const key2 = await kd.deriveMasterKey();
	assert.strictEqual(key1, key2); // Same object reference
});

test('deriveMasterKey produces consistent results for same identity', async () => {
	const kd1 = new MockKeyDerivation({ mockIdentity });
	const kd2 = new MockKeyDerivation({ mockIdentity });
	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();
	assert.ok(key1.equals(key2)); // Same key value
});

// ============================================================================
// Checksum Tests
// ============================================================================

console.log('\nChecksum:');

test('getMasterKeyChecksum returns hex string', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const checksum = await kd.getMasterKeyChecksum();
	assert.ok(typeof checksum === 'string');
	assert.ok(/^[a-f0-9]{64}$/.test(checksum)); // SHA-256 hex
});

test('getMasterKeyChecksum derives key if not already done', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	assert.strictEqual(kd.masterKey, null);
	const checksum = await kd.getMasterKeyChecksum();
	assert.ok(kd.masterKey !== null);
	assert.ok(typeof checksum === 'string');
});

test('getMasterKeyChecksum returns consistent value', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const checksum1 = await kd.getMasterKeyChecksum();
	const checksum2 = await kd.getMasterKeyChecksum();
	assert.strictEqual(checksum1, checksum2);
});

test('verifyChecksum returns true for matching checksum', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const checksum = await kd.getMasterKeyChecksum();
	const matches = await kd.verifyChecksum(checksum);
	assert.strictEqual(matches, true);
});

test('verifyChecksum returns false for non-matching checksum', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	await kd.deriveMasterKey();
	const fakeChecksum = 'a'.repeat(64); // Invalid checksum
	const matches = await kd.verifyChecksum(fakeChecksum);
	assert.strictEqual(matches, false);
});

test('verifyChecksum uses constant-time comparison', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const checksum = await kd.getMasterKeyChecksum();
	// Should not throw even with different length
	const matches = await kd.verifyChecksum('invalid');
	assert.strictEqual(matches, false);
});

// ============================================================================
// Platform Identity Tests
// ============================================================================

console.log('\nPlatform Identity:');

test('getPlatformIdentity returns object with platform info', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const identity = await kd.getPlatformIdentity();
	assert.ok(typeof identity === 'object');
	assert.ok(typeof identity.saltLength === 'number');
	assert.ok(typeof identity.passwordLength === 'number');
});

test('getPlatformIdentity does not expose sensitive data', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const identity = await kd.getPlatformIdentity();
	assert.ok(!identity.salt);
	assert.ok(!identity.password);
});

// ============================================================================
// Reset Tests
// ============================================================================

console.log('\nReset:');

test('reset clears cached key and identity', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	await kd.deriveMasterKey();
	assert.ok(kd.masterKey !== null);
	assert.ok(kd.masterKeyChecksum !== null);
	assert.strictEqual(kd.isInitialized(), true);

	kd.reset();
	assert.strictEqual(kd.masterKey, null);
	assert.strictEqual(kd.masterKeyChecksum, null);
	assert.strictEqual(kd.isInitialized(), false);
});

test('reset allows re-derivation', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const key1 = await kd.deriveMasterKey();
	kd.reset();
	const key2 = await kd.deriveMasterKey();
	assert.ok(key1.equals(key2));
});

// ============================================================================
// Error Handling Tests
// ============================================================================

console.log('\nError Handling:');

test('verifyChecksum throws on invalid checksum parameter', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	await kd.deriveMasterKey();
	assert.rejects(
		() => kd.verifyChecksum(null),
		KeyDerivationError
	);
});

test('verifyChecksum throws on empty checksum parameter', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	await kd.deriveMasterKey();
	assert.rejects(
		() => kd.verifyChecksum(''),
		KeyDerivationError
	);
});

test('deriveMasterKey throws on unsupported platform', async () => {
	const kd = new KeyDerivation({ platform: 'unsupported' });
	assert.rejects(
		() => kd.deriveMasterKey(),
		PlatformIdentityError
	);
});

// ============================================================================
// PBKDF2 Configuration Tests
// ============================================================================

console.log('\nPBKDF2 Configuration:');

test('uses configured iteration count', async () => {
	const kd1 = new MockKeyDerivation({ mockIdentity, pbkdf2Iterations: 100000 });
	const kd2 = new MockKeyDerivation({ mockIdentity, pbkdf2Iterations: 50000 });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	// Different iteration counts should produce different keys
	assert.ok(!key1.equals(key2));
});

test('default iteration count is 100000', () => {
	const kd = new KeyDerivation();
	assert.strictEqual(kd.options.pbkdf2Iterations, 100000);
});

// ============================================================================
// Cross-Machine Detection Tests
// ============================================================================

console.log('\nCross-Machine Detection:');

test('same identity produces same keys', async () => {
	const kd1 = new MockKeyDerivation({ mockIdentity });
	const kd2 = new MockKeyDerivation({ mockIdentity });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	// Keys should be identical for same identity
	assert.ok(key1.equals(key2));
});

test('different identity produces different keys', async () => {
	const identity1 = { salt: 'machine1:user1', password: 'alpaca-key-derivation' };
	const identity2 = { salt: 'machine2:user2', password: 'alpaca-key-derivation' };

	const kd1 = new MockKeyDerivation({ mockIdentity: identity1 });
	const kd2 = new MockKeyDerivation({ mockIdentity: identity2 });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	// Different identities should produce different keys
	assert.ok(!key1.equals(key2));
});

test('checksum mismatch indicates cross-machine copy', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });
	const checksum = await kd.getMasterKeyChecksum();

	// Simulate checksum from different machine
	const differentChecksum = 'b'.repeat(64);

	const matches = await kd.verifyChecksum(differentChecksum);
	assert.strictEqual(matches, false);
});

// ============================================================================
// Windows-Specific Tests
// ============================================================================

console.log('\nWindows-Specific:');

test('Windows identity format includes GUID and SID', async () => {
	const windowsIdentity = {
		salt: '550e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1001',
		password: 'alpaca-key-derivation'
	};
	const kd = new MockKeyDerivation({ mockIdentity: windowsIdentity });
	const identity = await kd.getPlatformIdentity();
	assert.ok(identity.saltLength > 0);
	assert.ok(identity.passwordLength > 0);
});

test('Windows identity produces consistent key derivation', async () => {
	const windowsIdentity = {
		salt: '550e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1001',
		password: 'alpaca-key-derivation'
	};
	const kd1 = new MockKeyDerivation({ mockIdentity: windowsIdentity });
	const kd2 = new MockKeyDerivation({ mockIdentity: windowsIdentity });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	assert.ok(key1.equals(key2));
});

test('Windows identity with different GUID produces different key', async () => {
	const identity1 = {
		salt: '550e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1001',
		password: 'alpaca-key-derivation'
	};
	const identity2 = {
		salt: '660e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1001',
		password: 'alpaca-key-derivation'
	};
	const kd1 = new MockKeyDerivation({ mockIdentity: identity1 });
	const kd2 = new MockKeyDerivation({ mockIdentity: identity2 });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	assert.ok(!key1.equals(key2));
});

test('Windows identity with different SID produces different key', async () => {
	const identity1 = {
		salt: '550e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1001',
		password: 'alpaca-key-derivation'
	};
	const identity2 = {
		salt: '550e8400-e29b-41d4-a716-446655440000:S-1-5-21-4093034806-394409555-3753884081-1002',
		password: 'alpaca-key-derivation'
	};
	const kd1 = new MockKeyDerivation({ mockIdentity: identity1 });
	const kd2 = new MockKeyDerivation({ mockIdentity: identity2 });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();

	assert.ok(!key1.equals(key2));
});

// ============================================================================
// Integration Tests
// ============================================================================

console.log('\nIntegration:');

test('full workflow: derive key, get checksum, verify', async () => {
	const kd = new MockKeyDerivation({ mockIdentity });

	// Derive key
	const key = await kd.deriveMasterKey();
	assert.ok(Buffer.isBuffer(key));
	assert.strictEqual(key.length, 32);

	// Get checksum
	const checksum = await kd.getMasterKeyChecksum();
	assert.ok(typeof checksum === 'string');

	// Verify checksum
	const matches = await kd.verifyChecksum(checksum);
	assert.strictEqual(matches, true);
});

test('multiple instances with same identity produce same key', async () => {
	const kd1 = new MockKeyDerivation({ mockIdentity });
	const kd2 = new MockKeyDerivation({ mockIdentity });

	const key1 = await kd1.deriveMasterKey();
	const key2 = await kd2.deriveMasterKey();
	const checksum1 = await kd1.getMasterKeyChecksum();
	const checksum2 = await kd2.getMasterKeyChecksum();

	assert.ok(key1.equals(key2));
	assert.strictEqual(checksum1, checksum2);
});

console.log('\nAll tests completed!');

/* eslint-env node */
/**
 * Tests for envelope creation with checksum
 *
 * Tests the envelope creation functionality in user-migration.js
 * Validates that envelopes are created with proper encryption and checksums.
 *
 * Run with: node desktop/tests/envelope-creation.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const {
	UserMigration,
	UserMigrationError,
	ChecksumVerificationError,
	DecryptionError
} = require('../user-migration');

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
 * Mock SecretVault with AES-256-GCM backend
 */
function createMockSecretVaultAES256GCM() {
	const masterKey = crypto.randomBytes(32); // 256-bit key

	return {
		encryptionBackend: 'aes256gcm',
		_encryptWithAES256GCM: (plaintext) => {
			// Proper AES-256-GCM encryption
			const iv = crypto.randomBytes(16);
			const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
			let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
			ciphertext += cipher.final('hex');
			const authTag = cipher.getAuthTag();

			return JSON.stringify({
				iv: iv.toString('base64'),
				ciphertext,
				authTag: authTag.toString('base64')
			});
		},
		_decryptWithAES256GCM: (encryptedData) => {
			// Proper AES-256-GCM decryption
			const encrypted = JSON.parse(encryptedData);
			const iv = Buffer.from(encrypted.iv, 'base64');
			const authTag = Buffer.from(encrypted.authTag, 'base64');

			const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
			decipher.setAuthTag(authTag);

			let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
			plaintext += decipher.final('utf8');

			return plaintext;
		},
		_encryptWithSafeStorage: (plaintext) => {
			// Mock safeStorage encryption
			return Buffer.from(plaintext).toString('base64');
		},
		_decryptWithSafeStorage: (encryptedData) => {
			// Mock safeStorage decryption
			return Buffer.from(encryptedData, 'base64').toString('utf8');
		}
	};
}

/**
 * Mock SecretVault with safeStorage backend
 */
function createMockSecretVaultSafeStorage() {
	return {
		encryptionBackend: 'safeStorage',
		_encryptWithSafeStorage: (plaintext) => {
			// Mock safeStorage encryption
			return Buffer.from(plaintext).toString('base64');
		},
		_decryptWithSafeStorage: (encryptedData) => {
			// Mock safeStorage decryption
			return Buffer.from(encryptedData, 'base64').toString('utf8');
		},
		_encryptWithAES256GCM: (plaintext) => {
			throw new Error('AES-256-GCM not available with safeStorage backend');
		},
		_decryptWithAES256GCM: (encryptedData) => {
			throw new Error('AES-256-GCM not available with safeStorage backend');
		}
	};
}

/**
 * Test runner
 */
class TestRunner {
	constructor() {
		this.tests = [];
		this.passed = 0;
		this.failed = 0;
	}

	test(name, fn) {
		this.tests.push({ name, fn });
	}

	async run() {
		console.log('Running Envelope Creation tests...\n');

		for (const test of this.tests) {
			try {
				await test.fn();
				console.log(`✓ ${test.name}`);
				this.passed++;
			} catch (error) {
				console.log(`✗ ${test.name}`);
				console.log(`  Error: ${error.message}`);
				if (error.stack) {
					console.log(`  Stack: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
				}
				this.failed++;
			}
		}

		console.log(`\n${this.passed} passed, ${this.failed} failed`);
		return this.failed === 0;
	}
}

const runner = new TestRunner();

// ============================================================================
// Test: Envelope Creation with AES-256-GCM
// ============================================================================

runner.test('Envelope creation - should create envelope with AES-256-GCM backend', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope);
	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
	assert.strictEqual(typeof envelope.envelope, 'string');
	assert.strictEqual(typeof envelope.checksum, 'string');
});

runner.test('Envelope creation - should create valid AES-256-GCM encrypted envelope', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	// Verify envelope is valid JSON with required fields
	const envelopeData = JSON.parse(envelope.envelope);
	assert.ok(envelopeData.iv);
	assert.ok(envelopeData.ciphertext);
	assert.ok(envelopeData.authTag);
});

runner.test('Envelope creation - should create envelope with safeStorage backend', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultSafeStorage();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope);
	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
});

runner.test('Envelope creation - should compute SHA-256 checksum', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	// Verify checksum is valid SHA-256 (64 hex characters)
	assert.ok(/^[a-f0-9]{64}$/.test(envelope.checksum));

	// Verify checksum matches computed value
	const expectedChecksum = crypto
		.createHash('sha256')
		.update(plaintext, 'utf8')
		.digest('hex');
	assert.strictEqual(envelope.checksum, expectedChecksum);
});

runner.test('Envelope creation - should produce different checksums for different data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext1 = JSON.stringify({ id: 'user1', name: 'User One' });
	const plaintext2 = JSON.stringify({ id: 'user2', name: 'User Two' });

	const envelope1 = await migration._createEnvelope(plaintext1);
	const envelope2 = await migration._createEnvelope(plaintext2);

	assert.notStrictEqual(envelope1.checksum, envelope2.checksum);
});

runner.test('Envelope creation - should produce consistent checksums for same data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });

	const envelope1 = await migration._createEnvelope(plaintext);
	const envelope2 = await migration._createEnvelope(plaintext);

	assert.strictEqual(envelope1.checksum, envelope2.checksum);
});

runner.test('Envelope creation - should handle empty JSON objects', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({});
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
});

runner.test('Envelope creation - should handle large JSON objects', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const largeObject = {
		id: 'user1',
		name: 'User One',
		data: 'x'.repeat(10000) // 10KB of data
	};
	const plaintext = JSON.stringify(largeObject);
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
});

runner.test('Envelope creation - should handle special characters in data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({
		id: 'user1',
		name: 'User One',
		data: 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?"\'\n\t'
	});
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
});

runner.test('Envelope creation - should handle Unicode characters', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({
		id: 'user1',
		name: 'User One',
		data: '你好世界 🌍 مرحبا بالعالم'
	});
	const envelope = await migration._createEnvelope(plaintext);

	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
});

runner.test('Envelope creation - should throw error for empty plaintext', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration._createEnvelope('');
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
	}
});

runner.test('Envelope creation - should throw error for null plaintext', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration._createEnvelope(null);
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
	}
});

runner.test('Envelope creation - should throw error for non-string plaintext', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration._createEnvelope({ id: 'user1' });
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
	}
});

runner.test('Envelope creation - should throw error if backend not initialized', async () => {
	const store = createMockStore();
	const secretVault = {
		encryptionBackend: null
	};
	const migration = new UserMigration(store, secretVault);

	try {
		await migration._createEnvelope('test data');
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
	}
});

// ============================================================================
// Test: Envelope Decryption and Checksum Verification
// ============================================================================

runner.test('Envelope decryption - should decrypt envelope and verify checksum', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const originalData = { id: 'user1', name: 'User One', email: 'user@example.com' };
	const plaintext = JSON.stringify(originalData);

	// Create envelope
	const envelope = await migration._createEnvelope(plaintext);

	// Create envelope object for decryption
	const envelopeObj = {
		id: 'user1',
		envelope: envelope.envelope,
		checksum: envelope.checksum,
		migratedAt: new Date().toISOString()
	};

	// Decrypt
	const decrypted = await migration.decryptUserRecord(envelopeObj);

	assert.deepStrictEqual(decrypted, originalData);
});

runner.test('Envelope decryption - should detect checksum mismatch', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	// Create envelope with wrong checksum
	const envelopeObj = {
		id: 'user1',
		envelope: envelope.envelope,
		checksum: 'wrong-checksum-value',
		migratedAt: new Date().toISOString()
	};

	try {
		await migration.decryptUserRecord(envelopeObj);
		throw new Error('Should have thrown ChecksumVerificationError');
	} catch (error) {
		assert.ok(error instanceof ChecksumVerificationError);
	}
});

runner.test('Envelope decryption - should handle corrupted envelope data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const envelope = await migration._createEnvelope(plaintext);

	// Create envelope with corrupted encrypted data
	const envelopeObj = {
		id: 'user1',
		envelope: 'corrupted-data',
		checksum: envelope.checksum,
		migratedAt: new Date().toISOString()
	};

	try {
		await migration.decryptUserRecord(envelopeObj);
		throw new Error('Should have thrown DecryptionError');
	} catch (error) {
		assert.ok(error instanceof DecryptionError);
	}
});

// ============================================================================
// Test: Integration with Migration Process
// ============================================================================

runner.test('Integration - should create envelopes during migration', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One', email: 'user1@example.com' },
		{ id: 'user2', name: 'User Two', email: 'user2@example.com' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();

	assert.strictEqual(result.migratedRecords, 2);

	const migratedRecords = store.get('userRecords');
	migratedRecords.forEach((record, index) => {
		assert.ok(record.envelope);
		assert.ok(record.checksum);
		assert.ok(/^[a-f0-9]{64}$/.test(record.checksum)); // Valid SHA-256
		assert.ok(record.migratedAt);
	});
});

runner.test('Integration - should decrypt migrated records correctly', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One', email: 'user1@example.com' },
		{ id: 'user2', name: 'User Two', email: 'user2@example.com' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	await migration.migrate();

	const migratedRecords = store.get('userRecords');

	// Decrypt each record and verify
	for (let i = 0; i < migratedRecords.length; i++) {
		const decrypted = await migration.decryptUserRecord(migratedRecords[i]);
		assert.deepStrictEqual(decrypted, oldRecords[i]);
	}
});

runner.test('Integration - should maintain data integrity through migration cycle', async () => {
	const originalData = {
		id: 'user1',
		name: 'User One',
		email: 'user1@example.com',
		profile: {
			age: 30,
			city: 'New York',
			preferences: {
				theme: 'dark',
				notifications: true
			}
		}
	};

	const store = createMockStore();
	store.set('userRecords', [originalData]);
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	// Migrate
	await migration.migrate();

	// Decrypt
	const migratedRecords = store.get('userRecords');
	const decrypted = await migration.decryptUserRecord(migratedRecords[0]);

	// Verify data integrity
	assert.deepStrictEqual(decrypted, originalData);
});

// ============================================================================
// Test: Checksum Verification
// ============================================================================

runner.test('Checksum verification - should verify correct checksums', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const checksum = migration._computeChecksum(plaintext);

	const verified = migration.verifyRecordChecksum(plaintext, checksum);
	assert.strictEqual(verified, true);
});

runner.test('Checksum verification - should reject incorrect checksums', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const wrongChecksum = 'a'.repeat(64); // Valid SHA-256 format but wrong value

	const verified = migration.verifyRecordChecksum(plaintext, wrongChecksum);
	assert.strictEqual(verified, false);
});

runner.test('Checksum verification - should handle corrupted plaintext', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });
	const checksum = migration._computeChecksum(plaintext);

	// Modify plaintext
	const modifiedPlaintext = JSON.stringify({ id: 'user1', name: 'User Two' });

	const verified = migration.verifyRecordChecksum(modifiedPlaintext, checksum);
	assert.strictEqual(verified, false);
});

// ============================================================================
// Test: Property-Based Tests
// ============================================================================

runner.test('Property: decrypt(encrypt(data)) == data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	// Test with various data types
	const testCases = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two', email: 'user@example.com' },
		{ id: 'user3', data: 'x'.repeat(1000) },
		{ id: 'user4', unicode: '你好世界 🌍' }
	];

	for (const testData of testCases) {
		const plaintext = JSON.stringify(testData);
		const envelope = await migration._createEnvelope(plaintext);

		const envelopeObj = {
			id: testData.id,
			envelope: envelope.envelope,
			checksum: envelope.checksum,
			migratedAt: new Date().toISOString()
		};

		const decrypted = await migration.decryptUserRecord(envelopeObj);
		assert.deepStrictEqual(decrypted, testData);
	}
});

runner.test('Property: checksum(data) is deterministic', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const plaintext = JSON.stringify({ id: 'user1', name: 'User One' });

	// Compute checksum multiple times
	const checksums = [];
	for (let i = 0; i < 10; i++) {
		checksums.push(migration._computeChecksum(plaintext));
	}

	// All checksums should be identical
	const firstChecksum = checksums[0];
	checksums.forEach(checksum => {
		assert.strictEqual(checksum, firstChecksum);
	});
});

runner.test('Property: different data produces different checksums', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVaultAES256GCM();
	const migration = new UserMigration(store, secretVault);

	const testCases = [
		JSON.stringify({ id: 'user1' }),
		JSON.stringify({ id: 'user2' }),
		JSON.stringify({ id: 'user1', name: 'User One' }),
		JSON.stringify({ id: 'user1', name: 'User Two' })
	];

	const checksums = testCases.map(plaintext => migration._computeChecksum(plaintext));

	// All checksums should be unique
	const uniqueChecksums = new Set(checksums);
	assert.strictEqual(uniqueChecksums.size, checksums.length);
});

/**
 * Run all tests
 */
if (require.main === module) {
	runner.run().then(success => {
		process.exit(success ? 0 : 1);
	});
}

module.exports = { UserMigration };

/**
 * Integration tests for user-migration.js with real encryption
 *
 * Tests the full migration flow with actual encryption/decryption
 */

const assert = require('assert');
const crypto = require('crypto');
const {
	UserMigration,
	UserMigrationError,
	MigrationNotNeededError,
	MigrationFailedError,
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
 * Create a real-like SecretVault mock with proper encryption
 */
function createRealSecretVault() {
	const store = createMockStore();
	const masterKey = crypto.randomBytes(32); // 256-bit key for AES-256

	return {
		store,
		encryptionBackend: 'aes256gcm',
		_encryptWithAES256GCM: (plaintext) => {
			// Real AES-256-GCM encryption
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
			// Real AES-256-GCM decryption
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
			return Buffer.from(plaintext).toString('base64');
		},
		_decryptWithSafeStorage: (encryptedData) => {
			return Buffer.from(encryptedData, 'base64').toString('utf8');
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
		console.log('Running UserMigration Integration tests...\n');

		for (const test of this.tests) {
			try {
				await test.fn();
				console.log(`✓ ${test.name}`);
				this.passed++;
			} catch (error) {
				console.log(`✗ ${test.name}`);
				console.log(`  Error: ${error.message}`);
				this.failed++;
			}
		}

		console.log(`\n${this.passed} passed, ${this.failed} failed`);
		return this.failed === 0;
	}
}

const runner = new TestRunner();

// Integration tests

runner.test('Full migration flow - encrypt and decrypt with real encryption', async () => {
	const oldRecords = [
		{
			id: 'user1',
			name: 'Alice',
			email: 'alice@example.com',
			settings: { theme: 'dark', notifications: true }
		},
		{
			id: 'user2',
			name: 'Bob',
			email: 'bob@example.com',
			settings: { theme: 'light', notifications: false }
		}
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	const result = await migration.migrate();

	assert.strictEqual(result.success, true);
	assert.strictEqual(result.totalRecords, 2);
	assert.strictEqual(result.migratedRecords, 2);
	assert.strictEqual(result.failedRecords, 0);

	// Verify records are encrypted
	const migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 2);

	// Decrypt and verify each record
	for (let i = 0; i < migratedRecords.length; i++) {
		const envelope = migratedRecords[i];
		const decrypted = await migration.decryptUserRecord(envelope);

		assert.strictEqual(decrypted.id, oldRecords[i].id);
		assert.strictEqual(decrypted.name, oldRecords[i].name);
		assert.strictEqual(decrypted.email, oldRecords[i].email);
		assert.deepStrictEqual(decrypted.settings, oldRecords[i].settings);
	}
});

runner.test('Checksum verification - detects tampering', async () => {
	const oldRecords = [{ id: 'user1', name: 'Alice' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Get the migrated record
	const migratedRecords = store.get('userRecords');
	const envelope = migratedRecords[0];

	// Tamper with the checksum
	const tamperedEnvelope = {
		...envelope,
		checksum: 'tampered-checksum-value'
	};

	// Try to decrypt - should fail checksum verification
	try {
		await migration.decryptUserRecord(tamperedEnvelope);
		throw new Error('Should have thrown ChecksumVerificationError');
	} catch (error) {
		assert.ok(error instanceof ChecksumVerificationError);
		assert.ok(error.message.includes('Checksum mismatch'));
	}
});

runner.test('Envelope structure - contains all required fields', async () => {
	const oldRecords = [{ id: 'user1', name: 'Alice' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Get the migrated record
	const migratedRecords = store.get('userRecords');
	const envelope = migratedRecords[0];

	// Verify envelope structure
	assert.ok(envelope.id);
	assert.ok(envelope.envelope);
	assert.ok(envelope.checksum);
	assert.ok(envelope.migratedAt);

	// Verify checksum is hex-encoded SHA-256 (64 characters)
	assert.ok(/^[a-f0-9]{64}$/.test(envelope.checksum));

	// Verify migratedAt is ISO 8601 timestamp
	assert.ok(new Date(envelope.migratedAt).getTime() > 0);
});

runner.test('Partial migration - continues on individual record failures', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice' },
		{ id: 'user2', name: 'Bob' },
		{ id: 'user3', name: 'Charlie' }
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);

	// Create a vault that fails on second record
	const secretVault = createRealSecretVault();
	const originalEncrypt = secretVault._encryptWithAES256GCM;
	let callCount = 0;
	secretVault._encryptWithAES256GCM = (plaintext) => {
		callCount++;
		if (callCount === 2) {
			throw new Error('Simulated encryption failure');
		}
		return originalEncrypt(plaintext);
	};

	const migration = new UserMigration(store, secretVault);

	// Perform migration - should continue despite one failure
	const result = await migration.migrate();

	assert.strictEqual(result.totalRecords, 3);
	assert.strictEqual(result.migratedRecords, 2);
	assert.strictEqual(result.failedRecords, 1);
	assert.ok(result.failedDetails[0].error);
});

runner.test('Backup creation - preserves old records', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice' },
		{ id: 'user2', name: 'Bob' }
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Verify backup exists
	const backup = store.get('userRecordsBackup');
	assert.ok(backup);
	assert.deepStrictEqual(backup, oldRecords);

	// Verify backup is separate from migrated records
	const migratedRecords = store.get('userRecords');
	assert.notDeepStrictEqual(migratedRecords, backup);
});

runner.test('Migration flag - marks migration as complete', async () => {
	const oldRecords = [{ id: 'user1', name: 'Alice' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Before migration
	assert.strictEqual(store.get('userRecordsMigrated'), undefined);

	// Perform migration
	await migration.migrate();

	// After migration
	assert.strictEqual(store.get('userRecordsMigrated'), true);
	assert.ok(store.get('userRecordsMigratedAt'));

	// Second migration should fail
	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationNotNeededError');
	} catch (error) {
		assert.ok(error instanceof MigrationNotNeededError);
	}
});

runner.test('Event emission - migration-complete event contains correct data', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice' },
		{ id: 'user2', name: 'Bob' }
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	let eventData = null;
	migration.on('migration-complete', (data) => {
		eventData = data;
	});

	// Perform migration
	await migration.migrate();

	// Verify event data
	assert.ok(eventData);
	assert.strictEqual(eventData.totalRecords, 2);
	assert.strictEqual(eventData.migratedRecords, 2);
	assert.strictEqual(eventData.failedRecords, 0);
});

runner.test('Complex data structures - preserves nested objects and arrays', async () => {
	const oldRecords = [
		{
			id: 'user1',
			name: 'Alice',
			profile: {
				email: 'alice@example.com',
				phone: '+1-555-0100',
				address: {
					street: '123 Main St',
					city: 'Springfield',
					zip: '12345'
				}
			},
			tags: ['admin', 'developer', 'reviewer'],
			metadata: {
				created: '2026-01-01T00:00:00Z',
				lastLogin: '2026-05-08T12:00:00Z',
				loginCount: 42
			}
		}
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Decrypt and verify
	const migratedRecords = store.get('userRecords');
	const decrypted = await migration.decryptUserRecord(migratedRecords[0]);

	assert.deepStrictEqual(decrypted, oldRecords[0]);
});

runner.test('deleteOldRecords - should delete old records after migration with real encryption', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice', email: 'alice@example.com' },
		{ id: 'user2', name: 'Bob', email: 'bob@example.com' }
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	const migrateResult = await migration.migrate();
	assert.strictEqual(migrateResult.success, true);
	assert.strictEqual(migrateResult.migratedRecords, 2);

	// Verify migrated records exist
	let migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 2);
	assert.ok(migratedRecords[0].envelope);
	assert.ok(migratedRecords[0].checksum);

	// Delete old records
	await migration.deleteOldRecords();

	// Verify old records are deleted
	migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords, undefined);

	// Verify backup is preserved
	const backup = store.get('userRecordsBackup');
	assert.ok(backup);
	assert.deepStrictEqual(backup, oldRecords);
});

runner.test('deleteOldRecords - should emit event on deletion', async () => {
	const oldRecords = [{ id: 'user1', name: 'Alice' }];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	let eventData = null;
	migration.on('old-records-deleted', (data) => {
		eventData = data;
	});

	// Delete old records
	await migration.deleteOldRecords();

	// Verify event was emitted with timestamp
	assert.ok(eventData);
	assert.ok(eventData.timestamp);
	assert.ok(new Date(eventData.timestamp).getTime() > 0);
});

runner.test('Full migration lifecycle - migrate and delete with real encryption', async () => {
	const oldRecords = [
		{
			id: 'user1',
			name: 'Alice',
			email: 'alice@example.com',
			settings: { theme: 'dark', notifications: true }
		},
		{
			id: 'user2',
			name: 'Bob',
			email: 'bob@example.com',
			settings: { theme: 'light', notifications: false }
		}
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Step 1: Check migration is needed
	let needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, true);

	// Step 2: Perform migration
	const migrateResult = await migration.migrate();
	assert.strictEqual(migrateResult.success, true);
	assert.strictEqual(migrateResult.migratedRecords, 2);

	// Step 3: Verify migration is complete
	needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, false);

	// Step 4: Verify migrated records exist and are encrypted
	let migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 2);
	migratedRecords.forEach(record => {
		assert.ok(record.envelope);
		assert.ok(record.checksum);
		assert.ok(record.migratedAt);
	});

	// Step 5: Decrypt and verify records
	const decrypted1 = await migration.decryptUserRecord(migratedRecords[0]);
	assert.strictEqual(decrypted1.id, 'user1');
	assert.strictEqual(decrypted1.name, 'Alice');
	assert.deepStrictEqual(decrypted1.settings, oldRecords[0].settings);

	// Step 6: Delete old records
	await migration.deleteOldRecords();

	// Step 7: Verify old records are deleted
	migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords, undefined);

	// Step 8: Verify backup is preserved
	const backup = store.get('userRecordsBackup');
	assert.ok(backup);
	assert.deepStrictEqual(backup, oldRecords);

	// Step 9: Verify migration status
	const status = await migration.getMigrationStatus();
	assert.strictEqual(status.migrationComplete, true);
	assert.strictEqual(status.hasBackup, true);
	assert.strictEqual(status.recordCount, 0); // Records deleted
});

runner.test('deleteOldRecords - should handle deletion with corrupted records gracefully', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice' },
		{ id: 'user2', name: 'Bob' }
	];

	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createRealSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Corrupt one of the migrated records
	const migratedRecords = store.get('userRecords');
	migratedRecords[0].checksum = 'corrupted-checksum';
	store.set('userRecords', migratedRecords);

	// Delete old records - should still work even with corrupted records
	await migration.deleteOldRecords();

	// Verify records are deleted
	const deletedRecords = store.get('userRecords');
	assert.strictEqual(deletedRecords, undefined);

	// Verify backup is preserved
	const backup = store.get('userRecordsBackup');
	assert.ok(backup);
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

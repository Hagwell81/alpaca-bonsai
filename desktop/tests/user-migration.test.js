/* eslint-env node */
/**
 * Tests for user-migration.js
 *
 * Run with: node desktop/tests/user-migration.test.js
 */

const assert = require('assert');
const {
	UserMigration,
	UserMigrationError,
	MigrationNotNeededError,
	MigrationFailedError,
	ChecksumVerificationError,
	DecryptionError,
	EncryptionError,
	StorageError,
	CrossMachineDetectionError,
	EnvelopeValidationError
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
 * Mock SecretVault
 */
function createMockSecretVault() {
	const store = createMockStore();
	const encryptedData = {};

	return {
		store,
		encryptionBackend: 'aes256gcm',
		setSecret: async (key, value) => {
			// Simulate encryption by storing with metadata
			encryptedData[key] = {
				plaintext: value,
				encrypted: Buffer.from(value).toString('base64'),
				iv: 'mock-iv',
				authTag: 'mock-auth-tag'
			};
			store.set(key, encryptedData[key]);
		},
		getSecret: async (key) => {
			const data = encryptedData[key];
			if (!data) {
				throw new Error(`Secret not found: ${key}`);
			}
			return data.plaintext;
		},
		deleteSecret: async (key) => {
			delete encryptedData[key];
			store.delete(key);
		},
		_encryptWithAES256GCM: (plaintext) => {
			// Mock AES-256-GCM encryption - return JSON with iv, ciphertext, authTag
			return JSON.stringify({
				iv: Buffer.from('mock-iv-16-bytes').toString('base64'),
				ciphertext: Buffer.from(plaintext).toString('hex'),
				authTag: Buffer.from('mock-auth-tag-16').toString('base64')
			});
		},
		_decryptWithAES256GCM: (encryptedData) => {
			// Mock AES-256-GCM decryption
			try {
				const encrypted = JSON.parse(encryptedData);
				return Buffer.from(encrypted.ciphertext, 'hex').toString('utf8');
			} catch (error) {
				throw new Error(`Failed to decrypt: ${error.message}`);
			}
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
		console.log('Running UserMigration tests...\n');

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

// Test: Constructor
runner.test('Constructor - should create instance with required parameters', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	assert.ok(migration);
	assert.strictEqual(migration.userRecordsKey, 'userRecords');
	assert.strictEqual(migration.migratedFlagKey, 'userRecordsMigrated');
});

runner.test('Constructor - should throw error if store is missing', () => {
	const secretVault = createMockSecretVault();
	assert.throws(() => {
		new UserMigration(null, secretVault);
	}, UserMigrationError);
});

runner.test('Constructor - should throw error if secretVault is missing', () => {
	const store = createMockStore();
	assert.throws(() => {
		new UserMigration(store, null);
	}, UserMigrationError);
});

runner.test('Constructor - should accept custom options', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const customMigration = new UserMigration(store, secretVault, {
		userRecordsKey: 'customRecords',
		migratedFlagKey: 'customMigrated'
	});
	assert.strictEqual(customMigration.userRecordsKey, 'customRecords');
	assert.strictEqual(customMigration.migratedFlagKey, 'customMigrated');
});

// Test: isMigrationNeeded
runner.test('isMigrationNeeded - should return false when no records exist', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	const needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, false);
});

runner.test('isMigrationNeeded - should return false when migration already completed', async () => {
	const store = createMockStore();
	store.set('userRecordsMigrated', true);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	const needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, false);
});

runner.test('isMigrationNeeded - should return true when old unencrypted records exist', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	const needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, true);
});

runner.test('isMigrationNeeded - should return false when records are already migrated', async () => {
	const migratedRecords = [
		{
			id: 'user1',
			envelope: 'encrypted-data',
			checksum: 'abc123',
			migratedAt: '2026-05-08T12:00:00Z'
		}
	];
	const store = createMockStore();
	store.set('userRecords', migratedRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	const needed = await migration.isMigrationNeeded();
	assert.strictEqual(needed, false);
});

// Test: migrate
runner.test('migrate - should throw error when no migration needed', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);
	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationNotNeededError');
	} catch (error) {
		assert.ok(error instanceof MigrationNotNeededError);
	}
});

runner.test('migrate - should migrate single user record', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One', email: 'user1@example.com' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();

	assert.strictEqual(result.success, true);
	assert.strictEqual(result.totalRecords, 1);
	assert.strictEqual(result.migratedRecords, 1);
	assert.strictEqual(result.failedRecords, 0);

	// Verify migration flag is set
	assert.strictEqual(store.get('userRecordsMigrated'), true);
	assert.ok(store.get('userRecordsMigratedAt'));

	// Verify records are now encrypted
	const migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 1);
	assert.ok(migratedRecords[0].envelope);
	assert.ok(migratedRecords[0].checksum);
	assert.ok(migratedRecords[0].migratedAt);
});

runner.test('migrate - should migrate multiple user records', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' },
		{ id: 'user3', name: 'User Three' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();

	assert.strictEqual(result.totalRecords, 3);
	assert.strictEqual(result.migratedRecords, 3);
	assert.strictEqual(result.failedRecords, 0);

	const migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 3);
	migratedRecords.forEach(record => {
		assert.ok(record.envelope);
		assert.ok(record.checksum);
	});
});

runner.test('migrate - should create backup before migration', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	await migration.migrate();

	const backup = store.get('userRecordsBackup');
	assert.ok(backup);
	assert.deepStrictEqual(backup, oldRecords);
});

runner.test('migrate - should emit migration-complete event', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	let eventData = null;
	migration.on('migration-complete', (data) => {
		eventData = data;
	});

	await migration.migrate();

	assert.ok(eventData);
	assert.strictEqual(eventData.totalRecords, 1);
	assert.strictEqual(eventData.migratedRecords, 1);
});

// Test: decryptUserRecord
runner.test('decryptUserRecord - should decrypt and return user record', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One', email: 'user1@example.com' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// First migrate a record
	await migration.migrate();

	// Get the migrated record
	const migratedRecords = store.get('userRecords');
	const envelope = migratedRecords[0];

	// Decrypt it
	const decrypted = await migration.decryptUserRecord(envelope);

	assert.strictEqual(decrypted.id, 'user1');
	assert.strictEqual(decrypted.name, 'User One');
	assert.strictEqual(decrypted.email, 'user1@example.com');
});

runner.test('decryptUserRecord - should throw error for invalid envelope', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.decryptUserRecord({ id: 'user1' });
		throw new Error('Should have thrown EnvelopeValidationError');
	} catch (error) {
		assert.ok(error instanceof EnvelopeValidationError);
	}
});

// Test: verifyRecordChecksum
runner.test('verifyRecordChecksum - should verify correct checksum', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const plaintext = 'test data';
	const checksum = migration._computeChecksum(plaintext);
	const verified = migration.verifyRecordChecksum(plaintext, checksum);
	assert.strictEqual(verified, true);
});

runner.test('verifyRecordChecksum - should reject incorrect checksum', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const plaintext = 'test data';
	const wrongChecksum = 'wrong-checksum';
	const verified = migration.verifyRecordChecksum(plaintext, wrongChecksum);
	assert.strictEqual(verified, false);
});

// Test: getMigrationStatus
runner.test('getMigrationStatus - should return status when no migration needed', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const status = await migration.getMigrationStatus();

	assert.strictEqual(status.migrationNeeded, false);
	assert.strictEqual(status.migrationComplete, false);
	assert.strictEqual(status.recordCount, 0);
	assert.strictEqual(status.hasBackup, false);
});

runner.test('getMigrationStatus - should return status after migration', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	await migration.migrate();

	const status = await migration.getMigrationStatus();

	assert.strictEqual(status.migrationNeeded, false);
	assert.strictEqual(status.migrationComplete, true);
	assert.ok(status.migratedAt);
	assert.strictEqual(status.recordCount, 1);
	assert.strictEqual(status.hasBackup, true);
});

// Test: restoreFromBackup
runner.test('restoreFromBackup - should restore records from backup', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	await migration.migrate();

	// Verify migration is complete
	assert.strictEqual(store.get('userRecordsMigrated'), true);

	// Restore from backup
	await migration.restoreFromBackup();

	// Verify migration flag is reset
	assert.strictEqual(store.get('userRecordsMigrated'), false);

	// Verify records are restored
	const restored = store.get('userRecords');
	assert.deepStrictEqual(restored, oldRecords);
});

runner.test('restoreFromBackup - should throw error if no backup available', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.restoreFromBackup();
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
	}
});

// Test: Event listeners
runner.test('Event listeners - should register and trigger event listeners', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	let called = false;
	migration.on('test-event', (data) => {
		called = true;
		assert.strictEqual(data.value, 42);
	});

	migration._emit('test-event', { value: 42 });
	assert.ok(called);
});

runner.test('Event listeners - should unregister event listeners', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	let callCount = 0;
	const callback = () => {
		callCount++;
	};

	migration.on('test-event', callback);
	migration._emit('test-event', {});
	assert.strictEqual(callCount, 1);

	migration.off('test-event', callback);
	migration._emit('test-event', {});
	assert.strictEqual(callCount, 1); // Should not increment
});

// Test: Edge cases
runner.test('Edge cases - should handle records with special characters', async () => {
	const oldRecords = [
		{
			id: 'user1',
			name: 'User One',
			data: 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?'
		}
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();
	assert.strictEqual(result.migratedRecords, 1);

	const migratedRecords = store.get('userRecords');
	const decrypted = await migration.decryptUserRecord(migratedRecords[0]);
	assert.strictEqual(decrypted.data, oldRecords[0].data);
});

runner.test('Edge cases - should handle records with nested objects', async () => {
	const oldRecords = [
		{
			id: 'user1',
			name: 'User One',
			profile: {
				email: 'user@example.com',
				settings: {
					theme: 'dark',
					notifications: true
				}
			}
		}
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();
	assert.strictEqual(result.migratedRecords, 1);

	const migratedRecords = store.get('userRecords');
	const decrypted = await migration.decryptUserRecord(migratedRecords[0]);
	assert.deepStrictEqual(decrypted.profile, oldRecords[0].profile);
});

runner.test('Edge cases - should generate unique IDs for records without ID', async () => {
	const oldRecords = [
		{ name: 'User One' },
		{ name: 'User Two' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const result = await migration.migrate();
	assert.strictEqual(result.migratedRecords, 2);

	const migratedRecords = store.get('userRecords');
	assert.ok(migratedRecords[0].id);
	assert.ok(migratedRecords[1].id);
	assert.notStrictEqual(migratedRecords[0].id, migratedRecords[1].id);
});

// Test: Checksum computation
runner.test('Checksum computation - should compute consistent checksums', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const data = 'test data';
	const checksum1 = migration._computeChecksum(data);
	const checksum2 = migration._computeChecksum(data);
	assert.strictEqual(checksum1, checksum2);
});

runner.test('Checksum computation - should produce different checksums for different data', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const checksum1 = migration._computeChecksum('data1');
	const checksum2 = migration._computeChecksum('data2');
	assert.notStrictEqual(checksum1, checksum2);
});

runner.test('Checksum computation - should produce hex-encoded checksums', () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	const checksum = migration._computeChecksum('test');
	assert.ok(/^[a-f0-9]{64}$/.test(checksum)); // SHA-256 is 64 hex chars
});

// Test: deleteOldRecords
runner.test('deleteOldRecords - should delete old records after migration', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration first
	await migration.migrate();

	// Verify migration is complete
	assert.strictEqual(store.get('userRecordsMigrated'), true);

	// Verify old records are still in store (before deletion)
	const migratedRecords = store.get('userRecords');
	assert.ok(migratedRecords);
	assert.strictEqual(migratedRecords.length, 1);

	// Delete old records
	await migration.deleteOldRecords();

	// Verify old records are deleted
	const deletedRecords = store.get('userRecords');
	assert.strictEqual(deletedRecords, undefined);
});

runner.test('deleteOldRecords - should throw error if migration not complete', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.deleteOldRecords();
		throw new Error('Should have thrown UserMigrationError');
	} catch (error) {
		assert.ok(error instanceof UserMigrationError);
		assert.ok(error.message.includes('migration not complete'));
	}
});

runner.test('deleteOldRecords - should preserve backup after deletion', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Verify backup exists
	const backupBefore = store.get('userRecordsBackup');
	assert.ok(backupBefore);

	// Delete old records
	await migration.deleteOldRecords();

	// Verify backup is still preserved
	const backupAfter = store.get('userRecordsBackup');
	assert.ok(backupAfter);
	assert.deepStrictEqual(backupAfter, backupBefore);
});

runner.test('deleteOldRecords - should emit old-records-deleted event', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	let eventData = null;
	migration.on('old-records-deleted', (data) => {
		eventData = data;
	});

	// Delete old records
	await migration.deleteOldRecords();

	// Verify event was emitted
	assert.ok(eventData);
	assert.ok(eventData.timestamp);
});

runner.test('deleteOldRecords - should handle multiple deletions gracefully', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Delete old records first time
	await migration.deleteOldRecords();

	// Verify records are deleted
	assert.strictEqual(store.get('userRecords'), undefined);

	// Delete again - should not throw error
	await migration.deleteOldRecords();

	// Verify records are still deleted
	assert.strictEqual(store.get('userRecords'), undefined);
});

runner.test('deleteOldRecords - should only delete userRecords key, not other data', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	store.set('otherData', { important: 'value' });
	store.set('userRecordsMigrated', true);
	store.set('userRecordsMigratedAt', '2026-05-08T12:00:00Z');
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Delete old records
	await migration.deleteOldRecords();

	// Verify only userRecords is deleted
	assert.strictEqual(store.get('userRecords'), undefined);
	assert.deepStrictEqual(store.get('otherData'), { important: 'value' });
	assert.strictEqual(store.get('userRecordsMigrated'), true);
	assert.strictEqual(store.get('userRecordsMigratedAt'), '2026-05-08T12:00:00Z');
});

runner.test('deleteOldRecords - should work with multiple migrated records', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' },
		{ id: 'user3', name: 'User Three' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	const result = await migration.migrate();
	assert.strictEqual(result.migratedRecords, 3);

	// Verify migrated records exist
	const migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 3);

	// Delete old records
	await migration.deleteOldRecords();

	// Verify all records are deleted
	assert.strictEqual(store.get('userRecords'), undefined);
});

runner.test('deleteOldRecords - should handle custom userRecordsKey option', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('customRecordsKey', oldRecords);
	store.set('customMigratedFlag', true);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault, {
		userRecordsKey: 'customRecordsKey',
		migratedFlagKey: 'customMigratedFlag'
	});

	// Delete old records
	await migration.deleteOldRecords();

	// Verify custom key is deleted
	assert.strictEqual(store.get('customRecordsKey'), undefined);
	assert.strictEqual(store.get('customMigratedFlag'), true);
});

runner.test('deleteOldRecords - should handle store errors gracefully', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	store.set('userRecordsMigrated', true);

	// Create a vault that throws on delete
	const secretVault = createMockSecretVault();

	const migration = new UserMigration(store, secretVault);

	// Mock store.delete to throw error
	const originalDelete = store.delete;
	store.delete = () => {
		throw new Error('Store delete failed');
	};

	try {
		await migration.deleteOldRecords();
		throw new Error('Should have thrown StorageError');
	} catch (error) {
		assert.ok(error instanceof StorageError);
		assert.ok(error.message.includes('Failed to delete old records'));
	}

	// Restore original delete
	store.delete = originalDelete;
});

runner.test('deleteOldRecords - integration with full migration flow', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'Alice', email: 'alice@example.com' },
		{ id: 'user2', name: 'Bob', email: 'bob@example.com' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
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

	// Step 4: Verify migrated records exist
	let migratedRecords = store.get('userRecords');
	assert.strictEqual(migratedRecords.length, 2);
	assert.ok(migratedRecords[0].envelope);
	assert.ok(migratedRecords[0].checksum);

	// Step 5: Decrypt and verify records
	const decrypted1 = await migration.decryptUserRecord(migratedRecords[0]);
	assert.strictEqual(decrypted1.id, 'user1');
	assert.strictEqual(decrypted1.name, 'Alice');

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
});

// ============================================================================
// NEW ERROR HANDLING TESTS
// ============================================================================

// Test: Encryption Failures
runner.test('Error handling - should handle encryption backend not initialized', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	secretVault.encryptionBackend = null; // Simulate uninitialized backend
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationFailedError');
	} catch (error) {
		assert.ok(error instanceof MigrationFailedError);
		assert.ok(error.failedRecords.length > 0);
	}
});

runner.test('Error handling - should handle encryption method not available', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	secretVault._encryptWithAES256GCM = null; // Simulate missing method
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationFailedError');
	} catch (error) {
		assert.ok(error instanceof MigrationFailedError);
	}
});

runner.test('Error handling - should handle plaintext size limit', async () => {
	const largeData = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
	const oldRecords = [{ id: 'user1', data: largeData }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationFailedError');
	} catch (error) {
		assert.ok(error instanceof MigrationFailedError);
		assert.ok(error.failedRecords.length > 0);
	}
});

runner.test('Error handling - should handle invalid record serialization', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Create a circular reference that can't be serialized
	oldRecords[0].circular = oldRecords[0];

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationFailedError');
	} catch (error) {
		assert.ok(error instanceof MigrationFailedError);
	}
});

// Test: Storage Errors
runner.test('Error handling - should handle backup storage failure', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock store.set to throw error on backup
	const originalSet = store.set;
	let callCount = 0;
	store.set = (key, value) => {
		callCount++;
		if (callCount === 1 && key === 'userRecordsBackup') {
			throw new Error('Backup storage failed');
		}
		originalSet(key, value);
	};

	try {
		await migration.migrate();
		throw new Error('Should have thrown StorageError');
	} catch (error) {
		assert.ok(error instanceof StorageError);
		assert.strictEqual(error.operation, 'backup');
	}

	// Restore original set
	store.set = originalSet;
});

runner.test('Error handling - should handle migrated records storage failure', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock store.set to throw error on storing migrated records
	const originalSet = store.set;
	let callCount = 0;
	store.set = (key, value) => {
		callCount++;
		// Allow backup, but fail on storing migrated records
		if (callCount === 2 && key === 'userRecords') {
			throw new Error('Failed to store migrated records');
		}
		originalSet(key, value);
	};

	try {
		await migration.migrate();
		throw new Error('Should have thrown StorageError');
	} catch (error) {
		assert.ok(error instanceof StorageError);
		assert.strictEqual(error.operation, 'set');
	}

	// Restore original set
	store.set = originalSet;
});

runner.test('Error handling - should handle migration flag storage failure', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock store.set to throw error on setting migration flag
	const originalSet = store.set;
	let callCount = 0;
	store.set = (key, value) => {
		callCount++;
		// Allow backup and migrated records, but fail on migration flag
		if (callCount === 3 && key === 'userRecordsMigrated') {
			throw new Error('Failed to set migration flag');
		}
		originalSet(key, value);
	};

	try {
		await migration.migrate();
		throw new Error('Should have thrown StorageError');
	} catch (error) {
		assert.ok(error instanceof StorageError);
		assert.strictEqual(error.operation, 'set');
	}

	// Restore original set
	store.set = originalSet;
});

runner.test('Error handling - should handle delete old records storage failure', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration first
	await migration.migrate();

	// Mock store.delete to throw error
	const originalDelete = store.delete;
	store.delete = () => {
		throw new Error('Delete operation failed');
	};

	try {
		await migration.deleteOldRecords();
		throw new Error('Should have thrown StorageError');
	} catch (error) {
		assert.ok(error instanceof StorageError);
		assert.strictEqual(error.operation, 'delete');
	}

	// Restore original delete
	store.delete = originalDelete;
});

// Test: Checksum Verification Errors
runner.test('Error handling - should detect checksum mismatch on decryption', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Get migrated record and tamper with checksum
	const migratedRecords = store.get('userRecords');
	const envelope = migratedRecords[0];
	envelope.checksum = 'tampered-checksum';

	try {
		await migration.decryptUserRecord(envelope);
		throw new Error('Should have thrown ChecksumVerificationError');
	} catch (error) {
		assert.ok(error instanceof ChecksumVerificationError);
		assert.strictEqual(error.recordId, 'user1');
	}
});

runner.test('Error handling - should handle invalid envelope structure', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.decryptUserRecord({ id: 'user1' });
		throw new Error('Should have thrown EnvelopeValidationError');
	} catch (error) {
		assert.ok(error instanceof EnvelopeValidationError);
	}
});

runner.test('Error handling - should handle null envelope', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.decryptUserRecord(null);
		throw new Error('Should have thrown EnvelopeValidationError');
	} catch (error) {
		assert.ok(error instanceof EnvelopeValidationError);
	}
});

runner.test('Error handling - should handle missing envelope data', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.decryptUserRecord({ id: 'user1', checksum: 'abc123' });
		throw new Error('Should have thrown EnvelopeValidationError');
	} catch (error) {
		assert.ok(error instanceof EnvelopeValidationError);
	}
});

runner.test('Error handling - should handle missing checksum', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	try {
		await migration.decryptUserRecord({ id: 'user1', envelope: 'encrypted-data' });
		throw new Error('Should have thrown EnvelopeValidationError');
	} catch (error) {
		assert.ok(error instanceof EnvelopeValidationError);
	}
});

// Test: Decryption Errors
runner.test('Error handling - should handle decryption method not available', async () => {
	const oldRecords = [{ id: 'user1', name: 'User One' }];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Perform migration
	await migration.migrate();

	// Get migrated record
	const migratedRecords = store.get('userRecords');
	const envelope = migratedRecords[0];

	// Remove decryption method
	secretVault._decryptWithAES256GCM = null;

	try {
		await migration.decryptUserRecord(envelope);
		throw new Error('Should have thrown DecryptionError');
	} catch (error) {
		assert.ok(error instanceof DecryptionError);
	}
});

runner.test('Error handling - should handle invalid decrypted plaintext', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock decryption to return invalid plaintext
	secretVault._decryptWithAES256GCM = () => null;

	try {
		await migration.decryptUserRecord({
			id: 'user1',
			envelope: 'encrypted-data',
			checksum: 'abc123'
		});
		throw new Error('Should have thrown DecryptionError');
	} catch (error) {
		assert.ok(error instanceof DecryptionError);
	}
});

runner.test('Error handling - should handle invalid JSON in decrypted plaintext', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock decryption to return invalid JSON
	const invalidJson = 'not valid json';
	secretVault._decryptWithAES256GCM = () => invalidJson;

	// Compute checksum for the invalid JSON
	const checksum = migration._computeChecksum(invalidJson);

	try {
		await migration.decryptUserRecord({
			id: 'user1',
			envelope: 'encrypted-data',
			checksum: checksum
		});
		throw new Error('Should have thrown DecryptionError');
	} catch (error) {
		assert.ok(error instanceof DecryptionError);
		assert.ok(error.message.includes('parse'));
	}
});

// Test: Partial Migration Failures
runner.test('Error handling - should continue migration when some records fail', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' },
		{ id: 'user3', name: 'User Three' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock encryption to fail for user2
	const originalEncrypt = secretVault._encryptWithAES256GCM;
	let encryptCount = 0;
	secretVault._encryptWithAES256GCM = (plaintext) => {
		encryptCount++;
		if (encryptCount === 2) {
			throw new Error('Encryption failed for user2');
		}
		return originalEncrypt(plaintext);
	};

	const result = await migration.migrate();

	// Should have migrated 2 records and failed 1
	assert.strictEqual(result.success, true);
	assert.strictEqual(result.totalRecords, 3);
	assert.strictEqual(result.migratedRecords, 2);
	assert.strictEqual(result.failedRecords, 1);
	assert.ok(result.failedDetails[0].id === 'user2');

	// Restore original encrypt
	secretVault._encryptWithAES256GCM = originalEncrypt;
});

runner.test('Error handling - should emit record-migration-failed event', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock encryption to fail for user2
	const originalEncrypt = secretVault._encryptWithAES256GCM;
	let encryptCount = 0;
	secretVault._encryptWithAES256GCM = (plaintext) => {
		encryptCount++;
		if (encryptCount === 2) {
			throw new Error('Encryption failed for user2');
		}
		return originalEncrypt(plaintext);
	};

	let failedEvents = [];
	migration.on('record-migration-failed', (data) => {
		failedEvents.push(data);
	});

	await migration.migrate();

	// Should have emitted one failed event
	assert.strictEqual(failedEvents.length, 1);
	assert.strictEqual(failedEvents[0].recordId, 'user2');
	assert.ok(failedEvents[0].error);

	// Restore original encrypt
	secretVault._encryptWithAES256GCM = originalEncrypt;
});

runner.test('Error handling - should throw error when all records fail', async () => {
	const oldRecords = [
		{ id: 'user1', name: 'User One' },
		{ id: 'user2', name: 'User Two' }
	];
	const store = createMockStore();
	store.set('userRecords', oldRecords);
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock encryption to always fail
	secretVault._encryptWithAES256GCM = () => {
		throw new Error('Encryption always fails');
	};

	try {
		await migration.migrate();
		throw new Error('Should have thrown MigrationFailedError');
	} catch (error) {
		assert.ok(error instanceof MigrationFailedError);
		assert.strictEqual(error.failedRecords.length, 2);
	}
});

// Test: Cross-Machine Detection
runner.test('Error handling - should detect cross-machine access on decryption', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Mock decryption to throw cross-machine error
	secretVault._decryptWithAES256GCM = () => {
		throw new Error('master key checksum mismatch - cross-machine copy detected');
	};

	try {
		await migration.decryptUserRecord({
			id: 'user1',
			envelope: 'encrypted-data',
			checksum: 'abc123'
		});
		throw new Error('Should have thrown CrossMachineDetectionError');
	} catch (error) {
		assert.ok(error instanceof CrossMachineDetectionError);
	}
});

runner.test('Error handling - should handle SecretVault not available', async () => {
	const store = createMockStore();
	const secretVault = createMockSecretVault();
	const migration = new UserMigration(store, secretVault);

	// Set secretVault to null
	migration.secretVault = null;

	try {
		await migration.decryptUserRecord({
			id: 'user1',
			envelope: 'encrypted-data',
			checksum: 'abc123'
		});
		throw new Error('Should have thrown DecryptionError');
	} catch (error) {
		assert.ok(error instanceof DecryptionError);
	}
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

/**
 * User Migration Service
 *
 * Handles migration of existing unencrypted user records to encrypted envelopes.
 * Detects old records, displays one-time migration dialog, encrypts records,
 * and deletes old unencrypted data.
 *
 * @module user-migration
 */

const crypto = require('crypto');

/**
 * Generate a simple UUID v4
 * @returns {string} UUID v4 string
 */
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Custom error classes for user migration
 */
class UserMigrationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'UserMigrationError';
	}
}

class MigrationNotNeededError extends Error {
	constructor(message = 'No migration needed') {
		super(message);
		this.name = 'MigrationNotNeededError';
	}
}

class MigrationFailedError extends Error {
	constructor(message, failedRecords = []) {
		super(message);
		this.name = 'MigrationFailedError';
		this.failedRecords = failedRecords;
	}
}

class ChecksumVerificationError extends Error {
	constructor(recordId, message = 'Checksum verification failed') {
		super(message);
		this.name = 'ChecksumVerificationError';
		this.recordId = recordId;
	}
}

class DecryptionError extends Error {
	constructor(recordId, message = 'Decryption failed') {
		super(message);
		this.name = 'DecryptionError';
		this.recordId = recordId;
	}
}

class EncryptionError extends Error {
	constructor(recordId, message = 'Encryption failed') {
		super(message);
		this.name = 'EncryptionError';
		this.recordId = recordId;
	}
}

class StorageError extends Error {
	constructor(operation, message = 'Storage operation failed') {
		super(message);
		this.name = 'StorageError';
		this.operation = operation;
	}
}

class CrossMachineDetectionError extends Error {
	constructor(message = 'Cross-machine secret access detected') {
		super(message);
		this.name = 'CrossMachineDetectionError';
	}
}

class EnvelopeValidationError extends Error {
	constructor(recordId, message = 'Invalid envelope structure') {
		super(message);
		this.name = 'EnvelopeValidationError';
		this.recordId = recordId;
	}
}

/**
 * UserMigration Service
 *
 * Manages migration of user records from unencrypted to encrypted format.
 * Uses SecretVault for encryption and KeyDerivation for master key management.
 */
class UserMigration {
	/**
	 * Create a new UserMigration instance
	 *
	 * @param {Object} store - electron-store instance for data persistence
	 * @param {SecretVault} secretVault - SecretVault instance for encryption
	 * @param {Object} options - Configuration options
	 * @param {string} options.userRecordsKey - Key for storing user records (default: 'userRecords')
	 * @param {string} options.migratedFlagKey - Key for migration flag (default: 'userRecordsMigrated')
	 * @param {string} options.oldRecordsBackupKey - Key for backup of old records (default: 'userRecordsBackup')
	 */
	constructor(store, secretVault, options = {}) {
		if (!store) {
			throw new UserMigrationError('Store instance is required');
		}
		if (!secretVault) {
			throw new UserMigrationError('SecretVault instance is required');
		}

		this.store = store;
		this.secretVault = secretVault;
		this.userRecordsKey = options.userRecordsKey || 'userRecords';
		this.migratedFlagKey = options.migratedFlagKey || 'userRecordsMigrated';
		this.oldRecordsBackupKey = options.oldRecordsBackupKey || 'userRecordsBackup';
		this.eventListeners = {};
	}

	/**
	 * Check if migration is needed
	 *
	 * Detects old unencrypted user records by checking for records without
	 * the 'envelope' field. Returns true if old records exist and migration
	 * has not been completed.
	 *
	 * @returns {Promise<boolean>} True if migration is needed, false otherwise
	 * @throws {UserMigrationError} If unable to check migration status
	 */
	async isMigrationNeeded() {
		try {
			// Check if migration has already been completed
			const migrationFlag = this.store.get(this.migratedFlagKey, false);
			if (migrationFlag) {
				return false;
			}

			// Check for old unencrypted user records
			const userRecords = this.store.get(this.userRecordsKey, null);
			if (!userRecords) {
				return false;
			}

			// If records exist and are not already migrated, check if they're in old format
			if (Array.isArray(userRecords)) {
				// Check if any record lacks the 'envelope' field (old format)
				return userRecords.some(record => !record.envelope);
			}

			// If records is an object (old format), migration is needed
			return typeof userRecords === 'object' && userRecords !== null;
		} catch (error) {
			throw new UserMigrationError(`Failed to check migration status: ${error.message}`);
		}
	}

	/**
	 * Perform the migration
	 *
	 * Encrypts all user records and stores them as envelopes. Deletes old
	 * unencrypted records after successful migration.
	 *
	 * @returns {Promise<Object>} Migration result with statistics
	 * @throws {MigrationFailedError} If migration fails for any records
	 * @throws {UserMigrationError} If migration cannot be performed
	 */
	async migrate() {
		try {
			// Check if migration is needed
			const needed = await this.isMigrationNeeded();
			if (!needed) {
				throw new MigrationNotNeededError('No migration needed');
			}

			// Retrieve old user records
			const oldRecords = this.store.get(this.userRecordsKey, null);
			if (!oldRecords) {
				throw new UserMigrationError('No user records found to migrate');
			}

			// Backup old records before migration
			try {
				this.store.set(this.oldRecordsBackupKey, oldRecords);
			} catch (error) {
				throw new StorageError('backup', `Failed to create backup: ${error.message}`);
			}

			// Convert records to array format if needed
			let recordsArray = Array.isArray(oldRecords) ? oldRecords : [oldRecords];

			// Migrate each record
			const migratedRecords = [];
			const failedRecords = [];

			for (const record of recordsArray) {
				try {
					const migratedRecord = await this._migrateRecord(record);
					migratedRecords.push(migratedRecord);
				} catch (error) {
					failedRecords.push({
						id: record.id || 'unknown',
						error: error.message,
						errorType: error.name
					});
					// Log the error for debugging
					this._emit('record-migration-failed', {
						recordId: record.id || 'unknown',
						error: error.message,
						errorType: error.name
					});
				}
			}

			// If all records failed, throw error
			if (failedRecords.length === recordsArray.length) {
				throw new MigrationFailedError(
					'All records failed to migrate',
					failedRecords
				);
			}

			// Store migrated records
			try {
				this.store.set(this.userRecordsKey, migratedRecords);
			} catch (error) {
				throw new StorageError('set', `Failed to store migrated records: ${error.message}`);
			}

			// Mark migration as complete
			try {
				this.store.set(this.migratedFlagKey, true);
				this.store.set('userRecordsMigratedAt', new Date().toISOString());
			} catch (error) {
				throw new StorageError('set', `Failed to set migration flag: ${error.message}`);
			}

			// Emit migration complete event
			this._emit('migration-complete', {
				totalRecords: recordsArray.length,
				migratedRecords: migratedRecords.length,
				failedRecords: failedRecords.length,
				failedDetails: failedRecords
			});

			return {
				success: true,
				totalRecords: recordsArray.length,
				migratedRecords: migratedRecords.length,
				failedRecords: failedRecords.length,
				failedDetails: failedRecords
			};
		} catch (error) {
			if (error instanceof MigrationNotNeededError) {
				throw error;
			}
			if (error instanceof MigrationFailedError) {
				throw error;
			}
			if (error instanceof StorageError) {
				throw error;
			}
			throw new UserMigrationError(`Migration failed: ${error.message}`);
		}
	}

	/**
	 * Migrate a single user record
	 *
	 * @private
	 * @param {Object} record - User record to migrate
	 * @returns {Promise<Object>} Migrated record with envelope
	 * @throws {EncryptionError} If encryption fails
	 * @throws {Error} If migration fails
	 */
	async _migrateRecord(record) {
		try {
			// Generate ID if not present
			const recordId = record.id || generateUUID();

			// Validate record
			if (!record || typeof record !== 'object') {
				throw new Error('Record must be a non-null object');
			}

			// Serialize the record as JSON
			let plaintext;
			try {
				plaintext = JSON.stringify(record);
			} catch (error) {
				throw new Error(`Failed to serialize record: ${error.message}`);
			}

			// Create envelope with encryption and checksum
			const envelope = await this._createEnvelope(plaintext);

			return {
				id: recordId,
				envelope: envelope.envelope,
				checksum: envelope.checksum,
				migratedAt: new Date().toISOString()
			};
		} catch (error) {
			if (error instanceof EncryptionError) {
				throw error;
			}
			throw new EncryptionError(record?.id || 'unknown', error.message);
		}
	}

	/**
	 * Create an encrypted envelope with checksum
	 *
	 * Encrypts plaintext data using SecretVault and computes SHA-256 checksum
	 * for integrity verification. The envelope structure contains:
	 * - envelope: Base64-encoded encrypted data (AES-256-GCM or safeStorage)
	 * - checksum: SHA-256 hash of plaintext for integrity verification
	 *
	 * The envelope format depends on the encryption backend:
	 * - safeStorage: Base64-encoded encrypted string
	 * - AES-256-GCM: JSON with iv, ciphertext, authTag (all base64-encoded)
	 *
	 * @param {string} plaintext - Data to encrypt (typically JSON-serialized record)
	 * @returns {Promise<Object>} Envelope with encrypted data and checksum
	 * @throws {EncryptionError} If encryption fails or backend not initialized
	 */
	async _createEnvelope(plaintext) {
		try {
			// Validate input
			if (!plaintext || typeof plaintext !== 'string') {
				throw new Error('Plaintext must be a non-empty string');
			}

			// Validate plaintext size (max 1MB)
			if (plaintext.length > 1024 * 1024) {
				throw new Error('Plaintext exceeds maximum size of 1MB');
			}

			// Compute SHA-256 checksum of plaintext for integrity verification
			let checksum;
			try {
				checksum = this._computeChecksum(plaintext);
			} catch (error) {
				throw new Error(`Failed to compute checksum: ${error.message}`);
			}

			// Encrypt plaintext using SecretVault's internal encryption methods
			// We access the vault's encryption directly to get the encrypted envelope
			let envelope;

			if (!this.secretVault) {
				throw new Error('SecretVault instance not available');
			}

			if (!this.secretVault.encryptionBackend) {
				throw new Error('SecretVault encryption backend not initialized');
			}

			try {
				if (this.secretVault.encryptionBackend === 'safeStorage') {
					// Use Electron's safeStorage encryption
					// Returns Base64-encoded encrypted data
					if (!this.secretVault._encryptWithSafeStorage) {
						throw new Error('safeStorage encryption method not available');
					}
					envelope = this.secretVault._encryptWithSafeStorage(plaintext);
				} else if (this.secretVault.encryptionBackend === 'aes256gcm') {
					// Use AES-256-GCM encryption with random IV
					// Returns JSON with iv, ciphertext, authTag (all base64-encoded)
					if (!this.secretVault._encryptWithAES256GCM) {
						throw new Error('AES-256-GCM encryption method not available');
					}
					envelope = this.secretVault._encryptWithAES256GCM(plaintext);
				} else {
					throw new Error(
						`Unknown encryption backend: ${this.secretVault.encryptionBackend}`
					);
				}
			} catch (error) {
				if (error.message.includes('not available')) {
					throw error;
				}
				throw new Error(`Encryption operation failed: ${error.message}`);
			}

			// Validate encrypted envelope
			if (!envelope || typeof envelope !== 'string') {
				throw new Error('Encryption produced invalid envelope');
			}

			if (envelope.length === 0) {
				throw new Error('Encryption produced empty envelope');
			}

			return {
				envelope: envelope,
				checksum: checksum
			};
		} catch (error) {
			if (error instanceof EncryptionError) {
				throw error;
			}
			throw new EncryptionError('unknown', `Failed to create envelope: ${error.message}`);
		}
	}

	/**
	 * Decrypt a user record from its envelope
	 *
	 * Decrypts the envelope and verifies the checksum for integrity.
	 * Detects cross-machine access attempts when master key checksum doesn't match.
	 *
	 * @param {Object} envelope - Encrypted envelope with structure { id, envelope, checksum, migratedAt }
	 * @returns {Promise<Object>} Decrypted user record
	 * @throws {DecryptionError} If decryption fails
	 * @throws {ChecksumVerificationError} If checksum verification fails
	 * @throws {CrossMachineDetectionError} If master key checksum doesn't match
	 * @throws {EnvelopeValidationError} If envelope structure is invalid
	 */
	async decryptUserRecord(envelope) {
		try {
			// Validate envelope structure
			if (!envelope || typeof envelope !== 'object') {
				throw new EnvelopeValidationError(
					'unknown',
					'Envelope must be a non-null object'
				);
			}

			if (!envelope.envelope || typeof envelope.envelope !== 'string') {
				throw new EnvelopeValidationError(
					envelope?.id || 'unknown',
					'Envelope data must be a non-empty string'
				);
			}

			if (!envelope.checksum || typeof envelope.checksum !== 'string') {
				throw new EnvelopeValidationError(
					envelope?.id || 'unknown',
					'Checksum must be a non-empty string'
				);
			}

			const recordId = envelope.id || 'unknown';

			try {
				// Decrypt the envelope using SecretVault's decryption methods
				let plaintext;

				if (!this.secretVault) {
					throw new Error('SecretVault instance not available');
				}

				if (!this.secretVault.encryptionBackend) {
					throw new Error('SecretVault encryption backend not initialized');
				}

				try {
					if (this.secretVault.encryptionBackend === 'safeStorage') {
						// Decrypt using safeStorage
						if (!this.secretVault._decryptWithSafeStorage) {
							throw new Error('safeStorage decryption method not available');
						}
						plaintext = this.secretVault._decryptWithSafeStorage(envelope.envelope);
					} else if (this.secretVault.encryptionBackend === 'aes256gcm') {
						// Decrypt using AES-256-GCM
						if (!this.secretVault._decryptWithAES256GCM) {
							throw new Error('AES-256-GCM decryption method not available');
						}
						plaintext = this.secretVault._decryptWithAES256GCM(envelope.envelope);
					} else {
						throw new Error('SecretVault encryption backend not initialized');
					}
				} catch (error) {
					// Check if this is a cross-machine detection error
					if (error.message && error.message.includes('cross-machine')) {
						throw new CrossMachineDetectionError(
							`Cross-machine secret access detected: ${error.message}`
						);
					}
					// Check if this is a master key mismatch
					if (error.message && error.message.includes('master key') && error.message.includes('mismatch')) {
						throw new CrossMachineDetectionError(
							'Master key checksum mismatch - data cannot be accessed on this machine'
						);
					}
					throw new DecryptionError(recordId, error.message);
				}

				// Validate decrypted plaintext
				if (!plaintext || typeof plaintext !== 'string') {
					throw new DecryptionError(
						recordId,
						'Decryption produced invalid plaintext'
					);
				}

				// Verify checksum
				const computedChecksum = this._computeChecksum(plaintext);
				if (computedChecksum !== envelope.checksum) {
					throw new ChecksumVerificationError(
						recordId,
						`Checksum mismatch: expected ${envelope.checksum}, got ${computedChecksum}`
					);
				}

				// Parse and return the decrypted record
				let record;
				try {
					record = JSON.parse(plaintext);
				} catch (error) {
					throw new DecryptionError(
						recordId,
						`Failed to parse decrypted record: ${error.message}`
					);
				}

				return record;
			} catch (error) {
				if (error instanceof ChecksumVerificationError) {
					throw error;
				}
				if (error instanceof CrossMachineDetectionError) {
					throw error;
				}
				if (error instanceof DecryptionError) {
					throw error;
				}
				throw new DecryptionError(recordId, error.message);
			}
		} catch (error) {
			if (error instanceof DecryptionError || 
				error instanceof ChecksumVerificationError ||
				error instanceof CrossMachineDetectionError ||
				error instanceof EnvelopeValidationError) {
				throw error;
			}
			throw new DecryptionError(
				envelope?.id || 'unknown',
				`Decryption failed: ${error.message}`
			);
		}
	}

	/**
	 * Verify record checksum
	 *
	 * Computes the SHA-256 checksum of plaintext and compares it to the
	 * stored checksum for integrity verification.
	 *
	 * @param {string} plaintext - Plaintext data to verify
	 * @param {string} storedChecksum - Stored checksum to compare against
	 * @returns {boolean} True if checksums match, false otherwise
	 */
	verifyRecordChecksum(plaintext, storedChecksum) {
		try {
			const computedChecksum = this._computeChecksum(plaintext);
			return computedChecksum === storedChecksum;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Compute SHA-256 checksum
	 *
	 * @private
	 * @param {string} data - Data to checksum
	 * @returns {string} Hex-encoded SHA-256 checksum
	 */
	_computeChecksum(data) {
		return crypto
			.createHash('sha256')
			.update(data, 'utf8')
			.digest('hex');
	}

	/**
	 * Delete old unencrypted records
	 *
	 * Removes the old unencrypted user records from storage after successful
	 * migration. This should only be called after migration is complete and
	 * verified.
	 *
	 * @returns {Promise<void>}
	 * @throws {UserMigrationError} If deletion fails
	 * @throws {StorageError} If storage operation fails
	 */
	async deleteOldRecords() {
		try {
			// Only delete if migration is complete
			const migrationFlag = this.store.get(this.migratedFlagKey, false);
			if (!migrationFlag) {
				throw new UserMigrationError('Cannot delete old records: migration not complete');
			}

			// Delete old records
			try {
				this.store.delete(this.userRecordsKey);
			} catch (error) {
				throw new StorageError('delete', `Failed to delete old records: ${error.message}`);
			}

			// Optionally keep backup for a period of time, then delete
			// For now, we keep the backup indefinitely for recovery purposes
			// this.store.delete(this.oldRecordsBackupKey);

			this._emit('old-records-deleted', {
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			if (error instanceof StorageError) {
				throw error;
			}
			if (error instanceof UserMigrationError) {
				throw error;
			}
			throw new UserMigrationError(`Failed to delete old records: ${error.message}`);
		}
	}

	/**
	 * Get migration status
	 *
	 * Returns information about the migration status and statistics.
	 *
	 * @returns {Promise<Object>} Migration status object
	 */
	async getMigrationStatus() {
		try {
			const migrationNeeded = await this.isMigrationNeeded();
			const migrationFlag = this.store.get(this.migratedFlagKey, false);
			const migratedAt = this.store.get('userRecordsMigratedAt', null);
			const userRecords = this.store.get(this.userRecordsKey, null);
			const backupRecords = this.store.get(this.oldRecordsBackupKey, null);

			return {
				migrationNeeded,
				migrationComplete: migrationFlag,
				migratedAt,
				recordCount: Array.isArray(userRecords) ? userRecords.length : (userRecords ? 1 : 0),
				hasBackup: !!backupRecords
			};
		} catch (error) {
			throw new UserMigrationError(`Failed to get migration status: ${error.message}`);
		}
	}

	/**
	 * Restore from backup
	 *
	 * Restores user records from backup. Useful for recovery if migration fails.
	 *
	 * @returns {Promise<void>}
	 * @throws {UserMigrationError} If restore fails
	 */
	async restoreFromBackup() {
		try {
			const backup = this.store.get(this.oldRecordsBackupKey, null);
			if (!backup) {
				throw new UserMigrationError('No backup available for restore');
			}

			// Restore backup
			this.store.set(this.userRecordsKey, backup);

			// Reset migration flag
			this.store.set(this.migratedFlagKey, false);
			this.store.delete('userRecordsMigratedAt');

			this._emit('backup-restored', {
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			throw new UserMigrationError(`Failed to restore from backup: ${error.message}`);
		}
	}

	/**
	 * Event listener management
	 */

	/**
	 * Register event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 */
	on(event, callback) {
		if (!this.eventListeners[event]) {
			this.eventListeners[event] = [];
		}
		this.eventListeners[event].push(callback);
	}

	/**
	 * Unregister event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 */
	off(event, callback) {
		if (!this.eventListeners[event]) {
			return;
		}
		this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
	}

	/**
	 * Emit event
	 *
	 * @private
	 * @param {string} event - Event name
	 * @param {*} data - Event data
	 */
	_emit(event, data) {
		if (!this.eventListeners[event]) {
			return;
		}
		this.eventListeners[event].forEach(callback => {
			try {
				callback(data);
			} catch (error) {
				console.error(`Error in event listener for ${event}:`, error);
			}
		});
	}
}

module.exports = {
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
};

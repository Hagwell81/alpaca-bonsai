/**
 * API Key Migration Service
 *
 * Migrates API key from plain text configuration to Secret_Vault for secure encrypted storage.
 *
 * Features:
 * - Detects existing API key in plain config
 * - Encrypts and stores in Secret_Vault
 * - Removes API key from plain config after successful migration
 * - Handles cases where API key doesn't exist or migration fails
 * - Comprehensive logging for debugging
 * - One-time migration flag to prevent repeated migrations
 */

const path = require('path');

/**
 * Custom error classes for API key migration
 */
class ApiKeyMigrationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ApiKeyMigrationError';
	}
}

class ApiKeyNotFoundError extends ApiKeyMigrationError {
	constructor() {
		super('API key not found in plain config');
		this.name = 'ApiKeyNotFoundError';
	}
}

class MigrationAlreadyCompletedError extends ApiKeyMigrationError {
	constructor() {
		super('API key migration already completed');
		this.name = 'MigrationAlreadyCompletedError';
	}
}

/**
 * ApiKeyMigration - Service for migrating API key to Secret_Vault
 *
 * Manages the one-time migration of API key from plain text configuration
 * to encrypted Secret_Vault storage.
 */
class ApiKeyMigration {
	/**
	 * Create a new ApiKeyMigration instance
	 *
	 * @param {Object} store - electron-store instance for configuration
	 * @param {Object} secretVault - SecretVault instance for encrypted storage
	 * @param {Object} options - Configuration options
	 * @param {string} options.configKey - electron-store key for API config (default: 'apiServer')
	 * @param {string} options.vaultKey - Secret_Vault key for API key (default: 'api_key')
	 * @param {string} options.migrationFlagKey - electron-store key for migration flag (default: 'apiKeyMigrationCompleted')
	 */
	constructor(store, secretVault, options = {}) {
		if (!store) {
			throw new ApiKeyMigrationError('store is required');
		}
		if (!secretVault) {
			throw new ApiKeyMigrationError('secretVault is required');
		}

		this.store = store;
		this.secretVault = secretVault;
		this.options = {
			configKey: options.configKey || 'apiServer',
			vaultKey: options.vaultKey || 'api_key',
			migrationFlagKey: options.migrationFlagKey || 'apiKeyMigrationCompleted',
			...options
		};

		this.logger = options.logger || console;
	}

	/**
	 * Check if migration is needed
	 *
	 * Returns true if:
	 * - API key exists in plain config
	 * - Migration has not been completed yet
	 *
	 * @returns {boolean} True if migration is needed
	 */
	isMigrationNeeded() {
		try {
			// Check if migration already completed
			const migrationCompleted = this.store.get(this.options.migrationFlagKey, false);
			if (migrationCompleted) {
				this.logger.debug('[ApiKeyMigration] Migration already completed');
				return false;
			}

			// Check if API key exists in plain config
			const apiConfig = this.store.get(this.options.configKey, {});
			const hasApiKey = apiConfig.apiKey && typeof apiConfig.apiKey === 'string' && apiConfig.apiKey.length > 0;

			if (hasApiKey) {
				this.logger.debug('[ApiKeyMigration] API key found in plain config - migration needed');
				return true;
			}

			this.logger.debug('[ApiKeyMigration] No API key found in plain config');
			return false;
		} catch (error) {
			this.logger.error(`[ApiKeyMigration] Error checking migration status: ${error.message}`);
			return false;
		}
	}

	/**
	 * Perform API key migration
	 *
	 * Migrates API key from plain config to Secret_Vault:
	 * 1. Check if migration is needed
	 * 2. Retrieve API key from plain config
	 * 3. Encrypt and store in Secret_Vault
	 * 4. Remove API key from plain config
	 * 5. Mark migration as completed
	 *
	 * @returns {Promise<Object>} Migration result with status and details
	 * @throws {MigrationAlreadyCompletedError} If migration already completed
	 * @throws {ApiKeyNotFoundError} If API key not found in plain config
	 * @throws {ApiKeyMigrationError} If migration fails
	 */
	async migrate() {
		try {
			// Check if migration already completed
			const migrationCompleted = this.store.get(this.options.migrationFlagKey, false);
			if (migrationCompleted) {
				this.logger.warn('[ApiKeyMigration] Migration already completed');
				throw new MigrationAlreadyCompletedError();
			}

			// Get API config
			const apiConfig = this.store.get(this.options.configKey, {});
			const apiKey = apiConfig.apiKey;

			// Check if API key exists
			if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
				this.logger.info('[ApiKeyMigration] No API key found in plain config - skipping migration');
				throw new ApiKeyNotFoundError();
			}

			this.logger.info('[ApiKeyMigration] Starting API key migration');

			// Ensure Secret_Vault is initialized
			if (!this.secretVault.isInitialized()) {
				this.logger.debug('[ApiKeyMigration] Initializing Secret_Vault');
				await this.secretVault.initialize();
			}

			// Store API key in Secret_Vault
			this.logger.debug('[ApiKeyMigration] Encrypting and storing API key in Secret_Vault');
			await this.secretVault.setSecret(this.options.vaultKey, apiKey, {
				metadata: {
					migratedFrom: 'plainConfig',
					migratedAt: new Date().toISOString()
				}
			});

			// Remove API key from plain config
			this.logger.debug('[ApiKeyMigration] Removing API key from plain config');
			const updatedConfig = { ...apiConfig };
			delete updatedConfig.apiKey;
			this.store.set(this.options.configKey, updatedConfig);

			// Mark migration as completed
			this.logger.debug('[ApiKeyMigration] Marking migration as completed');
			this.store.set(this.options.migrationFlagKey, true);

			this.logger.info('[ApiKeyMigration] API key migration completed successfully');

			return {
				success: true,
				message: 'API key migrated to Secret_Vault',
				vaultKey: this.options.vaultKey,
				timestamp: new Date().toISOString()
			};
		} catch (error) {
			if (error instanceof ApiKeyMigrationError) {
				throw error;
			}
			this.logger.error(`[ApiKeyMigration] Migration failed: ${error.message}`);
			throw new ApiKeyMigrationError(`Migration failed: ${error.message}`);
		}
	}

	/**
	 * Retrieve API key from Secret_Vault
	 *
	 * Gets the API key that was migrated to Secret_Vault.
	 * Returns null if API key not found or migration not completed.
	 *
	 * @returns {Promise<string|null>} API key or null if not found
	 * @throws {ApiKeyMigrationError} If retrieval fails
	 */
	async getApiKey() {
		try {
			// Ensure Secret_Vault is initialized
			if (!this.secretVault.isInitialized()) {
				this.logger.debug('[ApiKeyMigration] Initializing Secret_Vault');
				await this.secretVault.initialize();
			}

			// Try to get API key from Secret_Vault
			const apiKey = await this.secretVault.getSecret(this.options.vaultKey);
			return apiKey;
		} catch (error) {
			if (error.name === 'SecretNotFoundError') {
				this.logger.debug('[ApiKeyMigration] API key not found in Secret_Vault');
				return null;
			}
			this.logger.error(`[ApiKeyMigration] Failed to retrieve API key: ${error.message}`);
			throw new ApiKeyMigrationError(`Failed to retrieve API key: ${error.message}`);
		}
	}

	/**
	 * Set API key in Secret_Vault
	 *
	 * Stores or updates the API key in Secret_Vault.
	 *
	 * @param {string} apiKey - API key to store
	 * @returns {Promise<void>}
	 * @throws {ApiKeyMigrationError} If storage fails
	 */
	async setApiKey(apiKey) {
		try {
			if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
				throw new ApiKeyMigrationError('API key must be a non-empty string');
			}

			// Ensure Secret_Vault is initialized
			if (!this.secretVault.isInitialized()) {
				this.logger.debug('[ApiKeyMigration] Initializing Secret_Vault');
				await this.secretVault.initialize();
			}

			// Store API key in Secret_Vault
			this.logger.debug('[ApiKeyMigration] Storing API key in Secret_Vault');
			await this.secretVault.setSecret(this.options.vaultKey, apiKey, {
				metadata: {
					updatedAt: new Date().toISOString()
				}
			});

			// Mark migration as completed (in case it wasn't already)
			this.store.set(this.options.migrationFlagKey, true);

			this.logger.info('[ApiKeyMigration] API key stored in Secret_Vault');
		} catch (error) {
			if (error instanceof ApiKeyMigrationError) {
				throw error;
			}
			this.logger.error(`[ApiKeyMigration] Failed to store API key: ${error.message}`);
			throw new ApiKeyMigrationError(`Failed to store API key: ${error.message}`);
		}
	}

	/**
	 * Delete API key from Secret_Vault
	 *
	 * Removes the API key from Secret_Vault.
	 *
	 * @returns {Promise<void>}
	 * @throws {ApiKeyMigrationError} If deletion fails
	 */
	async deleteApiKey() {
		try {
			// Ensure Secret_Vault is initialized
			if (!this.secretVault.isInitialized()) {
				this.logger.debug('[ApiKeyMigration] Initializing Secret_Vault');
				await this.secretVault.initialize();
			}

			// Delete API key from Secret_Vault
			this.logger.debug('[ApiKeyMigration] Deleting API key from Secret_Vault');
			await this.secretVault.deleteSecret(this.options.vaultKey);

			this.logger.info('[ApiKeyMigration] API key deleted from Secret_Vault');
		} catch (error) {
			this.logger.error(`[ApiKeyMigration] Failed to delete API key: ${error.message}`);
			throw new ApiKeyMigrationError(`Failed to delete API key: ${error.message}`);
		}
	}

	/**
	 * Get migration status
	 *
	 * Returns information about the migration status.
	 *
	 * @returns {Object} Migration status object
	 */
	getMigrationStatus() {
		try {
			const migrationCompleted = this.store.get(this.options.migrationFlagKey, false) === true;
			const apiConfig = this.store.get(this.options.configKey, {}) || {};
			const hasPlainApiKey = !!(apiConfig && apiConfig.apiKey && typeof apiConfig.apiKey === 'string' && apiConfig.apiKey.length > 0);

			return {
				migrationCompleted: !!migrationCompleted,
				hasPlainApiKey,
				needsMigration: hasPlainApiKey && !migrationCompleted,
				timestamp: new Date().toISOString()
			};
		} catch (error) {
			this.logger.error(`[ApiKeyMigration] Failed to get migration status: ${error.message}`);
			return {
				migrationCompleted: false,
				hasPlainApiKey: false,
				needsMigration: false,
				error: error.message
			};
		}
	}
}

module.exports = {
	ApiKeyMigration,
	ApiKeyMigrationError,
	ApiKeyNotFoundError,
	MigrationAlreadyCompletedError
};

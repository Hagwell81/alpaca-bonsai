/**
 * SecretVault - Encrypted secret storage module
 *
 * Provides secure storage for sensitive data (API keys, tokens, user records)
 * using OS-native credential stores with machine-bound encryption keys.
 *
 * Features:
 * - AES-256-GCM encryption with machine-bound keys
 * - Electron's safeStorage API integration (Windows DPAPI, macOS Keychain, Linux libsecret)
 * - Fallback to manual key derivation if safeStorage unavailable
 * - Token expiration and refresh support
 * - Cross-machine copy detection via checksum verification
 * - Size limits enforcement (keys: 256 chars, values: 1 MB)
 */

const crypto = require('crypto');
const { safeStorage } = require('electron');

/**
 * Custom error classes for SecretVault operations
 */
class SecretVaultError extends Error {
	constructor(message) {
		super(message);
		this.name = 'SecretVaultError';
	}
}

class SecretNotFoundError extends SecretVaultError {
	constructor(key) {
		super(`Secret not found: ${key}`);
		this.name = 'SecretNotFoundError';
	}
}

class DecryptionFailedError extends SecretVaultError {
	constructor(message = 'Decryption failed') {
		super(message);
		this.name = 'DecryptionFailedError';
	}
}

class TokenExpiredError extends SecretVaultError {
	constructor(key) {
		super(`Token expired: ${key}`);
		this.name = 'TokenExpiredError';
	}
}

class TokenRefreshFailedError extends SecretVaultError {
	constructor(key, reason) {
		super(`Token refresh failed for ${key}: ${reason}`);
		this.name = 'TokenRefreshFailedError';
	}
}

class ValidationError extends SecretVaultError {
	constructor(message) {
		super(message);
		this.name = 'ValidationError';
	}
}

/**
 * SecretVault - Core encrypted secret storage class
 *
 * Manages encrypted storage of secrets with support for:
 * - Multiple encryption backends (safeStorage or AES-256-GCM)
 * - Token expiration and refresh
 * - Cross-machine copy detection
 * - Size limit enforcement
 */
class SecretVault {
	/**
	 * Create a new SecretVault instance
	 *
	 * @param {Object} store - electron-store instance for persistence
	 * @param {Object} keyDerivation - KeyDerivation service instance (optional)
	 * @param {Object} options - Configuration options
	 * @param {boolean} options.useSafeStorage - Force use of safeStorage if available (default: true)
	 * @param {number} options.maxKeyLength - Maximum key length in characters (default: 256)
	 * @param {number} options.maxValueSize - Maximum value size in bytes (default: 1MB)
	 */
	constructor(store, keyDerivation = null, options = {}) {
		if (!store) {
			throw new ValidationError('store is required');
		}

		this.store = store;
		this.keyDerivation = keyDerivation;
		this.options = {
			useSafeStorage: options.useSafeStorage !== false,
			maxKeyLength: options.maxKeyLength || 256,
			maxValueSize: options.maxValueSize || 1024 * 1024, // 1 MB
			...options
		};

		// Encryption backend state
		this.encryptionBackend = null; // 'safeStorage' or 'aes256gcm'
		this.masterKey = null; // For AES-256-GCM fallback
		this.masterKeyChecksum = null; // For cross-machine detection
		this.initialized = false;

		// Event listeners
		this.listeners = {
			'token-expiring-soon': [],
			'token-expired': [],
			'token-refreshed': [],
			'token-refresh-failed': [],
			'encryption-backend-changed': []
		};
	}

	/**
	 * Initialize the SecretVault
	 *
	 * Determines encryption backend (safeStorage or AES-256-GCM) and sets up
	 * master key derivation if needed.
	 *
	 * @returns {Promise<void>}
	 * @throws {SecretVaultError} If initialization fails
	 */
	async initialize() {
		if (this.initialized) {
			return;
		}

		try {
			// Try to use Electron's safeStorage first
			if (this.options.useSafeStorage && this._isSafeStorageAvailable()) {
				this.encryptionBackend = 'safeStorage';
				this._emit('encryption-backend-changed', { backend: 'safeStorage' });
			} else {
				// Fall back to AES-256-GCM with key derivation
				if (!this.keyDerivation) {
					throw new SecretVaultError(
						'KeyDerivation service required when safeStorage is unavailable'
					);
				}
				await this._initializeAES256GCM();
				this.encryptionBackend = 'aes256gcm';
				this._emit('encryption-backend-changed', { backend: 'aes256gcm' });
			}

			this.initialized = true;
		} catch (error) {
			if (error instanceof SecretVaultError) {
				throw error;
			}
			throw new SecretVaultError(`Failed to initialize SecretVault: ${error.message}`);
		}
	}

	/**
	 * Check if Electron's safeStorage is available
	 *
	 * @private
	 * @returns {boolean}
	 */
	_isSafeStorageAvailable() {
		try {
			return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' &&
				safeStorage.isEncryptionAvailable();
		} catch (error) {
			console.warn(`safeStorage availability check failed: ${error.message}`);
			return false;
		}
	}

	/**
	 * Initialize AES-256-GCM encryption backend
	 *
	 * Derives master key from machine/user identity and stores checksum
	 * for cross-machine copy detection.
	 *
	 * @private
	 * @returns {Promise<void>}
	 * @throws {SecretVaultError} If key derivation fails
	 */
	async _initializeAES256GCM() {
		if (!this.keyDerivation) {
			throw new SecretVaultError(
				'KeyDerivation service required for AES-256-GCM backend'
			);
		}

		try {
			// Derive master key from platform identity
			this.masterKey = await this.keyDerivation.deriveMasterKey();

			// Get or create checksum for cross-machine detection
			const storedChecksum = this.store.get('vault.masterKeyChecksum');
			const currentChecksum = await this.keyDerivation.getMasterKeyChecksum();

			if (storedChecksum) {
				// Verify checksum matches (detect cross-machine copy)
				const checksumMatch = await this.keyDerivation.verifyChecksum(storedChecksum);
				if (!checksumMatch) {
					throw new DecryptionFailedError(
						'Master key checksum mismatch - possible cross-machine copy detected'
					);
				}
				this.masterKeyChecksum = storedChecksum;
			} else {
				// First time - store checksum
				this.masterKeyChecksum = currentChecksum;
				this.store.set('vault.masterKeyChecksum', currentChecksum);
			}
		} catch (error) {
			if (error instanceof DecryptionFailedError) {
				throw error;
			}
			throw new SecretVaultError(`Failed to initialize AES-256-GCM: ${error.message}`);
		}
	}

	/**
	 * Store an encrypted secret
	 *
	 * Encrypts the value using the selected backend and stores it with
	 * optional metadata (expiration, scope, checksum).
	 *
	 * @param {string} key - Secret identifier (max 256 characters)
	 * @param {string} value - Secret value to encrypt (max 1 MB)
	 * @param {Object} options - Storage options
	 * @param {string} options.expiresAt - ISO 8601 expiration timestamp (optional)
	 * @param {string} options.scope - Token scope identifier (optional)
	 * @param {Object} options.metadata - Additional metadata (optional)
	 * @returns {Promise<void>}
	 * @throws {ValidationError} If key or value exceeds size limits
	 * @throws {SecretVaultError} If encryption fails
	 */
	async setSecret(key, value, options = {}) {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		// Validate inputs
		this._validateKey(key);
		this._validateValue(value);

		try {
			const secretData = {
				value,
				createdAt: new Date().toISOString(),
				...options
			};

			// Compute SHA-256 checksum of plaintext value
			const checksum = crypto
				.createHash('sha256')
				.update(value, 'utf8')
				.digest('hex');
			secretData.checksum = checksum;

			// Encrypt based on backend
			let encryptedData;
			if (this.encryptionBackend === 'safeStorage') {
				encryptedData = this._encryptWithSafeStorage(JSON.stringify(secretData));
			} else {
				encryptedData = this._encryptWithAES256GCM(JSON.stringify(secretData));
			}

			// Store encrypted data
			this.store.set(`vault.secrets.${key}`, encryptedData);
		} catch (error) {
			if (error instanceof ValidationError) {
				throw error;
			}
			throw new SecretVaultError(`Failed to store secret: ${error.message}`);
		}
	}

	/**
	 * Retrieve a decrypted secret
	 *
	 * Decrypts and returns the secret value. Checks token expiration
	 * and emits events if token is expiring soon or has expired.
	 *
	 * @param {string} key - Secret identifier
	 * @returns {Promise<string|null>} Decrypted secret value or null if not found
	 * @throws {SecretNotFoundError} If key does not exist
	 * @throws {DecryptionFailedError} If decryption fails
	 * @throws {TokenExpiredError} If token has expired
	 */
	async getSecret(key) {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		const encryptedData = this.store.get(`vault.secrets.${key}`);
		if (!encryptedData) {
			return null;
		}

		try {
			// Decrypt based on backend
			let secretDataJson;
			if (this.encryptionBackend === 'safeStorage') {
				secretDataJson = this._decryptWithSafeStorage(encryptedData);
			} else {
				secretDataJson = this._decryptWithAES256GCM(encryptedData);
			}

			const secretData = JSON.parse(secretDataJson);

			// Check token expiration
			if (secretData.expiresAt) {
				const expiresAt = new Date(secretData.expiresAt);
				const now = new Date();
				const timeUntilExpiry = expiresAt - now;

				if (timeUntilExpiry <= 0) {
					// Token has expired
					this._emit('token-expired', { key, expiresAt: secretData.expiresAt });
					throw new TokenExpiredError(key);
				}

				// Check if expiring within 24 hours
				const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);
				if (hoursUntilExpiry <= 24) {
					this._emit('token-expiring-soon', {
						key,
						expiresAt: secretData.expiresAt,
						secondsRemaining: Math.floor(timeUntilExpiry / 1000)
					});
				}
			}

			return secretData.value;
		} catch (error) {
			if (error instanceof TokenExpiredError) {
				throw error;
			}
			throw new DecryptionFailedError(`Failed to decrypt secret: ${error.message}`);
		}
	}

	/**
	 * Delete a secret
	 *
	 * Removes the encrypted entry from storage.
	 *
	 * @param {string} key - Secret identifier
	 * @returns {Promise<void>}
	 * @throws {SecretVaultError} If deletion fails
	 */
	async deleteSecret(key) {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		try {
			this.store.delete(`vault.secrets.${key}`);
		} catch (error) {
			throw new SecretVaultError(`Failed to delete secret: ${error.message}`);
		}
	}

	/**
	 * List all stored secret keys
	 *
	 * Returns an array of all secret keys (not values).
	 *
	 * @returns {string[]} Array of secret keys
	 * @throws {SecretVaultError} If listing fails
	 */
	listSecrets() {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		try {
			const allKeys = this.store.store || {};
			const secretKeys = [];

			for (const key in allKeys) {
				if (key.startsWith('vault.secrets.')) {
					const secretKey = key.replace('vault.secrets.', '');
					secretKeys.push(secretKey);
				}
			}

			return secretKeys;
		} catch (error) {
			throw new SecretVaultError(`Failed to list secrets: ${error.message}`);
		}
	}

	/**
	 * Get secret metadata (expiration, scope, etc.)
	 *
	 * Returns metadata about a secret without decrypting the value.
	 *
	 * @param {string} key - Secret identifier
	 * @returns {Promise<Object|null>} Metadata object or null if not found
	 * @throws {DecryptionFailedError} If decryption fails
	 */
	async getSecretMetadata(key) {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		const encryptedData = this.store.get(`vault.secrets.${key}`);
		if (!encryptedData) {
			return null;
		}

		try {
			// Decrypt to get metadata
			let secretDataJson;
			if (this.encryptionBackend === 'safeStorage') {
				secretDataJson = this._decryptWithSafeStorage(encryptedData);
			} else {
				secretDataJson = this._decryptWithAES256GCM(encryptedData);
			}

			const secretData = JSON.parse(secretDataJson);

			// Return metadata without the value
			return {
				createdAt: secretData.createdAt,
				expiresAt: secretData.expiresAt || null,
				scope: secretData.scope || null,
				checksum: secretData.checksum,
				metadata: secretData.metadata || {}
			};
		} catch (error) {
			throw new DecryptionFailedError(`Failed to get metadata: ${error.message}`);
		}
	}

	/**
	 * Refresh a token if expiring
	 *
	 * Calls the provided refresh function to get a new token and updates
	 * the stored token with new expiration time.
	 *
	 * @param {string} key - Secret identifier
	 * @param {Function} refreshFn - Async function that returns { token, expiresAt }
	 * @returns {Promise<string>} New token value
	 * @throws {TokenRefreshFailedError} If refresh fails
	 * @throws {SecretVaultError} If vault is not initialized
	 */
	async refreshToken(key, refreshFn) {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		if (typeof refreshFn !== 'function') {
			throw new TokenRefreshFailedError(key, 'refreshFn must be a function');
		}

		try {
			// Get current token
			const currentToken = await this.getSecret(key);
			if (!currentToken) {
				throw new Error('Token not found');
			}

			// Call refresh function
			const result = await refreshFn(key, currentToken);
			if (!result || !result.token) {
				throw new Error('Refresh function did not return token');
			}

			// Get metadata for scope and other fields
			let metadata = {};
			try {
				const metadataObj = await this.getSecretMetadata(key);
				if (metadataObj) {
					metadata = {
						scope: metadataObj.scope,
						metadata: metadataObj.metadata
					};
				}
			} catch (metadataError) {
				// Log but don't fail - continue with refresh
				console.warn(`Failed to retrieve metadata for token refresh: ${metadataError.message}`);
			}

			// Update stored token
			await this.setSecret(key, result.token, {
				expiresAt: result.expiresAt,
				...metadata
			});

			this._emit('token-refreshed', { key, expiresAt: result.expiresAt });
			return result.token;
		} catch (error) {
			if (error instanceof TokenRefreshFailedError) {
				throw error;
			}
			this._emit('token-refresh-failed', { key, error: error.message });
			throw new TokenRefreshFailedError(key, error.message);
		}
	}

	/**
	 * Verify master key checksum for cross-machine detection
	 *
	 * Checks if the stored master key checksum matches the current
	 * derived key's checksum. Used to detect if secrets were copied
	 * to a different machine.
	 *
	 * @returns {Promise<boolean>} True if checksum matches, false otherwise
	 * @throws {SecretVaultError} If verification fails
	 */
	async verifyMasterKeyChecksum() {
		if (!this.initialized) {
			throw new SecretVaultError('SecretVault not initialized');
		}

		if (this.encryptionBackend !== 'aes256gcm') {
			// safeStorage handles this internally
			return true;
		}

		try {
			const storedChecksum = this.store.get('vault.masterKeyChecksum');
			if (!storedChecksum) {
				return true; // No checksum stored yet
			}

			const checksumMatch = await this.keyDerivation.verifyChecksum(storedChecksum);
			return checksumMatch;
		} catch (error) {
			throw new SecretVaultError(`Failed to verify checksum: ${error.message}`);
		}
	}

	/**
	 * Encrypt data using Electron's safeStorage
	 *
	 * @private
	 * @param {string} plaintext - Data to encrypt
	 * @returns {string} Base64-encoded encrypted data
	 * @throws {Error} If encryption fails
	 */
	_encryptWithSafeStorage(plaintext) {
		try {
			if (!plaintext || typeof plaintext !== 'string') {
				throw new Error('Plaintext must be a non-empty string');
			}
			const buffer = Buffer.from(plaintext, 'utf8');
			const encrypted = safeStorage.encryptString(buffer.toString('utf8'));
			if (!encrypted) {
				throw new Error('safeStorage returned empty encrypted data');
			}
			return encrypted.toString('base64');
		} catch (error) {
			throw new Error(`safeStorage encryption failed: ${error.message}`);
		}
	}

	/**
	 * Decrypt data using Electron's safeStorage
	 *
	 * @private
	 * @param {string} encryptedData - Base64-encoded encrypted data
	 * @returns {string} Decrypted plaintext
	 * @throws {Error} If decryption fails
	 */
	_decryptWithSafeStorage(encryptedData) {
		try {
			if (!encryptedData || typeof encryptedData !== 'string') {
				throw new Error('Encrypted data must be a non-empty string');
			}
			const buffer = Buffer.from(encryptedData, 'base64');
			const decrypted = safeStorage.decryptString(buffer);
			if (!decrypted) {
				throw new Error('safeStorage returned empty decrypted data');
			}
			return decrypted;
		} catch (error) {
			throw new Error(`safeStorage decryption failed: ${error.message}`);
		}
	}

	/**
	 * Encrypt data using AES-256-GCM
	 *
	 * Uses the master key to encrypt data with a random IV and authentication tag.
	 *
	 * @private
	 * @param {string} plaintext - Data to encrypt
	 * @returns {string} JSON object with iv, ciphertext, authTag (all base64-encoded)
	 * @throws {Error} If encryption fails
	 */
	_encryptWithAES256GCM(plaintext) {
		try {
			if (!plaintext || typeof plaintext !== 'string') {
				throw new Error('Plaintext must be a non-empty string');
			}
			if (!this.masterKey) {
				throw new Error('Master key not initialized');
			}
			if (!Buffer.isBuffer(this.masterKey) || this.masterKey.length !== 32) {
				throw new Error('Master key is invalid (must be 32 bytes)');
			}

			// Generate random IV (16 bytes)
			const iv = crypto.randomBytes(16);

			// Create cipher
			const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

			// Encrypt
			let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
			ciphertext += cipher.final('hex');

			// Get authentication tag
			const authTag = cipher.getAuthTag();

			// Return encrypted data as JSON
			return JSON.stringify({
				iv: iv.toString('base64'),
				ciphertext,
				authTag: authTag.toString('base64')
			});
		} catch (error) {
			throw new Error(`AES-256-GCM encryption failed: ${error.message}`);
		}
	}

	/**
	 * Decrypt data using AES-256-GCM
	 *
	 * @private
	 * @param {string} encryptedData - JSON object with iv, ciphertext, authTag
	 * @returns {string} Decrypted plaintext
	 * @throws {Error} If decryption fails
	 */
	_decryptWithAES256GCM(encryptedData) {
		try {
			if (!encryptedData || typeof encryptedData !== 'string') {
				throw new Error('Encrypted data must be a non-empty string');
			}
			if (!this.masterKey) {
				throw new Error('Master key not initialized');
			}
			if (!Buffer.isBuffer(this.masterKey) || this.masterKey.length !== 32) {
				throw new Error('Master key is invalid (must be 32 bytes)');
			}

			const encrypted = JSON.parse(encryptedData);
			if (!encrypted.iv || !encrypted.ciphertext || !encrypted.authTag) {
				throw new Error('Encrypted data is missing required fields (iv, ciphertext, authTag)');
			}

			const iv = Buffer.from(encrypted.iv, 'base64');
			const authTag = Buffer.from(encrypted.authTag, 'base64');

			if (iv.length !== 16) {
				throw new Error('Invalid IV length (must be 16 bytes)');
			}
			if (authTag.length !== 16) {
				throw new Error('Invalid authentication tag length (must be 16 bytes)');
			}

			// Create decipher
			const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
			decipher.setAuthTag(authTag);

			// Decrypt
			let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
			plaintext += decipher.final('utf8');

			return plaintext;
		} catch (error) {
			throw new Error(`AES-256-GCM decryption failed: ${error.message}`);
		}
	}

	/**
	 * Validate secret key
	 *
	 * @private
	 * @param {string} key - Key to validate
	 * @throws {ValidationError} If key is invalid
	 */
	_validateKey(key) {
		if (typeof key !== 'string' || key.length === 0) {
			throw new ValidationError('Key must be a non-empty string');
		}
		if (key.length > this.options.maxKeyLength) {
			throw new ValidationError(
				`Key exceeds maximum length of ${this.options.maxKeyLength} characters`
			);
		}
	}

	/**
	 * Validate secret value
	 *
	 * @private
	 * @param {string} value - Value to validate
	 * @throws {ValidationError} If value is invalid
	 */
	_validateValue(value) {
		if (typeof value !== 'string') {
			throw new ValidationError('Value must be a string');
		}
		const valueSize = Buffer.byteLength(value, 'utf8');
		if (valueSize > this.options.maxValueSize) {
			throw new ValidationError(
				`Value exceeds maximum size of ${this.options.maxValueSize} bytes`
			);
		}
	}

	/**
	 * Register event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 * @throws {ValidationError} If event name is invalid or callback is not a function
	 */
	on(event, callback) {
		if (!event || typeof event !== 'string') {
			throw new ValidationError('Event name must be a non-empty string');
		}
		if (typeof callback !== 'function') {
			throw new ValidationError('Callback must be a function');
		}
		if (!this.listeners[event]) {
			throw new ValidationError(`Unknown event: ${event}`);
		}
		this.listeners[event].push(callback);
	}

	/**
	 * Unregister event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 * @throws {ValidationError} If event name is invalid or callback is not a function
	 */
	off(event, callback) {
		if (!event || typeof event !== 'string') {
			throw new ValidationError('Event name must be a non-empty string');
		}
		if (typeof callback !== 'function') {
			throw new ValidationError('Callback must be a function');
		}
		if (!this.listeners[event]) {
			throw new ValidationError(`Unknown event: ${event}`);
		}
		this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
	}

	/**
	 * Emit event to all listeners
	 *
	 * Safely emits events to all registered listeners, catching and logging
	 * any errors that occur in listener callbacks.
	 *
	 * @private
	 * @param {string} event - Event name
	 * @param {Object} data - Event data
	 */
	_emit(event, data) {
		if (!this.listeners[event]) {
			return;
		}

		this.listeners[event].forEach(callback => {
			try {
				callback(data);
			} catch (error) {
				console.error(`Error in event listener for ${event}:`, error);
			}
		});
	}

	/**
	 * Get current encryption backend
	 *
	 * @returns {string|null} 'safeStorage', 'aes256gcm', or null if not initialized
	 */
	getEncryptionBackend() {
		return this.encryptionBackend;
	}

	/**
	 * Check if vault is initialized
	 *
	 * @returns {boolean}
	 */
	isInitialized() {
		return this.initialized;
	}
}

module.exports = {
	SecretVault,
	SecretVaultError,
	SecretNotFoundError,
	DecryptionFailedError,
	TokenExpiredError,
	TokenRefreshFailedError,
	ValidationError
};

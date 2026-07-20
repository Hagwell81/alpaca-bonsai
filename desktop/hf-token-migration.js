/**
 * HuggingFace Token Migration Service
 *
 * Migrates HuggingFace API tokens from localStorage to Secret_Vault for secure encrypted storage.
 * This module handles:
 * - Detection of existing HF tokens in localStorage
 * - Encryption and storage in Secret_Vault
 * - Deletion from localStorage after successful migration
 * - Error handling and logging
 * - Fallback mechanisms for migration failures
 */

const crypto = require('crypto');

/**
 * Custom error classes for HF token migration
 */
class HFTokenMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HFTokenMigrationError';
  }
}

class TokenNotFoundError extends HFTokenMigrationError {
  constructor(message = 'HuggingFace token not found in localStorage') {
    super(message);
    this.name = 'TokenNotFoundError';
  }
}

class MigrationFailedError extends HFTokenMigrationError {
  constructor(reason) {
    super(`HuggingFace token migration failed: ${reason}`);
    this.name = 'MigrationFailedError';
  }
}

class ValidationError extends HFTokenMigrationError {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * HuggingFace Token Migration Service
 *
 * Manages migration of HF tokens from localStorage to Secret_Vault
 */
class HFTokenMigration {
  /**
   * Initialize the migration service
   *
   * @param {Object} store - electron-store instance
   * @param {SecretVault} secretVault - SecretVault instance for encrypted storage
   * @param {Object} options - Configuration options
   * @param {string} options.localStorageKey - Key used in localStorage (default: 'hf_token')
   * @param {string} options.vaultKey - Key used in Secret_Vault (default: 'hf_token')
   * @param {boolean} options.deleteAfterMigration - Delete from localStorage after migration (default: true)
   * @param {Function} options.logger - Logger function for debugging (default: console.log)
   */
  constructor(store, secretVault, options = {}) {
    if (!store) {
      throw new ValidationError('store is required');
    }
    if (!secretVault) {
      throw new ValidationError('secretVault is required');
    }

    this.store = store;
    this.secretVault = secretVault;
    this.localStorageKey = options.localStorageKey || 'hf_token';
    this.vaultKey = options.vaultKey || 'hf_token';
    this.deleteAfterMigration = options.deleteAfterMigration !== false;
    this.logger = options.logger || console.log;
    this.eventListeners = new Map();

    this.logger('[HFTokenMigration] Service initialized');
  }

  /**
   * Check if HuggingFace token exists in localStorage
   *
   * @returns {boolean} True if token exists in localStorage
   */
  hasTokenInLocalStorage() {
    try {
      const token = this.store.get(this.localStorageKey);
      return !!token && typeof token === 'string' && token.trim().length > 0;
    } catch (error) {
      this.logger(`[HFTokenMigration] Error checking localStorage: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if HuggingFace token already exists in Secret_Vault
   *
   * @returns {Promise<boolean>} True if token exists in Secret_Vault
   */
  async hasTokenInVault() {
    try {
      const token = await this.secretVault.getSecret(this.vaultKey);
      return !!token;
    } catch (error) {
      // Token not found is expected, not an error
      if (error.name === 'SecretNotFoundError') {
        return false;
      }
      this.logger(`[HFTokenMigration] Error checking vault: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if migration is needed
   *
   * @returns {Promise<boolean>} True if migration is needed
   */
  async isMigrationNeeded() {
    try {
      const hasInLocalStorage = this.hasTokenInLocalStorage();
      const hasInVault = await this.hasTokenInVault();

      const needed = hasInLocalStorage && !hasInVault;
      this.logger(`[HFTokenMigration] Migration needed: ${needed} (localStorage: ${hasInLocalStorage}, vault: ${hasInVault})`);
      return needed;
    } catch (error) {
      this.logger(`[HFTokenMigration] Error checking migration status: ${error.message}`);
      return false;
    }
  }

  /**
   * Get HuggingFace token from localStorage
   *
   * @returns {string|null} The token or null if not found
   */
  getTokenFromLocalStorage() {
    try {
      const token = this.store.get(this.localStorageKey);
      if (!token || typeof token !== 'string') {
        return null;
      }
      return token.trim();
    } catch (error) {
      this.logger(`[HFTokenMigration] Error reading token from localStorage: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate HuggingFace token format
   *
   * @param {string} token - Token to validate
   * @returns {boolean} True if token appears valid
   */
  _validateToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // HF tokens typically start with 'hf_' and are at least 20 characters
    // But we'll be lenient to support various token formats
    const trimmed = token.trim();
    return trimmed.length >= 10 && trimmed.length <= 1000;
  }

  /**
   * Perform the migration
   *
   * @returns {Promise<Object>} Migration result with status and details
   */
  async migrate() {
    try {
      this.logger('[HFTokenMigration] Starting migration...');

      // Check if migration is needed
      const needed = await this.isMigrationNeeded();
      if (!needed) {
        this.logger('[HFTokenMigration] Migration not needed');
        this._emit('migration-skipped', { reason: 'Token already in vault or not in localStorage' });
        return {
          success: true,
          skipped: true,
          reason: 'Token already in vault or not in localStorage'
        };
      }

      // Get token from localStorage
      const token = this.getTokenFromLocalStorage();
      if (!token) {
        throw new TokenNotFoundError('Failed to retrieve token from localStorage');
      }

      // Validate token
      if (!this._validateToken(token)) {
        throw new ValidationError('Token format is invalid');
      }

      this.logger('[HFTokenMigration] Token retrieved from localStorage, validating...');

      // Store in Secret_Vault
      try {
        await this.secretVault.setSecret(this.vaultKey, token, {
          metadata: {
            migratedAt: new Date().toISOString(),
            source: 'localStorage'
          }
        });
        this.logger('[HFTokenMigration] Token successfully stored in Secret_Vault');
      } catch (error) {
        throw new MigrationFailedError(`Failed to store token in Secret_Vault: ${error.message}`);
      }

      // Verify token was stored correctly
      try {
        const storedToken = await this.secretVault.getSecret(this.vaultKey);
        if (storedToken !== token) {
          throw new MigrationFailedError('Stored token does not match original token');
        }
        this.logger('[HFTokenMigration] Token verification successful');
      } catch (error) {
        throw new MigrationFailedError(`Failed to verify stored token: ${error.message}`);
      }

      // Delete from localStorage if configured
      if (this.deleteAfterMigration) {
        try {
          this.store.delete(this.localStorageKey);
          this.logger('[HFTokenMigration] Token deleted from localStorage');
        } catch (error) {
          this.logger(`[HFTokenMigration] Warning: Failed to delete token from localStorage: ${error.message}`);
          // Don't fail the migration if deletion fails, but log the warning
        }
      }

      this.logger('[HFTokenMigration] Migration completed successfully');
      this._emit('migration-complete', {
        success: true,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        skipped: false,
        timestamp: new Date().toISOString(),
        message: 'HuggingFace token successfully migrated to Secret_Vault'
      };
    } catch (error) {
      this.logger(`[HFTokenMigration] Migration failed: ${error.message}`);
      this._emit('migration-failed', {
        error: error.message,
        errorName: error.name
      });

      return {
        success: false,
        error: error.message,
        errorName: error.name,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Rollback migration (restore token to localStorage)
   *
   * @returns {Promise<Object>} Rollback result
   */
  async rollback() {
    try {
      this.logger('[HFTokenMigration] Starting rollback...');

      // Get token from vault
      let token;
      try {
        token = await this.secretVault.getSecret(this.vaultKey);
      } catch (error) {
        throw new MigrationFailedError(`Failed to retrieve token from vault: ${error.message}`);
      }

      if (!token) {
        throw new TokenNotFoundError('Token not found in vault for rollback');
      }

      // Restore to localStorage
      try {
        this.store.set(this.localStorageKey, token);
        this.logger('[HFTokenMigration] Token restored to localStorage');
      } catch (error) {
        throw new MigrationFailedError(`Failed to restore token to localStorage: ${error.message}`);
      }

      this.logger('[HFTokenMigration] Rollback completed successfully');
      this._emit('rollback-complete', {
        success: true,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        timestamp: new Date().toISOString(),
        message: 'Rollback completed successfully'
      };
    } catch (error) {
      this.logger(`[HFTokenMigration] Rollback failed: ${error.message}`);
      this._emit('rollback-failed', {
        error: error.message,
        errorName: error.name
      });

      return {
        success: false,
        error: error.message,
        errorName: error.name,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get migration status
   *
   * @returns {Promise<Object>} Current migration status
   */
  async getMigrationStatus() {
    try {
      const hasInLocalStorage = this.hasTokenInLocalStorage();
      const hasInVault = await this.hasTokenInVault();
      const migrationNeeded = await this.isMigrationNeeded();

      return {
        hasInLocalStorage,
        hasInVault,
        migrationNeeded,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger(`[HFTokenMigration] Error getting migration status: ${error.message}`);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Register event listener
   *
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Unregister event listener
   *
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  off(event, callback) {
    if (!this.eventListeners.has(event)) {
      return;
    }
    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Emit event to listeners
   *
   * @private
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  _emit(event, data) {
    if (!this.eventListeners.has(event)) {
      return;
    }
    const listeners = this.eventListeners.get(event);
    listeners.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        this.logger(`[HFTokenMigration] Error in event listener for ${event}: ${error.message}`);
      }
    });
  }
}

module.exports = {
  HFTokenMigration,
  HFTokenMigrationError,
  TokenNotFoundError,
  MigrationFailedError,
  ValidationError
};

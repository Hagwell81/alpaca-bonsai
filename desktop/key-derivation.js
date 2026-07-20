/**
 * KeyDerivation - Machine-bound key derivation service
 *
 * Derives deterministic encryption keys from platform-specific identity sources
 * to prevent cross-machine secret leakage.
 *
 * Features:
 * - Platform-specific identity collection (Windows, macOS, Linux)
 * - PBKDF2 key derivation with 100,000 iterations
 * - SHA-256 checksum computation for cross-machine detection
 * - Fallback to user-provided passphrase or random key generation
 * - Timeout handling for slow identity collection
 */

const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Custom error classes for KeyDerivation operations
 */
class KeyDerivationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'KeyDerivationError';
	}
}

class PlatformIdentityError extends KeyDerivationError {
	constructor(platform, message) {
		super(`Failed to collect ${platform} identity: ${message}`);
		this.name = 'PlatformIdentityError';
	}
}

class ChecksumMismatchError extends KeyDerivationError {
	constructor(message = 'Master key checksum does not match') {
		super(message);
		this.name = 'ChecksumMismatchError';
	}
}

/**
 * KeyDerivation - Core key derivation service class
 *
 * Manages machine-bound key derivation with support for:
 * - Platform-specific identity collection
 * - PBKDF2 key derivation
 * - Checksum verification for cross-machine detection
 * - Fallback mechanisms for identity collection failures
 */
class KeyDerivation {
	/**
	 * Create a new KeyDerivation instance
	 *
	 * @param {Object} options - Configuration options
	 * @param {number} options.pbkdf2Iterations - PBKDF2 iterations (default: 100000)
	 * @param {number} options.identityTimeoutMs - Timeout for identity collection (default: 5000)
	 * @param {string} options.platform - Override platform detection (default: auto-detect)
	 */
	constructor(options = {}) {
		this.options = {
			pbkdf2Iterations: options.pbkdf2Iterations || 100000,
			identityTimeoutMs: options.identityTimeoutMs || 2000,
			platform: options.platform || process.platform,
			cachePath: options.cachePath || null,
			...options
		};

		// Cached identity and key
		this.platformIdentity = null;
		this.masterKey = null;
		this.masterKeyChecksum = null;
		this.initialized = false;
	}

	/**
	 * Derive master key from platform-specific identity
	 *
	 * Collects platform identity (GUID, Serial, Machine ID) and derives
	 * a 256-bit key using PBKDF2 with SHA-256 and 100,000 iterations.
	 *
	 * @returns {Promise<Buffer>} 32-byte master key
	 * @throws {KeyDerivationError} If key derivation fails
	 */
	async deriveMasterKey() {
		if (this.masterKey) {
			return this.masterKey;
		}

		try {
			// Try cached identity first to avoid slow shell probes on re-launch
			let identity = this._loadCachedIdentity();
			if (!identity) {
				identity = await this._collectPlatformIdentity();
				this._saveCachedIdentity(identity);
			}
			this.platformIdentity = identity;

			// Derive key using PBKDF2
			const salt = Buffer.from(identity.salt, 'utf8');
			const password = Buffer.from(identity.password, 'utf8');

			this.masterKey = crypto.pbkdf2Sync(
				password,
				salt,
				this.options.pbkdf2Iterations,
				32, // 256 bits
				'sha256'
			);

			// Compute checksum
			this.masterKeyChecksum = crypto
				.createHash('sha256')
				.update(this.masterKey)
				.digest('hex');

			this.initialized = true;
			return this.masterKey;
		} catch (error) {
			if (error instanceof KeyDerivationError) {
				throw error;
			}
			throw new KeyDerivationError(`Failed to derive master key: ${error.message}`);
		}
	}

	/**
	 * Get checksum of master key
	 *
	 * Returns the SHA-256 checksum of the master key. Used for
	 * cross-machine copy detection.
	 *
	 * @returns {Promise<string>} Hex-encoded SHA-256 checksum
	 * @throws {KeyDerivationError} If key not yet derived
	 */
	async getMasterKeyChecksum() {
		if (!this.masterKeyChecksum) {
			// Derive key if not already done
			await this.deriveMasterKey();
		}
		return this.masterKeyChecksum;
	}

	/**
	 * Verify checksum matches current key
	 *
	 * Performs constant-time comparison of stored checksum against
	 * newly derived key's checksum to detect cross-machine copies.
	 *
	 * @param {string} storedChecksum - Previously stored checksum
	 * @returns {Promise<boolean>} True if checksums match, false otherwise
	 * @throws {KeyDerivationError} If verification fails
	 */
	async verifyChecksum(storedChecksum) {
		if (!storedChecksum || typeof storedChecksum !== 'string') {
			throw new KeyDerivationError('Stored checksum must be a non-empty string');
		}

		try {
			// Derive current key if not already done
			if (!this.masterKeyChecksum) {
				await this.deriveMasterKey();
			}

			// Perform constant-time comparison to prevent timing attacks
			const storedBuffer = Buffer.from(storedChecksum, 'hex');
			const currentBuffer = Buffer.from(this.masterKeyChecksum, 'hex');

			// Use crypto.timingSafeEqual for constant-time comparison
			try {
				return crypto.timingSafeEqual(storedBuffer, currentBuffer);
			} catch (error) {
				// Buffers have different lengths - checksums don't match
				return false;
			}
		} catch (error) {
			if (error instanceof KeyDerivationError) {
				throw error;
			}
			throw new KeyDerivationError(`Failed to verify checksum: ${error.message}`);
		}
	}

	/**
	 * Get platform identity info (for debugging)
	 *
	 * Returns information about the collected platform identity.
	 * Does not include sensitive data.
	 *
	 * @returns {Promise<Object>} Platform identity info
	 * @throws {KeyDerivationError} If identity not yet collected
	 */
	async getPlatformIdentity() {
		if (!this.platformIdentity) {
			await this.deriveMasterKey();
		}

		return {
			platform: this.options.platform,
			saltLength: this.platformIdentity.salt.length,
			passwordLength: this.platformIdentity.password.length,
			// Don't expose actual salt or password
		};
	}

	/**
	 * Load cached platform identity from disk to avoid repeated slow shell probes.
	 *
	 * @private
	 * @returns {Object|null} Cached identity or null
	 */
	_loadCachedIdentity() {
		if (!this.options.cachePath) return null;
		try {
			if (fs.existsSync(this.options.cachePath)) {
				const data = JSON.parse(fs.readFileSync(this.options.cachePath, 'utf8'));
				if (data && data.salt && data.password) {
					return { salt: data.salt, password: data.password };
				}
			}
		} catch (_) {
			// Cache corrupted or missing; ignore and re-collect
		}
		return null;
	}

	/**
	 * Save platform identity to disk for fast re-launch.
	 *
	 * @private
	 * @param {Object} identity - { salt, password }
	 */
	_saveCachedIdentity(identity) {
		if (!this.options.cachePath) return;
		try {
			const dir = path.dirname(this.options.cachePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(this.options.cachePath, JSON.stringify(identity), 'utf8');
		} catch (err) {
			// Non-fatal: caching is an optimisation
			console.warn('[KeyDerivation] Failed to cache identity:', err.message);
		}
	}

	/**
	 * Collect platform-specific identity
	 *
	 * Gathers machine and user identity from platform-specific sources:
	 * - Windows: Machine GUID + User SID
	 * - macOS: Hardware Serial Number
	 * - Linux: Machine ID + User UID
	 *
	 * @private
	 * @returns {Promise<Object>} Object with { salt, password }
	 * @throws {PlatformIdentityError} If identity collection fails
	 */
	async _collectPlatformIdentity() {
		const platform = this.options.platform;

		try {
			switch (platform) {
				case 'win32':
					return await this._collectWindowsIdentity();
				case 'darwin':
					return await this._collectMacOSIdentity();
				case 'linux':
					return await this._collectLinuxIdentity();
				default:
					throw new PlatformIdentityError(
						platform,
						`Unsupported platform: ${platform}`
					);
			}
		} catch (error) {
			if (error instanceof PlatformIdentityError) {
				throw error;
			}
			throw new PlatformIdentityError(platform, error.message);
		}
	}

	/**
	 * Collect Windows identity (Machine GUID + User SID)
	 *
	 * Uses WMI to get machine GUID and whoami to get user SID.
	 * Falls back to alternative methods if wmic is not available.
	 *
	 * @private
	 * @returns {Promise<Object>} Object with { salt, password }
	 * @throws {PlatformIdentityError} If collection fails
	 */
	async _collectWindowsIdentity() {
		try {
			// Get machine GUID: try PowerShell first (fastest on modern Windows),
			// then registry (no shell overhead), then wmic as last resort.
			let machineGuid;
			let lastError;

			// 1. PowerShell (modern, fast)
			try {
				machineGuid = this._executeWithTimeout(
					'powershell -Command "Get-CimInstance Win32_ComputerSystemProduct -Property UUID | Select-Object -ExpandProperty UUID"',
					this.options.identityTimeoutMs
				)
					.toString()
					.trim();
				if (!machineGuid) throw new Error('empty');
			} catch (err) {
				lastError = err;
			}

			// 2. Registry (no shell spawn overhead)
			if (!machineGuid) {
				try {
					machineGuid = this._executeWithTimeout(
						'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid /reg:64',
						this.options.identityTimeoutMs
					)
						.toString()
						.split('\n')
						.find(line => line.includes('MachineGuid'))
						?.split(/\s+/)
						.pop()
						?.trim();
					if (!machineGuid) throw new Error('empty');
				} catch (err) {
					lastError = err;
				}
			}

			// 3. wmic (deprecated on Win11, slowest)
			if (!machineGuid) {
				try {
					machineGuid = this._executeWithTimeout(
						'wmic csproduct get UUID',
						this.options.identityTimeoutMs
					)
						.toString()
						.split('\n')
						.find(line => line.trim() && line.trim() !== 'UUID')
						?.trim();
					if (!machineGuid) throw new Error('empty');
				} catch (err) {
					throw new Error(
						`Failed to get machine GUID via all methods: PowerShell, registry, wmic (${err.message})`
					);
				}
			}

			// Get user SID using whoami
			let userSid;
			try {
				userSid = this._executeWithTimeout(
					'whoami /user /fo csv /nh',
					this.options.identityTimeoutMs
				)
					.toString()
					.split(',')[1]
					?.replace(/"/g, '')
					?.trim();

				if (!userSid) {
					throw new Error('Failed to parse user SID from whoami output');
				}
			} catch (error) {
				throw new Error(`Failed to get user SID: ${error.message}`);
			}

			return {
				salt: `${machineGuid}:${userSid}`,
				password: 'alpaca-key-derivation'
			};
		} catch (error) {
			throw new PlatformIdentityError('Windows', error.message);
		}
	}

	/**
	 * Collect macOS identity (Hardware Serial Number)
	 *
	 * Uses system_profiler to get hardware serial number.
	 *
	 * @private
	 * @returns {Promise<Object>} Object with { salt, password }
	 * @throws {PlatformIdentityError} If collection fails
	 */
	async _collectMacOSIdentity() {
		try {
			// Get hardware serial number using system_profiler
			let serialNumber;
			try {
				const output = this._executeWithTimeout(
					'system_profiler SPHardwareDataType',
					this.options.identityTimeoutMs
				).toString();

				// Parse serial number from output
				const match = output.match(/Serial Number \(system\):\s*(.+)/);
				serialNumber = match ? match[1].trim() : null;

				if (!serialNumber) {
					throw new Error('Failed to parse serial number from system_profiler output');
				}
			} catch (error) {
				throw new Error(`Failed to get hardware serial number: ${error.message}`);
			}

			// Get user UID as additional identity component
			let userUid;
			try {
				userUid = this._executeWithTimeout(
					'id -u',
					this.options.identityTimeoutMs
				)
					.toString()
					.trim();

				if (!userUid) {
					throw new Error('Failed to parse user UID from id output');
				}
			} catch (error) {
				// User UID is optional, continue without it
				userUid = '';
			}

			return {
				salt: userUid ? `${serialNumber}:${userUid}` : serialNumber,
				password: 'alpaca-key-derivation'
			};
		} catch (error) {
			throw new PlatformIdentityError('macOS', error.message);
		}
	}

	/**
	 * Collect Linux identity (Machine ID + User UID)
	 *
	 * Reads /etc/machine-id and uses id -u to get user UID.
	 *
	 * @private
	 * @returns {Promise<Object>} Object with { salt, password }
	 * @throws {PlatformIdentityError} If collection fails
	 */
	async _collectLinuxIdentity() {
		try {
			// Read machine ID from /etc/machine-id
			let machineId;
			try {
				const machineIdPath = '/etc/machine-id';
				if (!fs.existsSync(machineIdPath)) {
					throw new Error(`${machineIdPath} does not exist`);
				}
				machineId = fs.readFileSync(machineIdPath, 'utf8').trim();

				if (!machineId) {
					throw new Error('Machine ID is empty');
				}
			} catch (error) {
				throw new Error(`Failed to read machine ID: ${error.message}`);
			}

			// Get user UID using id -u
			let userUid;
			try {
				userUid = this._executeWithTimeout(
					'id -u',
					this.options.identityTimeoutMs
				)
					.toString()
					.trim();

				if (!userUid) {
					throw new Error('Failed to parse user UID from id output');
				}
			} catch (error) {
				throw new Error(`Failed to get user UID: ${error.message}`);
			}

			return {
				salt: `${machineId}:${userUid}`,
				password: 'alpaca-key-derivation'
			};
		} catch (error) {
			throw new PlatformIdentityError('Linux', error.message);
		}
	}

	/**
	 * Execute command with timeout
	 *
	 * Executes a shell command with a timeout to prevent hanging
	 * on slow or unresponsive system calls.
	 *
	 * @private
	 * @param {string} command - Command to execute
	 * @param {number} timeoutMs - Timeout in milliseconds
	 * @returns {Buffer} Command output
	 * @throws {Error} If command fails or times out
	 */
	_executeWithTimeout(command, timeoutMs) {
		try {
			// execSync doesn't support timeout directly, but we can use a wrapper
			// For now, use execSync with a reasonable timeout via shell
			const result = execSync(command, {
				encoding: 'utf8',
				timeout: timeoutMs,
				stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderr
			});
			return result;
		} catch (error) {
			if (error.killed) {
				throw new Error(`Command timed out after ${timeoutMs}ms`);
			}
			throw error;
		}
	}

	/**
	 * Check if key derivation is initialized
	 *
	 * @returns {boolean}
	 */
	isInitialized() {
		return this.initialized;
	}

	/**
	 * Reset cached key and identity
	 *
	 * Clears cached master key and platform identity. Useful for testing
	 * or forcing re-derivation.
	 *
	 * @returns {void}
	 */
	reset() {
		this.platformIdentity = null;
		this.masterKey = null;
		this.masterKeyChecksum = null;
		this.initialized = false;
	}
}

module.exports = {
	KeyDerivation,
	KeyDerivationError,
	PlatformIdentityError,
	ChecksumMismatchError
};

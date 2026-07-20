/* eslint-env node */
/**
 * HuggingFace Model Service Module
 *
 * Provides centralized module for all HuggingFace API interactions including:
 * - Repository metadata fetching
 * - Model file categorization
 * - Download with resume support
 * - SHA-256 verification
 * - Vision model pairing detection
 * - Bearer token authentication from Secret_Vault
 * - Token expiration and refresh handling
 *
 * @module hf-model-service
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * Custom error class for token-related errors
 */
class TokenError extends Error {
	constructor(message) {
		super(message);
		this.name = 'TokenError';
	}
}

/**
 * Custom error classes for HuggingFace operations
 */
class HFModelServiceError extends Error {
	constructor(message) {
		super(message);
		this.name = 'HFModelServiceError';
	}
}

class UnauthorizedError extends HFModelServiceError {
	constructor(message = 'Unauthorized - token required or invalid') {
		super(message);
		this.name = 'UnauthorizedError';
		this.statusCode = 401;
	}
}

class NotFoundError extends HFModelServiceError {
	constructor(repoId) {
		super(`Repository not found: ${repoId}`);
		this.name = 'NotFoundError';
		this.statusCode = 404;
		this.repoId = repoId;
	}
}

class RateLimitError extends HFModelServiceError {
	constructor(retryAfter = null) {
		super('Rate limited - too many requests');
		this.name = 'RateLimitError';
		this.statusCode = 429;
		this.retryAfter = retryAfter;
	}
}

class SHA256MismatchError extends HFModelServiceError {
	constructor(filename, expectedHash, actualHash) {
		super(`SHA-256 verification failed for ${filename}`);
		this.name = 'SHA256MismatchError';
		this.filename = filename;
		this.expectedHash = expectedHash;
		this.actualHash = actualHash;
	}
}

class DownloadError extends HFModelServiceError {
	constructor(message, statusCode = null) {
		super(message);
		this.name = 'DownloadError';
		this.statusCode = statusCode;
	}
}

/**
 * HuggingFace Model Service
 *
 * Centralized service for all HuggingFace API interactions with Secret_Vault integration.
 */
class HuggingFaceModelService extends EventEmitter {
	/**
	 * Creates a new HuggingFaceModelService instance.
	 *
	 * @param {string|null} token - Optional HuggingFace API token
	 * @param {Object} options - Configuration options
	 * @param {string} options.baseUrl - HuggingFace API base URL
	 * @param {number} options.timeout - Request timeout in milliseconds
	 * @param {Object} options.logger - Logger instance (optional)
	 * @param {Object} options.secretVault - SecretVault instance for token management (optional)
	 * @param {string} options.tokenKey - Secret key for HF token in vault (default: 'hf_token')
	 * @param {number} options.maxRetries - Maximum retries for rate-limited requests (default: 3)
	 * @param {number} options.initialBackoffMs - Initial backoff in milliseconds (default: 1000)
	 * @param {number} options.maxBackoffMs - Maximum backoff in milliseconds (default: 60000)
	 */
	constructor(token = null, options = {}) {
		super();

		this.token = token;
		this.baseUrl = options.baseUrl || 'https://huggingface.co/api';
		this.timeout = options.timeout || 30000;
		this.logger = options.logger || this._createDefaultLogger();
		this.secretVault = options.secretVault || null;
		this.tokenKey = options.tokenKey || 'hf_token';

		// Retry configuration for rate limiting
		this.maxRetries = options.maxRetries || 3;
		this.initialBackoffMs = options.initialBackoffMs || 1000;
		this.maxBackoffMs = options.maxBackoffMs || 60000;

		// Track active downloads
		this.activeDownloads = new Map();

		// Token refresh state
		this.tokenRefreshInProgress = false;
		this.lastTokenRefreshTime = null;

		// Validation
		if (token && typeof token !== 'string') {
			throw new Error('Token must be a string or null');
		}

		this.logger.debug('HuggingFaceModelService initialized', {
			hasToken: !!token,
			hasSecretVault: !!this.secretVault,
			baseUrl: this.baseUrl,
			timeout: this.timeout,
			tokenKey: this.tokenKey,
			maxRetries: this.maxRetries,
			initialBackoffMs: this.initialBackoffMs,
			maxBackoffMs: this.maxBackoffMs
		});
	}

	/**
	 * Creates a default logger if none provided.
	 *
	 * @returns {Object} Logger instance
	 * @private
	 */
	_createDefaultLogger() {
		return {
			debug: (msg, data) => console.debug(`[HF] ${msg}`, data || ''),
			info: (msg, data) => console.info(`[HF] ${msg}`, data || ''),
			warn: (msg, data) => console.warn(`[HF] ${msg}`, data || ''),
			error: (msg, data) => console.error(`[HF] ${msg}`, data || '')
		};
	}

	/**
	 * Calculates exponential backoff delay with jitter.
	 *
	 * @param {number} retryCount - Current retry attempt (0-based)
	 * @param {number} retryAfter - Optional Retry-After header value in seconds
	 * @returns {number} Delay in milliseconds
	 * @private
	 */
	_calculateBackoffDelay(retryCount, retryAfter = null) {
		// If server provided Retry-After header, use it
		if (retryAfter) {
			const retryAfterMs = parseInt(retryAfter, 10) * 1000;
			if (!isNaN(retryAfterMs)) {
				return Math.min(retryAfterMs, this.maxBackoffMs);
			}
		}

		// Exponential backoff with jitter: base * 2^retryCount + random jitter
		const exponentialDelay = this.initialBackoffMs * Math.pow(2, retryCount);
		const jitter = Math.random() * exponentialDelay * 0.1; // 10% jitter
		const delay = exponentialDelay + jitter;

		return Math.min(delay, this.maxBackoffMs);
	}

	/**
	 * Waits for a specified duration.
	 *
	 * @param {number} ms - Duration in milliseconds
	 * @returns {Promise<void>}
	 * @private
	 */
	_sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Initializes the service by loading credentials and warming caches.
	 *
	 * @returns {Promise<void>}
	 */
	async initialize() {
		this.logger.debug('HuggingFaceModelService.initialize() called');
		
		// If Secret_Vault is available, try to load token from vault
		if (this.secretVault) {
			try {
				await this._loadTokenFromVault();
			} catch (error) {
				this.logger.warn('Failed to load token from vault during initialization', {
					error: error.message
				});
				// Don't fail initialization - token can be set later
			}
		}
	}

	/**
	 * Loads HuggingFace token from Secret_Vault.
	 *
	 * Retrieves the token from the vault and sets it on the service.
	 * Handles token expiration and emits appropriate events.
	 *
	 * @returns {Promise<string|null>} Token value or null if not found
	 * @throws {TokenError} If token retrieval fails
	 * @private
	 */
	async _loadTokenFromVault() {
		if (!this.secretVault) {
			throw new TokenError('Secret_Vault not configured');
		}

		try {
			this.logger.debug('Loading HF token from Secret_Vault', { tokenKey: this.tokenKey });

			const token = await this.secretVault.getSecret(this.tokenKey);
			
			if (token) {
				this.token = token;
				this.logger.debug('HF token loaded from Secret_Vault successfully');
				this.emit('token-loaded', { source: 'vault' });
				return token;
			} else {
				this.logger.debug('No HF token found in Secret_Vault');
				return null;
			}
		} catch (error) {
			// Handle specific Secret_Vault errors
			if (error.name === 'TokenExpiredError') {
				this.logger.warn('HF token has expired', { tokenKey: this.tokenKey });
				this.emit('token-expired', { tokenKey: this.tokenKey });
				throw new TokenError(`Token expired: ${error.message}`);
			} else if (error.name === 'SecretNotFoundError') {
				this.logger.debug('HF token not found in vault');
				return null;
			} else if (error.name === 'DecryptionFailedError') {
				this.logger.error('Failed to decrypt HF token from vault', {
					error: error.message
				});
				throw new TokenError(`Decryption failed: ${error.message}`);
			} else {
				this.logger.error('Failed to load HF token from vault', {
					error: error.message,
					errorName: error.name
				});
				throw new TokenError(`Failed to load token: ${error.message}`);
			}
		}
	}

	/**
	 * Retrieves HuggingFace token, loading from vault if necessary.
	 *
	 * Attempts to use the current token, or loads from vault if not set.
	 * Handles token expiration and refresh.
	 *
	 * @returns {Promise<string|null>} Token value or null if not available
	 * @throws {TokenError} If token retrieval fails
	 */
	async getTokenForRequest() {
		// If token is already set, return it
		if (this.token) {
			return this.token;
		}

		// Try to load from vault
		if (this.secretVault) {
			try {
				return await this._loadTokenFromVault();
			} catch (error) {
				this.logger.warn('Failed to load token from vault for request', {
					error: error.message
				});
				// Return null to allow unauthenticated requests
				return null;
			}
		}

		return null;
	}

	/**
	 * Stores HuggingFace token in Secret_Vault.
	 *
	 * Encrypts and stores the token with optional expiration metadata.
	 *
	 * @param {string} token - Token to store
	 * @param {Object} options - Storage options
	 * @param {string} options.expiresAt - ISO 8601 expiration timestamp (optional)
	 * @returns {Promise<void>}
	 * @throws {TokenError} If token storage fails
	 */
	async storeTokenInVault(token, options = {}) {
		if (!this.secretVault) {
			throw new TokenError('Secret_Vault not configured');
		}

		if (!token || typeof token !== 'string') {
			throw new TokenError('Token must be a non-empty string');
		}

		try {
			this.logger.debug('Storing HF token in Secret_Vault', {
				tokenKey: this.tokenKey,
				hasExpiration: !!options.expiresAt
			});

			await this.secretVault.setSecret(this.tokenKey, token, {
				scope: 'huggingface',
				...options
			});

			// Update local token
			this.token = token;

			this.logger.debug('HF token stored in Secret_Vault successfully');
			this.emit('token-stored', { tokenKey: this.tokenKey });
		} catch (error) {
			this.logger.error('Failed to store HF token in vault', {
				error: error.message
			});
			throw new TokenError(`Failed to store token: ${error.message}`);
		}
	}

	/**
	 * Refreshes HuggingFace token if expiring.
	 *
	 * Calls the provided refresh function to get a new token and stores it.
	 * Prevents concurrent refresh attempts.
	 *
	 * @param {Function} refreshFn - Async function that returns { token, expiresAt }
	 * @returns {Promise<string>} New token value
	 * @throws {TokenError} If refresh fails
	 */
	async refreshToken(refreshFn) {
		if (!this.secretVault) {
			throw new TokenError('Secret_Vault not configured');
		}

		if (typeof refreshFn !== 'function') {
			throw new TokenError('refreshFn must be a function');
		}

		// Prevent concurrent refresh attempts
		if (this.tokenRefreshInProgress) {
			this.logger.debug('Token refresh already in progress, waiting...');
			// Wait for existing refresh to complete
			const maxWaitTime = 30000; // 30 seconds
			const startTime = Date.now();
			while (this.tokenRefreshInProgress && Date.now() - startTime < maxWaitTime) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			return this.token;
		}

		this.tokenRefreshInProgress = true;

		try {
			this.logger.debug('Refreshing HF token', { tokenKey: this.tokenKey });

			// Call refresh function
			const result = await refreshFn(this.tokenKey, this.token);
			if (!result || !result.token) {
				throw new Error('Refresh function did not return token');
			}

			// Store new token in vault
			await this.storeTokenInVault(result.token, {
				expiresAt: result.expiresAt
			});

			this.lastTokenRefreshTime = new Date();
			this.logger.debug('HF token refreshed successfully');
			this.emit('token-refreshed', {
				tokenKey: this.tokenKey,
				expiresAt: result.expiresAt
			});

			return result.token;
		} catch (error) {
			this.logger.error('Failed to refresh HF token', {
				error: error.message
			});
			this.emit('token-refresh-failed', {
				tokenKey: this.tokenKey,
				error: error.message
			});
			throw new TokenError(`Failed to refresh token: ${error.message}`);
		} finally {
			this.tokenRefreshInProgress = false;
		}
	}

	/**
	 * Clears the stored HuggingFace token.
	 *
	 * Removes token from both memory and vault.
	 *
	 * @returns {Promise<void>}
	 * @throws {TokenError} If token deletion fails
	 */
	async clearToken() {
		try {
			this.logger.debug('Clearing HF token', { tokenKey: this.tokenKey });

			// Clear from vault if available
			if (this.secretVault) {
				await this.secretVault.deleteSecret(this.tokenKey);
			}

			// Clear from memory
			this.token = null;

			this.logger.debug('HF token cleared successfully');
			this.emit('token-cleared', { tokenKey: this.tokenKey });
		} catch (error) {
			this.logger.error('Failed to clear HF token', {
				error: error.message
			});
			throw new TokenError(`Failed to clear token: ${error.message}`);
		}
	}

	/**
	 * Gets token metadata from vault (expiration, scope, etc.).
	 *
	 * @returns {Promise<Object|null>} Token metadata or null if not found
	 * @throws {TokenError} If metadata retrieval fails
	 */
	async getTokenMetadata() {
		if (!this.secretVault) {
			return null;
		}

		try {
			this.logger.debug('Retrieving HF token metadata', { tokenKey: this.tokenKey });
			const metadata = await this.secretVault.getSecretMetadata(this.tokenKey);
			return metadata;
		} catch (error) {
			this.logger.warn('Failed to retrieve token metadata', {
				error: error.message
			});
			return null;
		}
	}

	/**
	 * Fetches repository metadata from HuggingFace API.
	 *
	 * @param {string} repoId - Repository ID (e.g., "meta-llama/Llama-2-7b")
	 * @returns {Promise<Object>} Repository metadata including siblings
	 * @throws {UnauthorizedError} If repository is gated and no token provided
	 * @throws {NotFoundError} If repository does not exist
	 * @throws {RateLimitError} If rate limited
	 * @throws {HFModelServiceError} For other API errors
	 */
	async fetchRepoMetadata(repoId) {
		if (!repoId || typeof repoId !== 'string') {
			throw new Error('repoId must be a non-empty string');
		}

		this.logger.debug('Fetching repository metadata', { repoId });

		const url = `${this.baseUrl}/models/${repoId}?blobs=true&files_metadata=true`;

		try {
			const response = await this._makeRequest('GET', url);
			this.logger.debug('Repository metadata fetched successfully', { repoId });
			return response;
		} catch (error) {
			this.logger.error('Failed to fetch repository metadata', {
				repoId,
				error: error.message
			});
			throw error;
		}
	}

	/**
	 * Parses repository siblings into categories.
	 *
	 * @param {Array} siblings - Array of file objects from repository metadata
	 * @returns {Object} Categorized files: { regularGguf, mmproj, safetensors }
	 */
	parseRepoSiblings(siblings) {
		if (!Array.isArray(siblings)) {
			throw new Error('siblings must be an array');
		}

		this.logger.debug('Parsing repository siblings', { count: siblings.length });

		const result = {
			regularGguf: [],
			mmproj: [],
			safetensors: []
		};

		for (const file of siblings) {
			// HuggingFace API returns `rfilename` in siblings; fall back to `filename` for compatibility
			const filename = file.rfilename || file.filename || '';
			const lowerFilename = filename.toLowerCase();

			if (lowerFilename.endsWith('.gguf')) {
				if (lowerFilename.includes('mmproj')) {
					result.mmproj.push({ ...file, filename });
				} else {
					result.regularGguf.push({ ...file, filename });
				}
			} else if (lowerFilename.endsWith('.safetensors')) {
				result.safetensors.push({ ...file, filename });
			}
		}

		this.logger.debug('Repository siblings parsed', {
			regularGguf: result.regularGguf.length,
			mmproj: result.mmproj.length,
			safetensors: result.safetensors.length
		});

		return result;
	}

	/**
	 * Downloads a file from HuggingFace with resume support.
	 *
	 * @param {string} repoId - Repository ID
	 * @param {string} filename - File name to download
	 * @param {string} targetPath - Local path to save file
	 * @param {Object} options - Download options
	 * @param {string} options.sha256 - Expected SHA-256 hash
	 * @param {number} options.size - Expected file size
	 * @param {Function} options.onProgress - Progress callback: (bytesDownloaded, totalBytes, percentComplete)
	 * @returns {Promise<Object>} Download result: { filePath, size, sha256 }
	 * @throws {DownloadError} If download fails
	 * @throws {SHA256MismatchError} If hash verification fails
	 */
	async downloadWithResume(repoId, filename, targetPath, options = {}) {
		if (!repoId || !filename || !targetPath) {
			throw new Error('repoId, filename, and targetPath are required');
		}

		const downloadId = `${repoId}/${filename}`;
		this.logger.debug('Starting download', { repoId, filename, targetPath });

		// Check if already downloading
		if (this.activeDownloads.has(downloadId)) {
			throw new Error(`Download already in progress: ${downloadId}`);
		}

		const downloadUrl = `https://huggingface.co/${repoId}/resolve/main/${filename}`;
		const { sha256: expectedHash, size: expectedSize, onProgress } = options;

		try {
			// Register active download
			const downloadState = {
				startTime: Date.now(),
				bytesDownloaded: 0,
				totalBytes: expectedSize || 0,
				cancelled: false
			};
			this.activeDownloads.set(downloadId, downloadState);

			// Check for partial file
			let startByte = 0;
			if (fs.existsSync(targetPath)) {
				const stats = fs.statSync(targetPath);
				startByte = stats.size;
				this.logger.debug('Partial file found, attempting resume', {
					filename,
					existingSize: startByte
				});
			}

			// Perform download
			const result = await this._performDownload(
				downloadUrl,
				targetPath,
				startByte,
				expectedSize,
				downloadState,
				onProgress
			);

			// Verify hash if provided
			if (expectedHash) {
				this.logger.debug('Verifying download hash', { filename });
				const verification = await this.verifyDownloadHash(targetPath, expectedHash);
				if (!verification.verified) {
					fs.unlinkSync(targetPath);
					throw new SHA256MismatchError(
						filename,
						expectedHash,
						verification.computedHash
					);
				}
				this.logger.debug('Download hash verified', { filename });
			}

			// Emit completion event
			const finalStats = fs.statSync(targetPath);
			this.emit('download-complete', {
				filename,
				filePath: targetPath,
				size: finalStats.size,
				sha256: expectedHash
			});

			return {
				filePath: targetPath,
				size: finalStats.size,
				sha256: expectedHash
			};
		} catch (error) {
			this.logger.error('Download failed', {
				filename,
				error: error.message
			});

			// Clean up partial file on error
			if (fs.existsSync(targetPath)) {
				try {
					fs.unlinkSync(targetPath);
				} catch (cleanupError) {
					this.logger.warn('Failed to clean up partial file', {
						filename,
						error: cleanupError.message
					});
				}
			}

			this.emit('download-failed', {
				filename,
				error: error.message,
				statusCode: error.statusCode
			});

			throw error;
		} finally {
			// Unregister download
			this.activeDownloads.delete(downloadId);
		}
	}

	/**
	 * Performs the actual HTTP download with resume support and retry logic for rate limiting.
	 *
	 * Automatically injects Bearer token from vault if available.
	 * Implements exponential backoff retry for 429 (Too Many Requests) responses.
	 *
	 * @param {string} url - Download URL
	 * @param {string} targetPath - Local file path
	 * @param {number} startByte - Starting byte for resume
	 * @param {number} totalBytes - Total file size
	 * @param {Object} downloadState - Download state tracking
	 * @param {Function} onProgress - Progress callback
	 * @param {number} retryCount - Current retry attempt (internal use)
	 * @returns {Promise<void>}
	 * @private
	 */
	_performDownload(url, targetPath, startByte, totalBytes, downloadState, onProgress, retryCount = 0) {
		return new Promise(async (resolve, reject) => {
			try {
				// Get token for download (from memory or vault)
				const token = await this.getTokenForRequest();

				const protocol = url.startsWith('https') ? https : http;
				const headers = {};

				// Add range header for resume
				if (startByte > 0) {
					headers['Range'] = `bytes=${startByte}-`;
				}

				// Add authorization header if token available
				if (token) {
					headers['Authorization'] = `Bearer ${token}`;
					this.logger.debug('Bearer token injected into download request', {
						tokenLength: token.length
					});
				}

				const request = protocol.get(url, { headers, timeout: this.timeout }, (response) => {
						// Follow redirects (HF LFS files are served via 302)
						if (response.statusCode === 301 || response.statusCode === 302 ||
							response.statusCode === 307 || response.statusCode === 308) {
							const redirectUrl = response.headers.location;
							if (!redirectUrl) {
								reject(new DownloadError('Redirect received but no Location header'));
								return;
							}
							this.logger.debug('Following redirect', { from: url, to: redirectUrl });
							response.destroy();
							this._performDownload(
								redirectUrl,
								targetPath,
								startByte,
								totalBytes,
								downloadState,
								onProgress,
								retryCount
							).then(resolve).catch(reject);
							return;
						}
					// Check for errors
					if (response.statusCode === 401) {
						this.logger.warn('Received 401 Unauthorized on download', { url });
						reject(new UnauthorizedError());
						return;
					}
					if (response.statusCode === 404) {
						this.logger.warn('Received 404 Not Found on download', { url });
						reject(new NotFoundError(url));
						return;
					}
					if (response.statusCode === 429) {
						const retryAfter = response.headers['retry-after'];
						this.logger.warn('Received 429 Rate Limited on download', {
							url,
							retryAfter,
							retryCount,
							maxRetries: this.maxRetries
						});

						// Check if we should retry
						if (retryCount < this.maxRetries) {
							const delay = this._calculateBackoffDelay(retryCount, retryAfter);
							this.logger.info('Retrying download after rate limit', {
								url,
								retryCount: retryCount + 1,
								delayMs: delay,
								maxRetries: this.maxRetries
							});

							// Emit rate-limit event
							this.emit('rate-limited', {
								url,
								retryCount: retryCount + 1,
								delayMs: delay,
								retryAfter,
								type: 'download'
							});

							// Wait and retry
							this._sleep(delay).then(() => {
								this._performDownload(
									url,
									targetPath,
									startByte,
									totalBytes,
									downloadState,
									onProgress,
									retryCount + 1
								).then(resolve).catch(reject);
							});
							return;
						}

						// Max retries exceeded
						this.logger.error('Max retries exceeded for rate-limited download', {
							url,
							retryCount,
							maxRetries: this.maxRetries
						});
						reject(new RateLimitError(retryAfter));
						return;
					}
					if (response.statusCode >= 400) {
						this.logger.error('Received error response on download', {
							statusCode: response.statusCode,
							statusMessage: response.statusMessage,
							url
						});
						reject(new DownloadError(
							`HTTP ${response.statusCode}: ${response.statusMessage}`,
							response.statusCode
						));
						return;
					}

					// Get total size from headers
					const contentLength = parseInt(response.headers['content-length'], 10);
					if (contentLength && !downloadState.totalBytes) {
						downloadState.totalBytes = contentLength + startByte;
					}

					// Create write stream
					const writeStream = fs.createWriteStream(targetPath, {
						flags: startByte > 0 ? 'a' : 'w'
					});

					// Track download progress
					response.on('data', (chunk) => {
						downloadState.bytesDownloaded += chunk.length;

						// Emit progress event
						if (onProgress) {
							const percentComplete = downloadState.totalBytes > 0
								? Math.round((downloadState.bytesDownloaded / downloadState.totalBytes) * 100)
								: 0;
							onProgress(downloadState.bytesDownloaded, downloadState.totalBytes, percentComplete);
						}

						this.emit('progress', {
							bytesDownloaded: downloadState.bytesDownloaded,
							totalBytes: downloadState.totalBytes,
							percentComplete: downloadState.totalBytes > 0
								? Math.round((downloadState.bytesDownloaded / downloadState.totalBytes) * 100)
								: 0
						});
					});

					// Handle write stream errors
					writeStream.on('error', (error) => {
						response.destroy();
						this.logger.error('Write stream error during download', {
							error: error.message,
							targetPath
						});
						reject(new DownloadError(`Write error: ${error.message}`));
					});

					// Handle response end
					response.on('end', () => {
						writeStream.end();
					});

					// Handle write stream finish
					writeStream.on('finish', () => {
						resolve();
					});

					// Pipe response to file
					response.pipe(writeStream);
				});

				// Handle request errors
				request.on('error', (error) => {
					this.logger.error('Download request failed', {
						error: error.message,
						url
					});
					reject(new DownloadError(`Network error: ${error.message}`));
				});

				// Handle timeout
				request.on('timeout', () => {
					request.destroy();
					this.logger.error('Download timeout', { url, timeout: this.timeout });
					reject(new DownloadError('Download timeout'));
				});
			} catch (error) {
				this.logger.error('Error preparing download request', {
					error: error.message,
					url
				});
				reject(new DownloadError(`Failed to prepare download: ${error.message}`));
			}
		});
	}

	/**
	 * Verifies SHA-256 hash of a downloaded file.
	 *
	 * @param {string} filePath - Path to file to verify
	 * @param {string} expectedHash - Expected SHA-256 hash (hex string)
	 * @returns {Promise<Object>} Verification result: { verified, computedHash }
	 * @throws {Error} If file does not exist or hash computation fails
	 */
	async verifyDownloadHash(filePath, expectedHash) {
		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}

		if (!expectedHash || typeof expectedHash !== 'string') {
			throw new Error('expectedHash must be a non-empty string');
		}

		this.logger.debug('Computing SHA-256 hash', { filePath });

		return new Promise((resolve, reject) => {
			const hash = crypto.createHash('sha256');
			const stream = fs.createReadStream(filePath);

			stream.on('data', (chunk) => {
				hash.update(chunk);
			});

			stream.on('end', () => {
				const computedHash = hash.digest('hex');
				const verified = computedHash.toLowerCase() === expectedHash.toLowerCase();

				this.logger.debug('SHA-256 hash computed', {
					filePath,
					verified,
					computedHash: computedHash.substring(0, 16) + '...'
				});

				resolve({
					verified,
					computedHash
				});
			});

			stream.on('error', (error) => {
				reject(new Error(`Hash computation failed: ${error.message}`));
			});
		});
	}

	/**
	 * Detects vision model pairings (base GGUF + mmproj).
	 *
	 * @param {Array} siblings - Array of file objects from repository metadata
	 * @returns {Array} Array of detected pairings: { base, mmproj, quantization }
	 */
	detectVisionPairing(siblings) {
		if (!Array.isArray(siblings)) {
			throw new Error('siblings must be an array');
		}

		this.logger.debug('Detecting vision model pairings', { count: siblings.length });

		const pairings = [];
		const parsed = this.parseRepoSiblings(siblings);

		// Extract quantization suffix from filename
		const extractQuantization = (filename) => {
			// Match patterns like Q4_K_M, Q5_K_M, Q8_0, etc.
			const match = filename.match(/([QF]\d+[_A-Z0-9]*)/);
			return match ? match[1] : null;
		};

		// For each regular GGUF, try to find matching mmproj
		for (const baseFile of parsed.regularGguf) {
			const baseQuantization = extractQuantization(baseFile.filename);
			const baseNameNormalized = baseFile.filename.toLowerCase().replace(/\.gguf$/, '').replace(new RegExp('[-_]?' + (baseQuantization ? baseQuantization.toLowerCase() : '') + '[-_]?', 'g'), '').trim();

			// Strategy 1: exact quantization match (some repos provide per-quantization mmproj files)
			let matchingMmproj = null;
			if (baseQuantization) {
				matchingMmproj = parsed.mmproj.find((mmFile) => {
					const mmQuantization = extractQuantization(mmFile.filename);
					return mmQuantization === baseQuantization;
				});
			}

			// Strategy 2: if no exact match, try to find an mmproj whose base name matches
			// (e.g., mmproj-BF16.gguf for a model where the projector is shared across quantizations)
			if (!matchingMmproj) {
				matchingMmproj = parsed.mmproj.find((mmFile) => {
					const mmNameNormalized = mmFile.filename.toLowerCase().replace(/\.gguf$/, '').replace(/mmproj[-_]?/g, '').trim();
					// Check if base filename (without quantization) is contained in mmproj name or vice versa
					return baseNameNormalized.length > 0 && (mmFile.filename.toLowerCase().includes(baseNameNormalized) || baseNameNormalized.includes(mmNameNormalized));
				});
			}

			// Strategy 3: if there is only one mmproj in the repo and it is a
			// full-precision projector (F16/BF16/F32), pair it with all base models.
			// Vision projectors are typically full-precision and shared across quantizations.
			if (!matchingMmproj && parsed.mmproj.length === 1) {
				const mmQuant = extractQuantization(parsed.mmproj[0].filename);
				const isGenericProjector = mmQuant && /^F\d+$|^BF\d+$/.test(mmQuant);
				if (isGenericProjector) {
					matchingMmproj = parsed.mmproj[0];
				}
			}

			if (matchingMmproj) {
				const pairing = {
					base: baseFile.filename,
					mmproj: matchingMmproj.filename,
					quantization: baseQuantization || 'unknown'
				};
				pairings.push(pairing);
				this.logger.debug('Vision pairing detected', pairing);
			} else {
				this.logger.debug('No mmproj match found for base model', {
					filename: baseFile.filename,
					availableMmproj: parsed.mmproj.map(m => m.filename)
				});
			}
		}

		this.logger.debug('Vision pairing detection complete', { count: pairings.length });
		return pairings;
	}

	/**
	 * Makes an HTTP request to the HuggingFace API with retry logic for rate limiting.
	 *
	 * Automatically injects Bearer token from vault if available.
	 * Implements exponential backoff retry for 429 (Too Many Requests) responses.
	 *
	 * @param {string} method - HTTP method (GET, POST, etc.)
	 * @param {string} url - Full URL to request
	 * @param {Object} body - Request body (optional)
	 * @param {number} retryCount - Current retry attempt (internal use)
	 * @returns {Promise<Object>} Parsed JSON response
	 * @throws {UnauthorizedError} If 401 response
	 * @throws {NotFoundError} If 404 response
	 * @throws {RateLimitError} If 429 response after max retries
	 * @throws {HFModelServiceError} For other errors
	 * @private
	 */
	async _makeRequest(method, url, body = null, retryCount = 0) {
		return new Promise(async (resolve, reject) => {
			try {
				// Get token for request (from memory or vault)
				const token = await this.getTokenForRequest();

				const protocol = url.startsWith('https') ? https : http;
				const headers = {
					'User-Agent': 'alpaca/1.0'
				};

				// Add authorization header if token available
				if (token) {
					headers['Authorization'] = `Bearer ${token}`;
					this.logger.debug('Bearer token injected into request', {
						tokenLength: token.length
					});
				}

				const options = {
					method,
					headers,
					timeout: this.timeout
				};

				const request = protocol.request(url, options, (response) => {
					let data = '';

					response.on('data', (chunk) => {
						data += chunk;
					});

					response.on('end', async () => {
						try {
							// Handle error responses
							if (response.statusCode === 401) {
								this.logger.warn('Received 401 Unauthorized response', { url });
								reject(new UnauthorizedError());
								return;
							}
							if (response.statusCode === 404) {
								this.logger.warn('Received 404 Not Found response', { url });
								reject(new NotFoundError(url));
								return;
							}
							if (response.statusCode === 429) {
								const retryAfter = response.headers['retry-after'];
								this.logger.warn('Received 429 Rate Limited response', {
									url,
									retryAfter,
									retryCount,
									maxRetries: this.maxRetries
								});

								// Check if we should retry
								if (retryCount < this.maxRetries) {
									const delay = this._calculateBackoffDelay(retryCount, retryAfter);
									this.logger.info('Retrying request after rate limit', {
										url,
										retryCount: retryCount + 1,
										delayMs: delay,
										maxRetries: this.maxRetries
									});

									// Emit rate-limit event
									this.emit('rate-limited', {
										url,
										retryCount: retryCount + 1,
										delayMs: delay,
										retryAfter
									});

									// Wait and retry
									await this._sleep(delay);
									try {
										const result = await this._makeRequest(method, url, body, retryCount + 1);
										resolve(result);
									} catch (retryError) {
										reject(retryError);
									}
									return;
								}

								// Max retries exceeded
								this.logger.error('Max retries exceeded for rate-limited request', {
									url,
									retryCount,
									maxRetries: this.maxRetries
								});
								reject(new RateLimitError(retryAfter));
								return;
							}
							if (response.statusCode >= 400) {
								this.logger.error('Received error response', {
									statusCode: response.statusCode,
									statusMessage: response.statusMessage,
									url
								});
								reject(new HFModelServiceError(
									`HTTP ${response.statusCode}: ${response.statusMessage}`
								));
								return;
							}

							// Parse and return response
							const parsed = JSON.parse(data);
							resolve(parsed);
						} catch (error) {
							reject(new HFModelServiceError(`Failed to parse response: ${error.message}`));
						}
					});
				});

				request.on('error', (error) => {
					this.logger.error('Request failed', {
						error: error.message,
						url
					});
					reject(new HFModelServiceError(`Request failed: ${error.message}`));
				});

				request.on('timeout', () => {
					request.destroy();
					this.logger.error('Request timeout', { url, timeout: this.timeout });
					reject(new HFModelServiceError('Request timeout'));
				});

				if (body) {
					request.write(JSON.stringify(body));
				}

				request.end();
			} catch (error) {
				this.logger.error('Error preparing request', {
					error: error.message,
					url
				});
				reject(new HFModelServiceError(`Failed to prepare request: ${error.message}`));
			}
		});
	}

	/**
	 * Gets the current token.
	 *
	 * @returns {string|null} Current token or null
	 */
	getToken() {
		return this.token;
	}

	/**
	 * Sets a new token.
	 *
	 * @param {string|null} token - New token or null
	 */
	setToken(token) {
		if (token && typeof token !== 'string') {
			throw new Error('Token must be a string or null');
		}
		this.token = token;
		this.logger.debug('Token updated', { hasToken: !!token });
	}

	/**
	 * Gets active download count.
	 *
	 * @returns {number} Number of active downloads
	 */
	getActiveDownloadCount() {
		return this.activeDownloads.size;
	}

	/**
	 * Cancels a download.
	 *
	 * @param {string} repoId - Repository ID
	 * @param {string} filename - File name
	 * @returns {boolean} True if download was cancelled, false if not found
	 */
	cancelDownload(repoId, filename) {
		const downloadId = `${repoId}/${filename}`;
		const downloadState = this.activeDownloads.get(downloadId);

		if (downloadState) {
			downloadState.cancelled = true;
			this.logger.debug('Download cancelled', { repoId, filename });
			return true;
		}

		return false;
	}
}

module.exports = {
	HuggingFaceModelService,
	HFModelServiceError,
	UnauthorizedError,
	NotFoundError,
	RateLimitError,
	SHA256MismatchError,
	DownloadError,
	TokenError
};

/* eslint-env node */
/**
 * Vision Pairing Manager Module
 *
 * Manages vision model pairings (base GGUF + mmproj files) with persistent storage
 * using electron-store. Handles quantization matching, pairing detection, and
 * mmproj offload settings.
 *
 * @module vision-pairing-manager
 */

const Store = require('electron-store');
const { EventEmitter } = require('events');

/**
 * Custom error classes for vision pairing operations
 */
class VisionPairingError extends Error {
	constructor(message) {
		super(message);
		this.name = 'VisionPairingError';
	}
}

class InvalidPairingError extends VisionPairingError {
	constructor(message) {
		super(message);
		this.name = 'InvalidPairingError';
	}
}

class PairingNotFoundError extends VisionPairingError {
	constructor(baseModel) {
		super(`Pairing not found for base model: ${baseModel}`);
		this.name = 'PairingNotFoundError';
		this.baseModel = baseModel;
	}
}

/**
 * Vision Pairing Manager
 *
 * Manages vision model pairings with persistent storage and quantization matching.
 */
class VisionPairingManager extends EventEmitter {
	/**
	 * Creates a new VisionPairingManager instance.
	 *
	 * @param {Object} options - Configuration options
	 * @param {string} options.storeName - electron-store name (default: 'vision-pairings')
	 * @param {string} options.storeDir - electron-store directory (optional)
	 * @param {Object} options.logger - Logger instance (optional)
	 */
	constructor(options = {}) {
		super();

		this.storeName = options.storeName || 'vision-pairings';
		this.storeDir = options.storeDir || null;
		this.logger = options.logger || this._createDefaultLogger();

		// Initialize electron-store
		const storeOptions = {
			name: this.storeName,
			defaults: {
				modelPairs: {}
			}
		};

		if (this.storeDir) {
			storeOptions.cwd = this.storeDir;
		}

		this.store = new Store(storeOptions);

		this.logger.debug('VisionPairingManager initialized', {
			storeName: this.storeName,
			storeDir: this.storeDir
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
			debug: (msg, data) => console.debug(`[VisionPairing] ${msg}`, data || ''),
			info: (msg, data) => console.info(`[VisionPairing] ${msg}`, data || ''),
			warn: (msg, data) => console.warn(`[VisionPairing] ${msg}`, data || ''),
			error: (msg, data) => console.error(`[VisionPairing] ${msg}`, data || '')
		};
	}

	/**
	 * Extracts quantization suffix from a filename.
	 *
	 * Matches patterns like Q4_K_M, Q5_K_M, Q8_0, F16, etc.
	 *
	 * @param {string} filename - Filename to extract quantization from
	 * @returns {string|null} Quantization suffix or null if not found
	 * @private
	 */
	_extractQuantization(filename) {
		if (!filename || typeof filename !== 'string') {
			return null;
		}

		// Match patterns like Q4_K_M, Q5_K_M, Q8_0, F16, etc.
		// Pattern: starts with Q or F, followed by digits, optionally followed by underscore and letters/digits
		const match = filename.match(/([QF]\d+[_A-Z0-9]*)/);
		return match ? match[1] : null;
	}

	/**
	 * Validates a pairing object.
	 *
	 * @param {Object} pairing - Pairing object to validate
	 * @returns {Object} Validation result: { valid, errors }
	 * @private
	 */
	_validatePairing(pairing) {
		const errors = [];

		if (!pairing || typeof pairing !== 'object') {
			errors.push('Pairing must be an object');
			return { valid: false, errors };
		}

		if (!pairing.base || typeof pairing.base !== 'string') {
			errors.push('Pairing.base must be a non-empty string');
		}

		if (!pairing.mmproj || typeof pairing.mmproj !== 'string') {
			errors.push('Pairing.mmproj must be a non-empty string');
		}

		if (!pairing.mmprojQuant || typeof pairing.mmprojQuant !== 'string') {
			errors.push('Pairing.mmprojQuant must be a non-empty string');
		}

		if (!pairing.baseQuant || typeof pairing.baseQuant !== 'string') {
			errors.push('Pairing.baseQuant must be a non-empty string');
		}

		if (typeof pairing.offload !== 'boolean') {
			errors.push('Pairing.offload must be a boolean');
		}

		if (!pairing.detectedAt || typeof pairing.detectedAt !== 'string') {
			errors.push('Pairing.detectedAt must be a valid ISO 8601 timestamp');
		}

		// Validate quantization suffixes match
		if (pairing.baseQuant !== pairing.mmprojQuant) {
			errors.push('Base and mmproj quantization suffixes must match');
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}

	/**
	 * Stores a model pairing in persistent storage.
	 *
	 * @param {string} base - Base model filename (e.g., "model-Q4_K_M.gguf")
	 * @param {string} mmproj - mmproj filename (e.g., "mmproj-Q4_K_M.gguf")
	 * @param {string} mmprojQuant - mmproj quantization suffix (e.g., "Q4_K_M")
	 * @param {string} baseQuant - Base model quantization suffix (e.g., "Q4_K_M")
	 * @param {boolean} offload - Whether to offload mmproj (default: false)
	 * @returns {Promise<Object>} Stored pairing object
	 * @throws {InvalidPairingError} If pairing data is invalid
	 */
	async storeModelPair(base, mmproj, mmprojQuant, baseQuant, offload = false) {
		if (!base || typeof base !== 'string') {
			throw new InvalidPairingError('base must be a non-empty string');
		}

		if (!mmproj || typeof mmproj !== 'string') {
			throw new InvalidPairingError('mmproj must be a non-empty string');
		}

		if (!mmprojQuant || typeof mmprojQuant !== 'string') {
			throw new InvalidPairingError('mmprojQuant must be a non-empty string');
		}

		if (!baseQuant || typeof baseQuant !== 'string') {
			throw new InvalidPairingError('baseQuant must be a non-empty string');
		}

		if (mmprojQuant !== baseQuant) {
			throw new InvalidPairingError(
				`Quantization mismatch: base=${baseQuant}, mmproj=${mmprojQuant}`
			);
		}

		if (typeof offload !== 'boolean') {
			throw new InvalidPairingError('offload must be a boolean');
		}

		const pairing = {
			base,
			mmproj,
			mmprojQuant,
			baseQuant,
			offload,
			detectedAt: new Date().toISOString()
		};

		// Validate pairing
		const validation = this._validatePairing(pairing);
		if (!validation.valid) {
			throw new InvalidPairingError(`Invalid pairing: ${validation.errors.join(', ')}`);
		}

		try {
			// Get current pairings
			const modelPairs = this.store.get('modelPairs', {});

			// Store pairing keyed by base model filename
			modelPairs[base] = pairing;

			// Persist to store
			this.store.set('modelPairs', modelPairs);

			this.logger.debug('Model pair stored', {
				base,
				mmproj,
				quantization: baseQuant,
				offload
			});

			this.emit('pairing-stored', pairing);

			return pairing;
		} catch (error) {
			this.logger.error('Failed to store model pair', {
				base,
				mmproj,
				error: error.message
			});
			throw new VisionPairingError(`Failed to store pairing: ${error.message}`);
		}
	}

	/**
	 * Retrieves a model pairing by base model filename.
	 *
	 * @param {string} baseModel - Base model filename
	 * @returns {Promise<Object|null>} Pairing object or null if not found
	 * @throws {VisionPairingError} If retrieval fails
	 */
	async getModelPair(baseModel) {
		if (!baseModel || typeof baseModel !== 'string') {
			throw new VisionPairingError('baseModel must be a non-empty string');
		}

		try {
			const modelPairs = this.store.get('modelPairs', {});
			const pairing = modelPairs[baseModel] || null;

			if (pairing) {
				this.logger.debug('Model pair retrieved', {
					baseModel,
					mmproj: pairing.mmproj
				});
			} else {
				this.logger.debug('Model pair not found', { baseModel });
			}

			return pairing;
		} catch (error) {
			this.logger.error('Failed to retrieve model pair', {
				baseModel,
				error: error.message
			});
			throw new VisionPairingError(`Failed to retrieve pairing: ${error.message}`);
		}
	}

	/**
	 * Updates the offload flag for a model pairing.
	 *
	 * @param {string} baseModel - Base model filename
	 * @param {boolean} offload - New offload flag value
	 * @returns {Promise<Object>} Updated pairing object
	 * @throws {PairingNotFoundError} If pairing not found
	 * @throws {VisionPairingError} If update fails
	 */
	async updateOffloadFlag(baseModel, offload) {
		if (!baseModel || typeof baseModel !== 'string') {
			throw new VisionPairingError('baseModel must be a non-empty string');
		}

		if (typeof offload !== 'boolean') {
			throw new VisionPairingError('offload must be a boolean');
		}

		try {
			const modelPairs = this.store.get('modelPairs', {});
			const pairing = modelPairs[baseModel];

			if (!pairing) {
				throw new PairingNotFoundError(baseModel);
			}

			// Update offload flag
			pairing.offload = offload;

			// Persist to store
			modelPairs[baseModel] = pairing;
			this.store.set('modelPairs', modelPairs);

			this.logger.debug('Offload flag updated', {
				baseModel,
				offload
			});

			this.emit('offload-flag-updated', {
				baseModel,
				offload
			});

			return pairing;
		} catch (error) {
			if (error instanceof PairingNotFoundError) {
				throw error;
			}

			this.logger.error('Failed to update offload flag', {
				baseModel,
				error: error.message
			});
			throw new VisionPairingError(`Failed to update offload flag: ${error.message}`);
		}
	}

	/**
	 * Retrieves all stored model pairings.
	 *
	 * @returns {Promise<Object>} Object mapping base model filenames to pairings
	 * @throws {VisionPairingError} If retrieval fails
	 */
	async getAllPairs() {
		try {
			const modelPairs = this.store.get('modelPairs', {});

			this.logger.debug('All model pairs retrieved', {
				count: Object.keys(modelPairs).length
			});

			return modelPairs;
		} catch (error) {
			this.logger.error('Failed to retrieve all model pairs', {
				error: error.message
			});
			throw new VisionPairingError(`Failed to retrieve pairings: ${error.message}`);
		}
	}

	/**
	 * Deletes a model pairing.
	 *
	 * @param {string} baseModel - Base model filename
	 * @returns {Promise<boolean>} True if pairing was deleted, false if not found
	 * @throws {VisionPairingError} If deletion fails
	 */
	async deletePair(baseModel) {
		if (!baseModel || typeof baseModel !== 'string') {
			throw new VisionPairingError('baseModel must be a non-empty string');
		}

		try {
			const modelPairs = this.store.get('modelPairs', {});

			if (!modelPairs[baseModel]) {
				this.logger.debug('Pairing not found for deletion', { baseModel });
				return false;
			}

			// Delete pairing
			delete modelPairs[baseModel];

			// Persist to store
			this.store.set('modelPairs', modelPairs);

			this.logger.debug('Model pair deleted', { baseModel });

			this.emit('pairing-deleted', { baseModel });

			return true;
		} catch (error) {
			this.logger.error('Failed to delete model pair', {
				baseModel,
				error: error.message
			});
			throw new VisionPairingError(`Failed to delete pairing: ${error.message}`);
		}
	}

	/**
	 * Detects and stores vision model pairings from a list of files.
	 *
	 * Implements quantization matching heuristics to pair base GGUF files
	 * with mmproj files that have matching quantization suffixes.
	 *
	 * @param {Array} files - Array of file objects with 'filename' property
	 * @returns {Promise<Array>} Array of detected and stored pairings
	 * @throws {VisionPairingError} If detection fails
	 */
	async detectAndStorePairings(files) {
		if (!Array.isArray(files)) {
			throw new VisionPairingError('files must be an array');
		}

		this.logger.debug('Detecting vision model pairings', { count: files.length });

		const pairings = [];

		try {
			// Separate files into categories
			const baseModels = [];
			const mmprojFiles = [];

			for (const file of files) {
				const filename = file.filename || '';
				const lowerFilename = filename.toLowerCase();

				if (lowerFilename.endsWith('.gguf')) {
					if (lowerFilename.includes('mmproj')) {
						mmprojFiles.push(file);
					} else {
						baseModels.push(file);
					}
				}
			}

			this.logger.debug('Files categorized', {
				baseModels: baseModels.length,
				mmprojFiles: mmprojFiles.length
			});

			// Match base models with mmproj files
			for (const baseFile of baseModels) {
				const baseQuantization = this._extractQuantization(baseFile.filename);

				if (!baseQuantization) {
					this.logger.debug('No quantization found in base model', {
						filename: baseFile.filename
					});
					continue;
				}

				// Find matching mmproj
				const matchingMmproj = mmprojFiles.find((mmFile) => {
					const mmQuantization = this._extractQuantization(mmFile.filename);
					return mmQuantization === baseQuantization;
				});

				if (matchingMmproj) {
					try {
						// Store the pairing
						const pairing = await this.storeModelPair(
							baseFile.filename,
							matchingMmproj.filename,
							baseQuantization,
							baseQuantization,
							false // default offload to false
						);

						pairings.push(pairing);

						this.logger.debug('Vision pairing detected and stored', {
							base: baseFile.filename,
							mmproj: matchingMmproj.filename,
							quantization: baseQuantization
						});
					} catch (error) {
						this.logger.warn('Failed to store detected pairing', {
							base: baseFile.filename,
							mmproj: matchingMmproj.filename,
							error: error.message
						});
					}
				} else {
					this.logger.debug('No matching mmproj found for base model', {
						filename: baseFile.filename,
						quantization: baseQuantization
					});
				}
			}

			// Log orphaned mmproj files
			const pairedMmprojFiles = new Set(pairings.map(p => p.mmproj));
			for (const mmFile of mmprojFiles) {
				if (!pairedMmprojFiles.has(mmFile.filename)) {
					this.logger.debug('Orphaned mmproj file (no matching base model)', {
						filename: mmFile.filename
					});
				}
			}

			this.logger.debug('Vision pairing detection complete', {
				count: pairings.length
			});

			this.emit('pairings-detected', {
				count: pairings.length,
				pairings
			});

			return pairings;
		} catch (error) {
			this.logger.error('Failed to detect and store pairings', {
				error: error.message
			});
			throw new VisionPairingError(`Failed to detect pairings: ${error.message}`);
		}
	}

	/**
	 * Clears all stored pairings.
	 *
	 * @returns {Promise<void>}
	 * @throws {VisionPairingError} If clearing fails
	 */
	async clearAllPairings() {
		try {
			this.store.set('modelPairs', {});

			this.logger.debug('All model pairings cleared');

			this.emit('pairings-cleared');
		} catch (error) {
			this.logger.error('Failed to clear all pairings', {
				error: error.message
			});
			throw new VisionPairingError(`Failed to clear pairings: ${error.message}`);
		}
	}

	/**
	 * Gets statistics about stored pairings.
	 *
	 * @returns {Promise<Object>} Statistics object
	 */
	async getStatistics() {
		try {
			const modelPairs = this.store.get('modelPairs', {});
			const pairings = Object.values(modelPairs);

			const offloadCount = pairings.filter(p => p.offload).length;
			const quantizations = new Set(pairings.map(p => p.baseQuant));

			const stats = {
				totalPairings: pairings.length,
				offloadEnabled: offloadCount,
				offloadDisabled: pairings.length - offloadCount,
				quantizations: Array.from(quantizations),
				pairings: modelPairs
			};

			this.logger.debug('Pairing statistics retrieved', {
				totalPairings: stats.totalPairings,
				offloadEnabled: stats.offloadEnabled
			});

			return stats;
		} catch (error) {
			this.logger.error('Failed to get statistics', {
				error: error.message
			});
			throw new VisionPairingError(`Failed to get statistics: ${error.message}`);
		}
	}
}

module.exports = {
	VisionPairingManager,
	VisionPairingError,
	InvalidPairingError,
	PairingNotFoundError
};

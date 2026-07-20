/* eslint-env node */
/**
 * Tests for vision-pairing-manager.js
 *
 * Run with: node desktop/tests/vision-pairing-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
	VisionPairingManager,
	VisionPairingError,
	InvalidPairingError,
	PairingNotFoundError
} = require('../vision-pairing-manager');

/**
 * Test utilities
 */
const testDir = path.join(os.tmpdir(), 'vision-pairing-tests');

function ensureTestDir() {
	if (!fs.existsSync(testDir)) {
		fs.mkdirSync(testDir, { recursive: true });
	}
}

function cleanupTestDir() {
	if (fs.existsSync(testDir)) {
		fs.rmSync(testDir, { recursive: true, force: true });
	}
}

function createMockLogger() {
	return {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {}
	};
}

/**
 * Simple test runner
 */
const suites = [];

function describe(name, fn) {
	const suite = { name, tests: [] };
	suites.push(suite);

	global.test = (name, fn) => {
		suite.tests.push({ name, fn });
	};

	global.beforeEach = (fn) => {
		suite.beforeEach = fn;
	};

	global.afterEach = (fn) => {
		suite.afterEach = fn;
	};

	fn();
}

/**
 * Test Suite: VisionPairingManager Initialization
 */
describe('VisionPairingManager - Initialization', () => {
	beforeEach(() => {
		ensureTestDir();
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should create instance with default options', () => {
		const manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});
		assert.strictEqual(manager.storeName, 'vision-pairings');
		assert.ok(manager.store);
	});

	test('should create instance with custom store name', () => {
		const manager = new VisionPairingManager({
			storeName: 'custom-pairings',
			storeDir: testDir,
			logger: createMockLogger()
		});
		assert.strictEqual(manager.storeName, 'custom-pairings');
	});

	test('should initialize with empty model pairs', async () => {
		const manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});
		const pairs = await manager.getAllPairs();
		assert.deepStrictEqual(pairs, {});
	});
});

/**
 * Test Suite: Quantization Extraction
 */
describe('VisionPairingManager - Quantization Extraction', () => {
	let manager;

	beforeEach(() => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should extract Q4_K_M quantization', () => {
		const quant = manager._extractQuantization('model-Q4_K_M.gguf');
		assert.strictEqual(quant, 'Q4_K_M');
	});

	test('should extract Q5_K_M quantization', () => {
		const quant = manager._extractQuantization('model-Q5_K_M.gguf');
		assert.strictEqual(quant, 'Q5_K_M');
	});

	test('should extract Q8_0 quantization', () => {
		const quant = manager._extractQuantization('model-Q8_0.gguf');
		assert.strictEqual(quant, 'Q8_0');
	});

	test('should extract F16 quantization', () => {
		const quant = manager._extractQuantization('model-F16.gguf');
		assert.strictEqual(quant, 'F16');
	});

	test('should extract quantization from mmproj filename', () => {
		const quant = manager._extractQuantization('mmproj-Q4_K_M.gguf');
		assert.strictEqual(quant, 'Q4_K_M');
	});

	test('should return null for filename without quantization', () => {
		const quant = manager._extractQuantization('model.gguf');
		assert.strictEqual(quant, null);
	});

	test('should return null for null filename', () => {
		const quant = manager._extractQuantization(null);
		assert.strictEqual(quant, null);
	});

	test('should return null for empty filename', () => {
		const quant = manager._extractQuantization('');
		assert.strictEqual(quant, null);
	});
});

/**
 * Test Suite: Store Model Pair
 */
describe('VisionPairingManager - Store Model Pair', () => {
	let manager;

	beforeEach(() => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should store a valid model pair', async () => {
		const pairing = await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		assert.strictEqual(pairing.base, 'model-Q4_K_M.gguf');
		assert.strictEqual(pairing.mmproj, 'mmproj-Q4_K_M.gguf');
		assert.strictEqual(pairing.baseQuant, 'Q4_K_M');
		assert.strictEqual(pairing.mmprojQuant, 'Q4_K_M');
		assert.strictEqual(pairing.offload, false);
		assert.ok(pairing.detectedAt);
	});

	test('should store pairing with offload enabled', async () => {
		const pairing = await manager.storeModelPair(
			'model-Q5_K_M.gguf',
			'mmproj-Q5_K_M.gguf',
			'Q5_K_M',
			'Q5_K_M',
			true
		);

		assert.strictEqual(pairing.offload, true);
	});

	test('should reject pairing with mismatched quantizations', async () => {
		try {
			await manager.storeModelPair(
				'model-Q4_K_M.gguf',
				'mmproj-Q5_K_M.gguf',
				'Q5_K_M',
				'Q4_K_M',
				false
			);
			assert.fail('Should have thrown InvalidPairingError');
		} catch (error) {
			assert.ok(error instanceof InvalidPairingError);
			assert.ok(error.message.includes('Quantization mismatch'));
		}
	});

	test('should reject pairing with invalid base', async () => {
		try {
			await manager.storeModelPair(
				null,
				'mmproj-Q4_K_M.gguf',
				'Q4_K_M',
				'Q4_K_M',
				false
			);
			assert.fail('Should have thrown InvalidPairingError');
		} catch (error) {
			assert.ok(error instanceof InvalidPairingError);
		}
	});

	test('should reject pairing with invalid mmproj', async () => {
		try {
			await manager.storeModelPair(
				'model-Q4_K_M.gguf',
				null,
				'Q4_K_M',
				'Q4_K_M',
				false
			);
			assert.fail('Should have thrown InvalidPairingError');
		} catch (error) {
			assert.ok(error instanceof InvalidPairingError);
		}
	});

	test('should reject pairing with invalid offload flag', async () => {
		try {
			await manager.storeModelPair(
				'model-Q4_K_M.gguf',
				'mmproj-Q4_K_M.gguf',
				'Q4_K_M',
				'Q4_K_M',
				'not-a-boolean'
			);
			assert.fail('Should have thrown InvalidPairingError');
		} catch (error) {
			assert.ok(error instanceof InvalidPairingError);
		}
	});

	test('should emit pairing-stored event', async () => {
		let emitted = false;
		manager.on('pairing-stored', () => {
			emitted = true;
		});

		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		assert.ok(emitted);
	});
});

/**
 * Test Suite: Get Model Pair
 */
describe('VisionPairingManager - Get Model Pair', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store a test pairing
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should retrieve stored pairing', async () => {
		const pairing = await manager.getModelPair('model-Q4_K_M.gguf');
		assert.ok(pairing);
		assert.strictEqual(pairing.base, 'model-Q4_K_M.gguf');
		assert.strictEqual(pairing.mmproj, 'mmproj-Q4_K_M.gguf');
	});

	test('should return null for non-existent pairing', async () => {
		const pairing = await manager.getModelPair('non-existent.gguf');
		assert.strictEqual(pairing, null);
	});

	test('should reject invalid base model name', async () => {
		try {
			await manager.getModelPair(null);
			assert.fail('Should have thrown VisionPairingError');
		} catch (error) {
			assert.ok(error instanceof VisionPairingError);
		}
	});
});

/**
 * Test Suite: Update Offload Flag
 */
describe('VisionPairingManager - Update Offload Flag', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store a test pairing
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should update offload flag to true', async () => {
		const updated = await manager.updateOffloadFlag('model-Q4_K_M.gguf', true);
		assert.strictEqual(updated.offload, true);
	});

	test('should update offload flag to false', async () => {
		// First set to true
		await manager.updateOffloadFlag('model-Q4_K_M.gguf', true);

		// Then set to false
		const updated = await manager.updateOffloadFlag('model-Q4_K_M.gguf', false);
		assert.strictEqual(updated.offload, false);
	});

	test('should throw PairingNotFoundError for non-existent pairing', async () => {
		try {
			await manager.updateOffloadFlag('non-existent.gguf', true);
			assert.fail('Should have thrown PairingNotFoundError');
		} catch (error) {
			assert.ok(error instanceof PairingNotFoundError);
		}
	});

	test('should emit offload-flag-updated event', async () => {
		let emitted = false;
		let eventData = null;

		manager.on('offload-flag-updated', (data) => {
			emitted = true;
			eventData = data;
		});

		await manager.updateOffloadFlag('model-Q4_K_M.gguf', true);

		assert.ok(emitted);
		assert.strictEqual(eventData.baseModel, 'model-Q4_K_M.gguf');
		assert.strictEqual(eventData.offload, true);
	});

	test('should reject invalid offload flag', async () => {
		try {
			await manager.updateOffloadFlag('model-Q4_K_M.gguf', 'not-a-boolean');
			assert.fail('Should have thrown VisionPairingError');
		} catch (error) {
			assert.ok(error instanceof VisionPairingError);
		}
	});
});

/**
 * Test Suite: Get All Pairs
 */
describe('VisionPairingManager - Get All Pairs', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store multiple test pairings
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		await manager.storeModelPair(
			'model-Q5_K_M.gguf',
			'mmproj-Q5_K_M.gguf',
			'Q5_K_M',
			'Q5_K_M',
			true
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should retrieve all stored pairings', async () => {
		const pairs = await manager.getAllPairs();
		assert.strictEqual(Object.keys(pairs).length, 2);
		assert.ok(pairs['model-Q4_K_M.gguf']);
		assert.ok(pairs['model-Q5_K_M.gguf']);
	});

	test('should return empty object when no pairings stored', async () => {
		const newManager = new VisionPairingManager({
			storeDir: testDir,
			storeName: 'empty-pairings',
			logger: createMockLogger()
		});

		const pairs = await newManager.getAllPairs();
		assert.deepStrictEqual(pairs, {});
	});
});

/**
 * Test Suite: Delete Pair
 */
describe('VisionPairingManager - Delete Pair', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store test pairings
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		await manager.storeModelPair(
			'model-Q5_K_M.gguf',
			'mmproj-Q5_K_M.gguf',
			'Q5_K_M',
			'Q5_K_M',
			false
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should delete existing pairing', async () => {
		const deleted = await manager.deletePair('model-Q4_K_M.gguf');
		assert.strictEqual(deleted, true);

		// Verify it's gone
		const pairing = await manager.getModelPair('model-Q4_K_M.gguf');
		assert.strictEqual(pairing, null);
	});

	test('should return false for non-existent pairing', async () => {
		const deleted = await manager.deletePair('non-existent.gguf');
		assert.strictEqual(deleted, false);
	});

	test('should not affect other pairings', async () => {
		await manager.deletePair('model-Q4_K_M.gguf');

		const remaining = await manager.getModelPair('model-Q5_K_M.gguf');
		assert.ok(remaining);
		assert.strictEqual(remaining.base, 'model-Q5_K_M.gguf');
	});

	test('should emit pairing-deleted event', async () => {
		let emitted = false;
		let eventData = null;

		manager.on('pairing-deleted', (data) => {
			emitted = true;
			eventData = data;
		});

		await manager.deletePair('model-Q4_K_M.gguf');

		assert.ok(emitted);
		assert.strictEqual(eventData.baseModel, 'model-Q4_K_M.gguf');
	});
});

/**
 * Test Suite: Detect and Store Pairings
 */
describe('VisionPairingManager - Detect and Store Pairings', () => {
	let manager;

	beforeEach(() => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should detect matching base and mmproj pairs', async () => {
		const files = [
			{ filename: 'model-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q4_K_M.gguf' },
			{ filename: 'model-Q5_K_M.gguf' },
			{ filename: 'mmproj-Q5_K_M.gguf' }
		];

		const pairings = await manager.detectAndStorePairings(files);

		assert.strictEqual(pairings.length, 2);
		assert.ok(pairings.some(p => p.base === 'model-Q4_K_M.gguf'));
		assert.ok(pairings.some(p => p.base === 'model-Q5_K_M.gguf'));
	});

	test('should skip base models without matching mmproj', async () => {
		const files = [
			{ filename: 'model-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q5_K_M.gguf' }
		];

		const pairings = await manager.detectAndStorePairings(files);

		assert.strictEqual(pairings.length, 0);
	});

	test('should skip orphaned mmproj files', async () => {
		const files = [
			{ filename: 'model-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q5_K_M.gguf' } // orphaned
		];

		const pairings = await manager.detectAndStorePairings(files);

		assert.strictEqual(pairings.length, 1);
		assert.strictEqual(pairings[0].base, 'model-Q4_K_M.gguf');
	});

	test('should ignore non-GGUF files', async () => {
		const files = [
			{ filename: 'model-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q4_K_M.gguf' },
			{ filename: 'model.safetensors' },
			{ filename: 'config.json' }
		];

		const pairings = await manager.detectAndStorePairings(files);

		assert.strictEqual(pairings.length, 1);
	});

	test('should emit pairings-detected event', async () => {
		let emitted = false;
		let eventData = null;

		manager.on('pairings-detected', (data) => {
			emitted = true;
			eventData = data;
		});

		const files = [
			{ filename: 'model-Q4_K_M.gguf' },
			{ filename: 'mmproj-Q4_K_M.gguf' }
		];

		await manager.detectAndStorePairings(files);

		assert.ok(emitted);
		assert.strictEqual(eventData.count, 1);
	});

	test('should reject non-array input', async () => {
		try {
			await manager.detectAndStorePairings('not-an-array');
			assert.fail('Should have thrown VisionPairingError');
		} catch (error) {
			assert.ok(error instanceof VisionPairingError);
		}
	});
});

/**
 * Test Suite: Clear All Pairings
 */
describe('VisionPairingManager - Clear All Pairings', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store test pairings
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		await manager.storeModelPair(
			'model-Q5_K_M.gguf',
			'mmproj-Q5_K_M.gguf',
			'Q5_K_M',
			'Q5_K_M',
			false
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should clear all pairings', async () => {
		let pairs = await manager.getAllPairs();
		assert.strictEqual(Object.keys(pairs).length, 2);

		await manager.clearAllPairings();

		pairs = await manager.getAllPairs();
		assert.deepStrictEqual(pairs, {});
	});

	test('should emit pairings-cleared event', async () => {
		let emitted = false;

		manager.on('pairings-cleared', () => {
			emitted = true;
		});

		await manager.clearAllPairings();

		assert.ok(emitted);
	});
});

/**
 * Test Suite: Get Statistics
 */
describe('VisionPairingManager - Get Statistics', () => {
	let manager;

	beforeEach(async () => {
		ensureTestDir();
		manager = new VisionPairingManager({
			storeDir: testDir,
			logger: createMockLogger()
		});

		// Store test pairings with different offload settings
		await manager.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			true
		);

		await manager.storeModelPair(
			'model-Q5_K_M.gguf',
			'mmproj-Q5_K_M.gguf',
			'Q5_K_M',
			'Q5_K_M',
			false
		);

		await manager.storeModelPair(
			'model-Q8_0.gguf',
			'mmproj-Q8_0.gguf',
			'Q8_0',
			'Q8_0',
			true
		);
	});

	afterEach(() => {
		cleanupTestDir();
	});

	test('should return correct statistics', async () => {
		const stats = await manager.getStatistics();

		assert.strictEqual(stats.totalPairings, 3);
		assert.strictEqual(stats.offloadEnabled, 2);
		assert.strictEqual(stats.offloadDisabled, 1);
		assert.strictEqual(stats.quantizations.length, 3);
	});

	test('should include all quantizations in statistics', async () => {
		const stats = await manager.getStatistics();

		assert.ok(stats.quantizations.includes('Q4_K_M'));
		assert.ok(stats.quantizations.includes('Q5_K_M'));
		assert.ok(stats.quantizations.includes('Q8_0'));
	});

	test('should include pairings in statistics', async () => {
		const stats = await manager.getStatistics();

		assert.ok(stats.pairings['model-Q4_K_M.gguf']);
		assert.ok(stats.pairings['model-Q5_K_M.gguf']);
		assert.ok(stats.pairings['model-Q8_0.gguf']);
	});
});

/**
 * Test Suite: Persistence
 */
describe('VisionPairingManager - Persistence', () => {
	test('should persist pairings across instances', async () => {
		ensureTestDir();

		// Create first instance and store pairing
		const manager1 = new VisionPairingManager({
			storeName: 'persistent-test',
			storeDir: testDir,
			logger: createMockLogger()
		});

		await manager1.storeModelPair(
			'model-Q4_K_M.gguf',
			'mmproj-Q4_K_M.gguf',
			'Q4_K_M',
			'Q4_K_M',
			false
		);

		// Create second instance and verify pairing exists
		const manager2 = new VisionPairingManager({
			storeName: 'persistent-test',
			storeDir: testDir,
			logger: createMockLogger()
		});

		const pairing = await manager2.getModelPair('model-Q4_K_M.gguf');
		assert.ok(pairing);
		assert.strictEqual(pairing.base, 'model-Q4_K_M.gguf');

		cleanupTestDir();
	});
});

/**
 * Run all tests
 */
async function runTests() {
	console.log('Running VisionPairingManager tests...\n');

	let totalTests = 0;
	let passedTests = 0;
	let failedTests = 0;

	for (const suite of suites) {
		console.log(`\n${suite.name}`);
		console.log('='.repeat(60));

		for (const test of suite.tests) {
			totalTests++;

			try {
				if (suite.beforeEach) {
					await suite.beforeEach();
				}

				await test.fn();

				if (suite.afterEach) {
					await suite.afterEach();
				}

				console.log(`✓ ${test.name}`);
				passedTests++;
			} catch (error) {
				console.log(`✗ ${test.name}`);
				console.log(`  Error: ${error.message}`);
				failedTests++;
			}
		}
	}

	console.log('\n' + '='.repeat(60));
	console.log(`\nTest Results: ${passedTests}/${totalTests} passed`);

	if (failedTests > 0) {
		console.log(`${failedTests} test(s) failed`);
		process.exit(1);
	} else {
		console.log('All tests passed!');
		process.exit(0);
	}
}

// Run tests
runTests().catch((error) => {
	console.error('Test runner error:', error);
	process.exit(1);
});

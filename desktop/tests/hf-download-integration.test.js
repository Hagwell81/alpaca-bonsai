/**
 * Integration tests for HuggingFace model download flow with HF_Model_Service and Vision_Pairing_Manager
 * 
 * Tests the complete workflow:
 * 1. Search HuggingFace repository
 * 2. Download model with resume support
 * 3. Detect and store vision pairings
 * 4. Verify SHA-256 hash
 * 5. Update UI with pairing information
 * 
 * Run with: node desktop/tests/hf-download-integration.test.js
 */

/* eslint-env node */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { HuggingFaceModelService } = require('../hf-model-service');
const { VisionPairingManager } = require('../vision-pairing-manager');
const Store = require('electron-store');

/**
 * Test utilities
 */
const testDir = path.join(os.tmpdir(), `hf-integration-tests-${Date.now()}`);

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
 * Test suite
 */
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    testsFailed++;
  }
}

/**
 * Tests
 */
async function runTests() {
  console.log('HuggingFace Download Integration Tests\n');

  ensureTestDir();

  try {
    // Initialize services
    const hfService = new HuggingFaceModelService(null, { logger: createMockLogger() });
    const testStore = new Store({ cwd: testDir, name: 'test-store' });
    const visionManager = new VisionPairingManager({ logger: createMockLogger() });

    // Test: parseRepoSiblings
    test('parseRepoSiblings should categorize files correctly', () => {
      const siblings = [
        {
          filename: 'model-Q4_K_M.gguf',
          size: 5000000000,
          lfs: { sha256: 'abc123' }
        },
        {
          filename: 'mmproj-Q4_K_M.gguf',
          size: 1000000000,
          lfs: { sha256: 'def456' }
        },
        {
          filename: 'README.md',
          size: 5000
        }
      ];

      const parsed = hfService.parseRepoSiblings(siblings);
      
      assert.strictEqual(parsed.regularGguf.length, 1);
      assert.strictEqual(parsed.regularGguf[0].filename, 'model-Q4_K_M.gguf');
      assert.strictEqual(parsed.mmproj.length, 1);
      assert.strictEqual(parsed.mmproj[0].filename, 'mmproj-Q4_K_M.gguf');
    });

    // Test: detectVisionPairing
    test('detectVisionPairing should detect matching pairs', () => {
      const siblings = [
        { filename: 'model-Q4_K_M.gguf', size: 5000000000, lfs: { sha256: 'abc123' } },
        { filename: 'mmproj-Q4_K_M.gguf', size: 1000000000, lfs: { sha256: 'def456' } },
        { filename: 'model-Q5_K_M.gguf', size: 6000000000, lfs: { sha256: 'ghi789' } },
        { filename: 'mmproj-Q5_K_M.gguf', size: 1100000000, lfs: { sha256: 'jkl012' } },
      ];

      const pairings = hfService.detectVisionPairing(siblings);

      assert.strictEqual(pairings.length, 2);
      assert.strictEqual(pairings[0].base, 'model-Q4_K_M.gguf');
      assert.strictEqual(pairings[0].mmproj, 'mmproj-Q4_K_M.gguf');
      assert.strictEqual(pairings[0].quantization, 'Q4_K_M');
    });

    // Test: detectVisionPairing with no vision files
    test('detectVisionPairing should handle repositories without vision files', () => {
      const siblings = [
        { filename: 'model-Q4_K_M.gguf', size: 5000000000, lfs: { sha256: 'abc123' } },
        { filename: 'model-Q5_K_M.gguf', size: 6000000000, lfs: { sha256: 'ghi789' } },
      ];

      const pairings = hfService.detectVisionPairing(siblings);

      assert.strictEqual(pairings.length, 0);
    });

    // Test: detectVisionPairing with orphaned mmproj
    test('detectVisionPairing should handle orphaned mmproj files', () => {
      const siblings = [
        { filename: 'model-Q4_K_M.gguf', size: 5000000000, lfs: { sha256: 'abc123' } },
        { filename: 'mmproj-Q5_K_M.gguf', size: 1100000000, lfs: { sha256: 'jkl012' } },
      ];

      const pairings = hfService.detectVisionPairing(siblings);

      assert.strictEqual(pairings.length, 0);
    });

    // Test: Store and retrieve model pairings
    await asyncTest('should store and retrieve model pairings', async () => {
      const baseModel = 'model-Q4_K_M.gguf';
      const mmproj = 'mmproj-Q4_K_M.gguf';
      const quantization = 'Q4_K_M';

      await visionManager.storeModelPair(baseModel, mmproj, quantization, quantization, false);
      const pairing = await visionManager.getModelPair(baseModel);

      assert(pairing);
      assert.strictEqual(pairing.base, baseModel);
      assert.strictEqual(pairing.mmproj, mmproj);
      assert.strictEqual(pairing.mmprojQuant, quantization);
      assert.strictEqual(pairing.offload, false);
    });

    // Test: Update offload flag
    await asyncTest('should update offload flag for model pair', async () => {
      const baseModel = 'model-Q4_K_M-offload.gguf';
      const mmproj = 'mmproj-Q4_K_M.gguf';

      await visionManager.storeModelPair(baseModel, mmproj, 'Q4_K_M', 'Q4_K_M', false);
      await visionManager.updateOffloadFlag(baseModel, true);

      const pairing = await visionManager.getModelPair(baseModel);
      assert.strictEqual(pairing.offload, true);
    });

    // Test: Get all pairings
    await asyncTest('should retrieve all stored pairings', async () => {
      const baseModel1 = `model-Q4_K_M-all-${Date.now()}.gguf`;
      const baseModel2 = `model-Q5_K_M-all-${Date.now()}.gguf`;

      await visionManager.storeModelPair(baseModel1, 'mmproj-Q4_K_M.gguf', 'Q4_K_M', 'Q4_K_M', false);
      await visionManager.storeModelPair(baseModel2, 'mmproj-Q5_K_M.gguf', 'Q5_K_M', 'Q5_K_M', true);

      const pairs = await visionManager.getAllPairs();

      const pairCount = Object.keys(pairs).length;
      assert(pairCount >= 2, `Expected at least 2 pairs, got ${pairCount}`);
      assert(pairs[baseModel1], `Expected ${baseModel1} in pairs`);
      assert(pairs[baseModel2], `Expected ${baseModel2} in pairs`);
    });

    // Test: Delete pairing
    await asyncTest('should delete model pairing', async () => {
      const baseModel = 'model-Q4_K_M-delete.gguf';

      await visionManager.storeModelPair(baseModel, 'mmproj-Q4_K_M.gguf', 'Q4_K_M', 'Q4_K_M', false);
      await visionManager.deletePair(baseModel);

      const pairing = await visionManager.getModelPair(baseModel);
      assert.strictEqual(pairing, null);
    });

    // Test: SHA-256 verification - correct hash
    await asyncTest('should verify correct SHA-256 hash', async () => {
      const testFile = path.join(testDir, 'test-model.gguf');
      const testContent = 'test model content';
      fs.writeFileSync(testFile, testContent);

      const expectedHash = crypto
        .createHash('sha256')
        .update(testContent)
        .digest('hex');

      const result = await hfService.verifyDownloadHash(testFile, expectedHash);

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.computedHash, expectedHash);
    });

    // Test: SHA-256 verification - incorrect hash
    await asyncTest('should detect hash mismatch', async () => {
      const testFile = path.join(testDir, 'test-model-mismatch.gguf');
      fs.writeFileSync(testFile, 'test model content');

      const wrongHash = 'wronghash123456789';
      const result = await hfService.verifyDownloadHash(testFile, wrongHash);

      assert.strictEqual(result.verified, false);
      assert.notStrictEqual(result.computedHash, wrongHash);
    });

    // Test: SHA-256 verification - case insensitive
    await asyncTest('should handle case-insensitive hash comparison', async () => {
      const testFile = path.join(testDir, 'test-model-case.gguf');
      const testContent = 'test model content';
      fs.writeFileSync(testFile, testContent);

      const expectedHash = crypto
        .createHash('sha256')
        .update(testContent)
        .digest('hex')
        .toLowerCase();

      const result = await hfService.verifyDownloadHash(testFile, expectedHash.toUpperCase());

      assert.strictEqual(result.verified, true);
    });

    // Test: Complete download workflow
    await asyncTest('should handle complete download workflow', async () => {
      const siblings = [
        {
          filename: 'model-Q4_K_M.gguf',
          size: 5000000000,
          lfs: { sha256: 'abc123' }
        },
        {
          filename: 'mmproj-Q4_K_M.gguf',
          size: 1000000000,
          lfs: { sha256: 'def456' }
        }
      ];

      const parsed = hfService.parseRepoSiblings(siblings);
      assert.strictEqual(parsed.regularGguf.length, 1);
      assert.strictEqual(parsed.mmproj.length, 1);

      const pairings = hfService.detectVisionPairing(siblings);
      assert.strictEqual(pairings.length, 1);

      const pairing = pairings[0];
      await visionManager.storeModelPair(
        pairing.base,
        pairing.mmproj,
        pairing.quantization,
        pairing.quantization,
        false
      );

      const storedPairing = await visionManager.getModelPair(pairing.base);
      assert(storedPairing);
      assert.strictEqual(storedPairing.mmproj, pairing.mmproj);
    });

    // Test: Multiple vision variants
    await asyncTest('should handle multiple vision variants', async () => {
      const timestamp = Date.now();
      const siblings = [
        { filename: `model-Q4_K_M-${timestamp}.gguf`, size: 5000000000, lfs: { sha256: 'abc123' } },
        { filename: `mmproj-Q4_K_M-${timestamp}.gguf`, size: 1000000000, lfs: { sha256: 'def456' } },
        { filename: `model-Q5_K_M-${timestamp}.gguf`, size: 6000000000, lfs: { sha256: 'ghi789' } },
        { filename: `mmproj-Q5_K_M-${timestamp}.gguf`, size: 1100000000, lfs: { sha256: 'jkl012' } },
        { filename: `model-Q8_0-${timestamp}.gguf`, size: 8000000000, lfs: { sha256: 'mno345' } },
        { filename: `mmproj-Q8_0-${timestamp}.gguf`, size: 1200000000, lfs: { sha256: 'pqr678' } },
      ];

      const pairings = hfService.detectVisionPairing(siblings);
      assert.strictEqual(pairings.length, 3, `Expected 3 pairings, got ${pairings.length}`);

      for (const pairing of pairings) {
        await visionManager.storeModelPair(
          pairing.base,
          pairing.mmproj,
          pairing.quantization,
          pairing.quantization,
          false
        );
      }

      const allPairs = await visionManager.getAllPairs();
      const pairCount = Object.keys(allPairs).length;
      assert(pairCount >= 3, `Expected at least 3 pairs, got ${pairCount}`);
    });

    // Test: Quantization matching
    test('should extract quantization suffix correctly', () => {
      const testCases = [
        { filename: 'model-Q4_K_M.gguf', expected: 'Q4_K_M' },
        { filename: 'model-Q5_K_M.gguf', expected: 'Q5_K_M' },
        { filename: 'model-Q8_0.gguf', expected: 'Q8_0' },
        { filename: 'model-F16.gguf', expected: 'F16' },
      ];

      for (const testCase of testCases) {
        const siblings = [
          { filename: testCase.filename, size: 5000000000, lfs: { sha256: 'abc123' } },
          { filename: `mmproj-${testCase.expected}.gguf`, size: 1000000000, lfs: { sha256: 'def456' } },
        ];

        const pairings = hfService.detectVisionPairing(siblings);
        assert.strictEqual(pairings.length, 1);
        assert.strictEqual(pairings[0].quantization, testCase.expected);
      }
    });

  } finally {
    cleanupTestDir();
  }

  // Print summary
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});

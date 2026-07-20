/* eslint-env node */
/**
 * Integration test: Tokenize/Detokenize round-trip against real llama-server
 *
 * Verifies that for the running primary model, detokenize(tokenize(s)) === s
 * for a variety of UTF-8 strings, validating Requirement 17.4.
 *
 * Gated behind LLAMA_BIN env var. Run with:
 *   LLAMA_BIN=/path/to/llama-server mocha desktop/tests/integration/tokenize-detokenize-real.test.js --timeout 120000
 *
 * Requirements: 17.4 (Tokenize/detokenize round-trip)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { SlotManager } = require('../../model-slot-manager');
const { VramBudgetManager } = require('../../vram-budget-manager');
const { ModelConfigStore } = require('../../model-config-store');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

// Skip this test if LLAMA_BIN is not set
const LLAMA_BIN = process.env.LLAMA_BIN;
const skipTest = !LLAMA_BIN;

describe('Integration: Tokenize/Detokenize round-trip against real llama-server', function () {
  this.timeout(120000); // 2 minutes for real binary startup

  if (skipTest) {
    it('SKIPPED: LLAMA_BIN env var not set', () => {
      console.log('To run this test, set LLAMA_BIN=/path/to/llama-server');
    });
    return;
  }

  let slotManager;
  let vramBudgetManager;
  let modelConfigStore;
  let fixtureModelPath;

  before(async function () {
    // Verify llama-server binary exists
    if (!fs.existsSync(LLAMA_BIN)) {
      this.skip();
      return;
    }

    // Initialize managers
    vramBudgetManager = new VramBudgetManager();
    await vramBudgetManager.detect();

    // Create a mock model config store (in-memory)
    modelConfigStore = {
      get: () => null,
      getOrDefault: () => DEFAULT_ADVANCED_ARGS,
      set: () => {},
      delete: () => {},
      reconcile: () => {},
      listAll: () => ({}),
    };

    slotManager = new SlotManager({
      vramBudgetManager,
      modelConfigStore,
      logger: console,
    });

    await slotManager.init();

    // Try to find a fixture model or use a minimal one
    // For this test, we'll use a very small model if available
    // The test will look for a model in common locations
    const possiblePaths = [
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.cache', 'huggingface', 'hub'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'models'),
      '/tmp/models',
      'C:\\models',
    ];

    fixtureModelPath = null;
    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.gguf'));
        if (files.length > 0) {
          fixtureModelPath = path.join(dir, files[0]);
          break;
        }
      }
    }

    if (!fixtureModelPath) {
      console.warn('No fixture GGUF model found. Test will be skipped.');
      this.skip();
    }
  });

  after(async function () {
    if (slotManager) {
      await slotManager.stopAll();
    }
  });

  /**
   * Helper to make HTTP POST request to a slot endpoint
   * @param {number} port - The slot port
   * @param {string} path - The endpoint path (e.g., '/tokenize')
   * @param {object} body - The request body
   * @returns {Promise<object>} The parsed JSON response
   */
  function makeRequest(port, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  it('should round-trip simple ASCII strings', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const testStrings = [
        'Hello',
        'World',
        'Hello, World!',
        'The quick brown fox jumps over the lazy dog',
        'UPPERCASE',
        'lowercase',
        'MixedCase',
      ];

      for (const text of testStrings) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
        assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
        const detokenized = detokenizeResponse.content;

        // Verify round-trip
        assert.strictEqual(
          detokenized,
          text,
          `Round-trip failed for "${text}": got "${detokenized}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip Unicode strings', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const testStrings = [
        '你好世界',
        'Привет мир',
        'مرحبا بالعالم',
        'שלום עולם',
        '🌍🌎🌏',
        'Hello 世界 🌍',
      ];

      for (const text of testStrings) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
        assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
        const detokenized = detokenizeResponse.content;

        // Verify round-trip
        assert.strictEqual(
          detokenized,
          text,
          `Round-trip failed for "${text}": got "${detokenized}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip special characters and whitespace', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const testStrings = [
        '!@#$%^&*()',
        'line1\nline2',
        'tab\there',
        'quote"test\'quote',
        '[{()}]',
        'path/to/file.txt',
        'email@example.com',
        'https://example.com',
      ];

      for (const text of testStrings) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
        assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
        const detokenized = detokenizeResponse.content;

        // Verify round-trip
        assert.strictEqual(
          detokenized,
          text,
          `Round-trip failed for "${text}": got "${detokenized}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip JSON content', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const testStrings = [
        '{"key": "value"}',
        '[1, 2, 3, 4, 5]',
        '{"nested": {"object": true}}',
        '{"array": [1, "two", 3.0, null, true, false]}',
      ];

      for (const text of testStrings) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
        assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
        const detokenized = detokenizeResponse.content;

        // Verify round-trip
        assert.strictEqual(
          detokenized,
          text,
          `Round-trip failed for "${text}": got "${detokenized}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip code snippets', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const testStrings = [
        'function test() {\n  console.log("hello");\n}',
        'def hello():\n    print("world")',
        'SELECT * FROM users WHERE id = 1;',
        'const x = 42; // comment',
      ];

      for (const text of testStrings) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
        assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
        const detokenized = detokenizeResponse.content;

        // Verify round-trip
        assert.strictEqual(
          detokenized,
          text,
          `Round-trip failed for "${text}": got "${detokenized}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip empty string', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const text = '';

      // Tokenize
      const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
      assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
      const tokens = tokenizeResponse.tokens;

      // Detokenize
      const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
      assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
      const detokenized = detokenizeResponse.content;

      // Verify round-trip
      assert.strictEqual(detokenized, text, 'Empty string round-trip failed');
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip long strings', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      // Create a long string by repeating a pattern
      const pattern = 'The quick brown fox jumps over the lazy dog. ';
      const text = pattern.repeat(100); // ~4700 characters

      // Tokenize
      const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
      assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
      const tokens = tokenizeResponse.tokens;

      // Detokenize
      const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
      assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
      const detokenized = detokenizeResponse.content;

      // Verify round-trip
      assert.strictEqual(
        detokenized,
        text,
        `Long string round-trip failed: expected ${text.length} chars, got ${detokenized.length}`
      );
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should round-trip 1000 random UTF-8 strings', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      // Generate 1000 random UTF-8 strings
      const testStrings = [];
      for (let i = 0; i < 1000; i++) {
        // Generate random string with mix of ASCII, Unicode, and special chars
        let text = '';
        const length = Math.floor(Math.random() * 100) + 1; // 1-100 chars
        for (let j = 0; j < length; j++) {
          const charType = Math.random();
          if (charType < 0.5) {
            // ASCII
            text += String.fromCharCode(Math.floor(Math.random() * 128));
          } else if (charType < 0.8) {
            // Unicode
            text += String.fromCharCode(Math.floor(Math.random() * 0x10000));
          } else {
            // Special chars
            const specials = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`\n\t ';
            text += specials[Math.floor(Math.random() * specials.length)];
          }
        }
        testStrings.push(text);
      }

      let successCount = 0;
      let failureCount = 0;

      for (const text of testStrings) {
        try {
          // Tokenize
          const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: text });
          assert(Array.isArray(tokenizeResponse.tokens), 'Tokenize response should have tokens array');
          const tokens = tokenizeResponse.tokens;

          // Detokenize
          const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
          assert.strictEqual(typeof detokenizeResponse.content, 'string', 'Detokenize response should have content');
          const detokenized = detokenizeResponse.content;

          // Verify round-trip
          if (detokenized === text) {
            successCount++;
          } else {
            failureCount++;
            console.warn(
              `Round-trip mismatch for string ${successCount + failureCount}: expected "${text}", got "${detokenized}"`
            );
          }
        } catch (e) {
          failureCount++;
          console.warn(`Error processing string ${successCount + failureCount}: ${e.message}`);
        }
      }

      console.log(`Round-trip results: ${successCount} successes, ${failureCount} failures out of 1000`);
      assert.strictEqual(failureCount, 0, `Expected 0 failures, got ${failureCount}`);
    } finally {
      await slotManager.stopSlot(0);
    }
  });

  it('should maintain consistency across multiple round-trips', async function () {
    const slotConfig = {
      modelPath: fixtureModelPath,
      port: 13434,
      purpose: 'primary',
      advancedArgs: DEFAULT_ADVANCED_ARGS,
    };

    const startedSlot = await slotManager.startSlot(0, slotConfig);
    assert.strictEqual(startedSlot.status, 'running', 'Slot should be running');

    try {
      const text = 'The quick brown fox jumps over the lazy dog';

      // Perform multiple round-trips
      let current = text;
      for (let i = 0; i < 5; i++) {
        // Tokenize
        const tokenizeResponse = await makeRequest(13434, '/tokenize', { content: current });
        const tokens = tokenizeResponse.tokens;

        // Detokenize
        const detokenizeResponse = await makeRequest(13434, '/detokenize', { tokens });
        current = detokenizeResponse.content;

        // Verify consistency
        assert.strictEqual(
          current,
          text,
          `Round-trip ${i + 1} failed: expected "${text}", got "${current}"`
        );
      }
    } finally {
      await slotManager.stopSlot(0);
    }
  });
});

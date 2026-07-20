/* eslint-env node */
/**
 * Smoke test: Bundled grammars load in llama-server
 *
 * Verifies that each bundled .gbnf grammar file can be loaded and used by llama-server
 * without errors. This is a smoke test that validates the grammar files are syntactically
 * correct and accepted by llama-server.
 *
 * Gated behind LLAMA_BIN env var. Run with:
 *   LLAMA_BIN=/path/to/llama-server FIXTURE_MODEL=/path/to/model.gguf mocha desktop/tests/smoke/grammar-files-load.test.js --timeout 120000
 *
 * Requirements: 13.8 (Bundled grammars load in llama-server)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Skip this test if LLAMA_BIN is not set
const LLAMA_BIN = process.env.LLAMA_BIN;
const FIXTURE_MODEL = process.env.FIXTURE_MODEL;
const skipTest = !LLAMA_BIN || !FIXTURE_MODEL;

describe('Smoke: Bundled Grammars Load in llama-server', function () {
  this.timeout(120000); // 2 minutes per test

  // List of bundled grammar files to test
  const grammarFiles = ['json.gbnf', 'json-object.gbnf', 'python.gbnf', 'sql.gbnf', 'markdown.gbnf'];

  // Get the grammars directory relative to this test file
  const grammarsDir = path.join(__dirname, '../../grammars');

  before(function () {
    // Verify grammars directory exists
    if (!fs.existsSync(grammarsDir)) {
      this.skip();
      return;
    }

    // Verify all grammar files exist
    for (const grammarFile of grammarFiles) {
      const grammarPath = path.join(grammarsDir, grammarFile);
      if (!fs.existsSync(grammarPath)) {
        this.skip();
        return;
      }
    }
  });

  /**
   * Helper function to start llama-server with a grammar file
   * and verify it reaches the running state
   *
   * @param {string} grammarPath - Path to the grammar file
   * @param {number} port - Port to bind to
   * @returns {Promise<{process: ChildProcess, port: number}>}
   */
  async function startLlamaServerWithGrammar(grammarPath, port) {
    return new Promise((resolve, reject) => {
      const args = [
        '--model', FIXTURE_MODEL,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--grammar-file', grammarPath,
        '--ctx-size', '128', // Very small context for quick startup
        '--n-predict', '1', // Minimal prediction
      ];

      const process = spawn(LLAMA_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Collect stdout and stderr for debugging
      process.stdout.on('data', (data) => {
        stdout += data.toString();
        // Look for the "ready" message that indicates the server is listening
        if (stdout.includes('ready') || stdout.includes('listening') || stdout.includes('server is ready')) {
          if (!resolved) {
            resolved = true;
            resolve({ process, port });
          }
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Failed to spawn llama-server: ${err.message}`));
        }
      });

      process.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          const errorMsg = `llama-server exited with code ${code}`;
          const details = stderr ? `\nStderr: ${stderr.slice(-500)}` : '';
          reject(new Error(errorMsg + details));
        }
      });

      // Timeout after 60 seconds
      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          process.kill('SIGTERM');
          reject(new Error(`llama-server did not start within 60 seconds with grammar: ${path.basename(grammarPath)}`));
        }
      }, 60000);

      // Clear timeout if process exits or resolves
      process.on('exit', () => clearTimeout(timeoutHandle));
    });
  }

  /**
   * Test each grammar file (only if LLAMA_BIN and FIXTURE_MODEL are set)
   */
  if (LLAMA_BIN && FIXTURE_MODEL) {
    for (let i = 0; i < grammarFiles.length; i++) {
      const grammarFile = grammarFiles[i];
      const grammarPath = path.join(grammarsDir, grammarFile);
      const port = 13440 + i; // Use ports 13440-13444 for smoke tests

      it(`should load grammar file: ${grammarFile}`, async function () {
        let process = null;

        try {
          // Start llama-server with the grammar file
          const result = await startLlamaServerWithGrammar(grammarPath, port);
          process = result.process;

          // If we got here, the process started successfully with the grammar
          assert.ok(process, 'llama-server process should be created');
          assert.strictEqual(process.exitCode, null, 'llama-server should still be running');

          // Verify the grammar file is readable and non-empty
          const grammarContent = fs.readFileSync(grammarPath, 'utf8');
          assert.ok(grammarContent.length > 0, `Grammar file ${grammarFile} should not be empty`);
        } finally {
          // Clean up: terminate the process
          if (process) {
            process.kill('SIGTERM');
            // Wait a bit for graceful shutdown
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }
        }
      });
    }
  } else {
    it('SKIPPED: LLAMA_BIN or FIXTURE_MODEL env var not set (llama-server integration tests)', () => {
      console.log('To run llama-server integration tests, set:');
      console.log('  LLAMA_BIN=/path/to/llama-server');
      console.log('  FIXTURE_MODEL=/path/to/model.gguf');
    });
  }

  /**
   * Test that all grammar files exist and are readable
   */
  it('should have all bundled grammar files present and readable', function () {
    for (const grammarFile of grammarFiles) {
      const grammarPath = path.join(grammarsDir, grammarFile);

      // Verify file exists
      assert.ok(fs.existsSync(grammarPath), `Grammar file ${grammarFile} should exist at ${grammarPath}`);

      // Verify file is readable
      const content = fs.readFileSync(grammarPath, 'utf8');
      assert.ok(content.length > 0, `Grammar file ${grammarFile} should not be empty`);

      // Verify file contains GBNF syntax (basic check)
      assert.ok(
        content.includes(':='),
        `Grammar file ${grammarFile} should contain GBNF syntax (should have ':=' operator)`
      );
    }
  });

  /**
   * Test that grammar files are valid UTF-8
   */
  it('should have all grammar files in valid UTF-8 encoding', function () {
    for (const grammarFile of grammarFiles) {
      const grammarPath = path.join(grammarsDir, grammarFile);
      const buffer = fs.readFileSync(grammarPath);

      // Try to decode as UTF-8
      const content = buffer.toString('utf8');

      // Verify no replacement characters (which indicate invalid UTF-8)
      assert.ok(
        !content.includes('\ufffd'),
        `Grammar file ${grammarFile} should be valid UTF-8 (no replacement characters)`
      );
    }
  });
});


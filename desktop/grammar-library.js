/**
 * Grammar Library
 *
 * Manages bundled GBNF grammar files for grammar-constrained generation.
 * Preloads all built-in grammars at startup and provides access via get/has methods.
 *
 * Requirements: 13.1, 13.3
 */

const fs = require('fs');
const path = require('path');

/**
 * Custom error for grammar loading failures
 */
class GrammarLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GrammarLoadError';
  }
}

/**
 * Grammar Library class
 *
 * Manages bundled GBNF grammar files for grammar-constrained generation.
 * Preloads all built-in grammars at startup.
 */
class GrammarLibrary {
  /**
   * Constructor
   *
   * @param {Object} options - Configuration options
   * @param {string} options.grammarsDir - Path to the grammars directory
   */
  constructor({ grammarsDir }) {
    this.grammarsDir = grammarsDir;
    this.grammars = new Map(); // name -> content
    this.builtInNames = ['json', 'json-object', 'python', 'sql', 'markdown'];
  }

  /**
   * Preload all built-in grammars at startup
   *
   * Reads all built-in grammar files from disk and caches them in memory.
   * Throws GrammarLoadError if any file cannot be read.
   *
   * Requirements: 13.1, 13.3
   *
   * @returns {Promise<void>}
   * @throws {GrammarLoadError} If a grammar file cannot be read
   */
  async load() {
    for (const name of this.builtInNames) {
      const filename = `${name}.gbnf`;
      const filepath = path.join(this.grammarsDir, filename);

      try {
        const content = fs.readFileSync(filepath, 'utf8');
        this.grammars.set(name, content);
      } catch (err) {
        throw new GrammarLoadError(
          `Failed to load grammar file '${filename}': ${err.message}`
        );
      }
    }
  }

  /**
   * Get grammar content by name
   *
   * Returns the content of a grammar file by name.
   * Throws GrammarLoadError if the grammar is not found or cannot be read.
   *
   * Requirements: 13.1, 13.3
   *
   * @param {string} name - Grammar name ('json', 'json-object', 'python', 'sql', 'markdown')
   * @returns {string} Grammar file content
   * @throws {GrammarLoadError} If the grammar is not found or cannot be read
   */
  get(name) {
    if (!this.grammars.has(name)) {
      throw new GrammarLoadError(`Grammar '${name}' not found`);
    }

    return this.grammars.get(name);
  }

  /**
   * Check if a grammar exists
   *
   * @param {string} name - Grammar name
   * @returns {boolean} True if the grammar exists, false otherwise
   */
  has(name) {
    return this.grammars.has(name);
  }
}

module.exports = {
  GrammarLibrary,
  GrammarLoadError,
};

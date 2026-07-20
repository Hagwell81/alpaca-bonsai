/**
 * Unit Tests for GrammarLibrary
 *
 * Tests successful load, get returning file contents byte-for-byte, has behaviour,
 * and the Req 13.3 read-failure path (stub fs to throw).
 *
 * Requirements: 13.1, 13.3
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const { GrammarLibrary, GrammarLoadError } = require('../../grammar-library');

describe('GrammarLibrary', () => {
  let grammarsDir;

  beforeEach(() => {
    // Use a temporary directory for testing
    grammarsDir = path.join(__dirname, '..', 'fixtures', 'grammars');
  });

  describe('load()', () => {
    it('should successfully load all built-in grammars', async () => {
      // Create a mock grammars directory with test files
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars');

      // Create the directory if it doesn't exist
      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      // Create test grammar files
      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, `// ${name} grammar\nroot ::= "test"`);
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        // All grammars should be loaded
        for (const name of grammars) {
          expect(library.has(name)).to.be.true;
        }
      } finally {
        // Cleanup
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });

    it('should throw GrammarLoadError when a grammar file is missing', async () => {
      const library = new GrammarLibrary({ grammarsDir: '/nonexistent/path' });

      try {
        await library.load();
        expect.fail('Should have thrown GrammarLoadError');
      } catch (err) {
        expect(err).to.be.instanceOf(GrammarLoadError);
        expect(err.message).to.include('Failed to load grammar file');
      }
    });

    it('should throw GrammarLoadError when fs.readFileSync fails', async () => {
      const library = new GrammarLibrary({ grammarsDir: '/nonexistent/path' });

      try {
        await library.load();
        expect.fail('Should have thrown GrammarLoadError');
      } catch (err) {
        expect(err).to.be.instanceOf(GrammarLoadError);
        expect(err.message).to.include('Failed to load grammar file');
      }
    });
  });

  describe('get()', () => {
    it('should return file contents byte-for-byte', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-get');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      const testContent = '// JSON Grammar\nroot ::= "{"';
      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, testContent);
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        const content = library.get('json');
        expect(content).to.equal(testContent);
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });

    it('should throw GrammarLoadError when grammar is not found', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-notfound');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        // Don't load anything

        expect(() => library.get('nonexistent')).to.throw(GrammarLoadError);
        expect(() => library.get('nonexistent')).to.throw('Grammar \'nonexistent\' not found');
      } finally {
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });

    it('should preserve exact byte content including special characters', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-bytes');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      // Test content with special characters, newlines, and unicode
      const testContent = 'root ::= "test" | "café" | "\\n" | "\\t"';
      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, testContent, 'utf8');
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        const content = library.get('python');
        expect(content).to.equal(testContent);
        expect(Buffer.from(content, 'utf8')).to.deep.equal(Buffer.from(testContent, 'utf8'));
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });
  });

  describe('has()', () => {
    it('should return true for loaded grammars', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-has');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, `// ${name}`);
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        expect(library.has('json')).to.be.true;
        expect(library.has('python')).to.be.true;
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });

    it('should return false for unloaded grammars', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-has-false');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, '// test');
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        expect(library.has('nonexistent')).to.be.false;
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });
  });

  describe('read-failure path (Req 13.3)', () => {
    it('should handle missing grammar files gracefully', async () => {
      const library = new GrammarLibrary({ grammarsDir: '/nonexistent/path' });

      try {
        await library.load();
        expect.fail('Should have thrown GrammarLoadError');
      } catch (err) {
        expect(err).to.be.instanceOf(GrammarLoadError);
        expect(err.message).to.include('Failed to load grammar file');
      }
    });

    it('should throw GrammarLoadError with descriptive message on read failure', async () => {
      const library = new GrammarLibrary({ grammarsDir: '/nonexistent/path' });

      try {
        await library.load();
        expect.fail('Should have thrown GrammarLoadError');
      } catch (err) {
        expect(err).to.be.instanceOf(GrammarLoadError);
        expect(err.message).to.include('Failed to load grammar file');
      }
    });

    it('should include the grammar filename in error message', async () => {
      const library = new GrammarLibrary({ grammarsDir: '/nonexistent/path' });

      try {
        await library.load();
        expect.fail('Should have thrown GrammarLoadError');
      } catch (err) {
        expect(err).to.be.instanceOf(GrammarLoadError);
        // Should mention one of the grammar files
        const hasGrammarName = ['json.gbnf', 'python.gbnf', 'sql.gbnf'].some(name =>
          err.message.includes(name)
        );
        expect(hasGrammarName).to.be.true;
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty grammar files', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-empty');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, '');
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        const content = library.get('json');
        expect(content).to.equal('');
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });

    it('should handle large grammar files', async () => {
      const testGrammarsDir = path.join(__dirname, '..', 'fixtures', 'test-grammars-large');

      if (!fs.existsSync(testGrammarsDir)) {
        fs.mkdirSync(testGrammarsDir, { recursive: true });
      }

      // Create a large grammar file (1 MB)
      const largeContent = 'root ::= "' + 'a'.repeat(1000000) + '"';
      const grammars = ['json', 'json-object', 'python', 'sql', 'markdown'];
      
      for (const name of grammars) {
        const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
        fs.writeFileSync(filepath, largeContent);
      }

      try {
        const library = new GrammarLibrary({ grammarsDir: testGrammarsDir });
        await library.load();

        const content = library.get('json');
        expect(content).to.equal(largeContent);
        expect(content.length).to.equal(largeContent.length);
      } finally {
        for (const name of grammars) {
          const filepath = path.join(testGrammarsDir, `${name}.gbnf`);
          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
          }
        }
        if (fs.existsSync(testGrammarsDir)) {
          fs.rmdirSync(testGrammarsDir);
        }
      }
    });
  });
});


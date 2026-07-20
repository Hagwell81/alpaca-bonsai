/**
 * Property Test P14: buildArgs flag-value adjacency
 *
 * For any slotConfig, the output of buildArgs contains the numeric flags
 * (-c, -b, -ub, -np) each exactly once, and each is immediately followed
 * by its numeric value as a string.
 *
 * Validates: Requirements 9.5
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { buildArgs } = require('../../slot-args-builder');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

describe('P14: buildArgs flag-value adjacency', () => {
  /**
   * Generate a valid AdvancedArgs object for testing
   */
  function generateAdvancedArgs() {
    return fc.record({
      flashAttn: fc.boolean(),
      mmap: fc.boolean(),
      mlock: fc.boolean(),
      ctxSize: fc.integer({ min: 512, max: 32768 }),
      batchSize: fc.integer({ min: 32, max: 4096 }),
      ubatchSize: fc.integer({ min: 32, max: 4096 }),
      parallel: fc.integer({ min: 1, max: 16 }),
      tensorSplit: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 4 }),
      mainGpu: fc.integer({ min: 0, max: 8 }),
      splitMode: fc.constantFrom('none', 'layer', 'row'),
      rpc: fc.array(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1024, max: 65535 })
        ).map(([host, port]) => `${host}:${port}`),
        { maxLength: 4 }
      ),
      contBatching: fc.boolean(),
      sampling: fc.record({
        temp: fc.float({ min: 0.0, max: 2.0 }),
        topK: fc.integer({ min: 0, max: 1000 }),
        topP: fc.float({ min: 0.0, max: 1.0 }),
        repeatPenalty: fc.float({ min: 0.0, max: 2.0 }),
        presencePenalty: fc.float({ min: -2.0, max: 2.0 }),
        frequencyPenalty: fc.float({ min: -2.0, max: 2.0 }),
        seed: fc.integer({ min: -1, max: 2147483647 }),
      }),
      speculative: fc.record({
        enabled: fc.boolean(),
        draftModel: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { freq: 2 }),
        draftCtxSize: fc.integer({ min: 512, max: 8192 }),
      }),
    });
  }

  it('should have -c flag immediately followed by ctxSize value', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Find the -c flag
        const cIndex = argv.indexOf('-c');
        expect(cIndex).to.be.greaterThan(-1, '-c flag should be present');

        // Verify it's immediately followed by a value
        expect(cIndex + 1).to.be.lessThan(argv.length, '-c should be followed by a value');
        expect(argv[cIndex + 1]).to.equal(String(advancedArgs.ctxSize));
      }),
      { numRuns: 100 }
    );
  });

  it('should have -b flag immediately followed by batchSize value', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Find the -b flag
        const bIndex = argv.indexOf('-b');
        expect(bIndex).to.be.greaterThan(-1, '-b flag should be present');

        // Verify it's immediately followed by a value
        expect(bIndex + 1).to.be.lessThan(argv.length, '-b should be followed by a value');
        expect(argv[bIndex + 1]).to.equal(String(advancedArgs.batchSize));
      }),
      { numRuns: 100 }
    );
  });

  it('should have -ub flag immediately followed by ubatchSize value', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Find the -ub flag
        const ubIndex = argv.indexOf('-ub');
        expect(ubIndex).to.be.greaterThan(-1, '-ub flag should be present');

        // Verify it's immediately followed by a value
        expect(ubIndex + 1).to.be.lessThan(argv.length, '-ub should be followed by a value');
        expect(argv[ubIndex + 1]).to.equal(String(advancedArgs.ubatchSize));
      }),
      { numRuns: 100 }
    );
  });

  it('should have -np flag immediately followed by parallel value', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Find the -np flag
        const npIndex = argv.indexOf('-np');
        expect(npIndex).to.be.greaterThan(-1, '-np flag should be present');

        // Verify it's immediately followed by a value
        expect(npIndex + 1).to.be.lessThan(argv.length, '-np should be followed by a value');
        expect(argv[npIndex + 1]).to.equal(String(advancedArgs.parallel));
      }),
      { numRuns: 100 }
    );
  });

  it('should have each numeric flag appear exactly once', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Count occurrences of each flag
        const cCount = argv.filter(arg => arg === '-c').length;
        const bCount = argv.filter(arg => arg === '-b').length;
        const ubCount = argv.filter(arg => arg === '-ub').length;
        const npCount = argv.filter(arg => arg === '-np').length;

        expect(cCount).to.equal(1, '-c should appear exactly once');
        expect(bCount).to.equal(1, '-b should appear exactly once');
        expect(ubCount).to.equal(1, '-ub should appear exactly once');
        expect(npCount).to.equal(1, '-np should appear exactly once');
      }),
      { numRuns: 100 }
    );
  });

  it('should have numeric flags followed by valid numeric strings', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Verify each numeric flag is followed by a valid number string
        const cIndex = argv.indexOf('-c');
        const bIndex = argv.indexOf('-b');
        const ubIndex = argv.indexOf('-ub');
        const npIndex = argv.indexOf('-np');

        if (cIndex > -1) {
          const cValue = argv[cIndex + 1];
          expect(Number.isInteger(Number(cValue))).to.be.true;
          expect(Number(cValue)).to.equal(advancedArgs.ctxSize);
        }

        if (bIndex > -1) {
          const bValue = argv[bIndex + 1];
          expect(Number.isInteger(Number(bValue))).to.be.true;
          expect(Number(bValue)).to.equal(advancedArgs.batchSize);
        }

        if (ubIndex > -1) {
          const ubValue = argv[ubIndex + 1];
          expect(Number.isInteger(Number(ubValue))).to.be.true;
          expect(Number(ubValue)).to.equal(advancedArgs.ubatchSize);
        }

        if (npIndex > -1) {
          const npValue = argv[npIndex + 1];
          expect(Number.isInteger(Number(npValue))).to.be.true;
          expect(Number(npValue)).to.equal(advancedArgs.parallel);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should maintain adjacency across all purposes', () => {
    fc.assert(
      fc.property(
        generateAdvancedArgs(),
        fc.constantFrom('primary', 'secondary', 'vision', 'embedding', 'coding'),
        (advancedArgs, purpose) => {
          const slotConfig = {
            modelPath: '/path/to/model.gguf',
            mmprojPath: null,
            port: 13434,
            purpose,
            advancedArgs,
          };

          const argv = buildArgs(slotConfig);

          // Verify all numeric flags are present and adjacent to their values
          const cIndex = argv.indexOf('-c');
          const bIndex = argv.indexOf('-b');
          const ubIndex = argv.indexOf('-ub');
          const npIndex = argv.indexOf('-np');

          expect(cIndex).to.be.greaterThan(-1);
          expect(bIndex).to.be.greaterThan(-1);
          expect(ubIndex).to.be.greaterThan(-1);
          expect(npIndex).to.be.greaterThan(-1);

          // Verify adjacency
          expect(argv[cIndex + 1]).to.equal(String(advancedArgs.ctxSize));
          expect(argv[bIndex + 1]).to.equal(String(advancedArgs.batchSize));
          expect(argv[ubIndex + 1]).to.equal(String(advancedArgs.ubatchSize));
          expect(argv[npIndex + 1]).to.equal(String(advancedArgs.parallel));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not have numeric flags separated from their values by other flags', () => {
    fc.assert(
      fc.property(generateAdvancedArgs(), (advancedArgs) => {
        const slotConfig = {
          modelPath: '/path/to/model.gguf',
          mmprojPath: null,
          port: 13434,
          purpose: 'primary',
          advancedArgs,
        };

        const argv = buildArgs(slotConfig);

        // Helper to check that a flag is immediately followed by its value
        const checkAdjacency = (flag, expectedValue) => {
          const index = argv.indexOf(flag);
          if (index > -1) {
            expect(index + 1).to.be.lessThan(argv.length);
            expect(argv[index + 1]).to.equal(expectedValue);
            // Verify the next element is not another flag (starts with -)
            if (index + 2 < argv.length) {
              // The element after the value should either be another flag or end of array
              // This is just a sanity check
              expect(argv[index + 1]).to.not.match(/^-/);
            }
          }
        };

        checkAdjacency('-c', String(advancedArgs.ctxSize));
        checkAdjacency('-b', String(advancedArgs.batchSize));
        checkAdjacency('-ub', String(advancedArgs.ubatchSize));
        checkAdjacency('-np', String(advancedArgs.parallel));
      }),
      { numRuns: 100 }
    );
  });

  it('should handle edge case values correctly', () => {
    const edgeCases = [
      { ctxSize: 512, batchSize: 32, ubatchSize: 32, parallel: 1 },
      { ctxSize: 32768, batchSize: 4096, ubatchSize: 4096, parallel: 16 },
      { ctxSize: 1024, batchSize: 128, ubatchSize: 64, parallel: 2 },
    ];

    edgeCases.forEach((edgeCase) => {
      const advancedArgs = {
        ...DEFAULT_ADVANCED_ARGS,
        ...edgeCase,
      };

      const slotConfig = {
        modelPath: '/path/to/model.gguf',
        mmprojPath: null,
        port: 13434,
        purpose: 'primary',
        advancedArgs,
      };

      const argv = buildArgs(slotConfig);

      // Verify adjacency for edge cases
      const cIndex = argv.indexOf('-c');
      const bIndex = argv.indexOf('-b');
      const ubIndex = argv.indexOf('-ub');
      const npIndex = argv.indexOf('-np');

      expect(argv[cIndex + 1]).to.equal(String(edgeCase.ctxSize));
      expect(argv[bIndex + 1]).to.equal(String(edgeCase.batchSize));
      expect(argv[ubIndex + 1]).to.equal(String(edgeCase.ubatchSize));
      expect(argv[npIndex + 1]).to.equal(String(edgeCase.parallel));
    });
  });
});

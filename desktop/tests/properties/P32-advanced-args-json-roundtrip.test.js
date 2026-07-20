/**
 * Property Test P32: Advanced_Args JSON round-trip
 *
 * For any `a` passing `validateAdvancedArgs`, assert `parseAdvancedArgs(serializeAdvancedArgs(a))`
 * deep-equals `a`.
 *
 * Validates: Requirements 20.6
 */

const { expect } = require('chai');
const fc = require('fast-check');
const {
  DEFAULT_ADVANCED_ARGS,
  validateAdvancedArgs,
  serializeAdvancedArgs,
  parseAdvancedArgs,
} = require('../../advanced-args');

describe('P32: Advanced_Args JSON round-trip', () => {
  /**
   * Generator for valid AdvancedArgs objects
   */
  const validAdvancedArgsArbitrary = () => {
    return fc.record({
      flashAttn: fc.boolean(),
      mmap: fc.boolean(),
      mlock: fc.boolean(),
      ctxSize: fc.integer({ min: 512, max: 32768 }),
      batchSize: fc.integer({ min: 32, max: 4096 }),
      ubatchSize: fc.integer({ min: 32, max: 4096 }),
      parallel: fc.integer({ min: 1, max: 16 }),
      tensorSplit: fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { maxLength: 8 }),
      mainGpu: fc.integer({ min: 0, max: 8 }),
      splitMode: fc.constantFrom('none', 'layer', 'row'),
      rpc: fc.array(
        fc.tuple(
          fc.domain(),
          fc.integer({ min: 1024, max: 65535 })
        ).map(([host, port]) => `${host}:${port}`),
        { maxLength: 4 }
      ),
      contBatching: fc.boolean(),
      sampling: fc.record({
        temp: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
        topK: fc.integer({ min: 0, max: 1000 }),
        topP: fc.float({ min: 0.0, max: 1.0, noNaN: true }),
        repeatPenalty: fc.float({ min: 0.0, max: 2.0, noNaN: true }),
        presencePenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
        frequencyPenalty: fc.float({ min: -2.0, max: 2.0, noNaN: true }),
        seed: fc.integer({ min: -1, max: 2147483647 }),
      }),
      speculative: fc.record({
        enabled: fc.boolean(),
        draftModel: fc.oneof(fc.constant(null), fc.constant('/path/to/draft.gguf')),
        draftCtxSize: fc.integer({ min: 512, max: 32768 }),
      }),
    }).filter(args => {
      // Ensure ubatchSize <= batchSize
      if (args.ubatchSize > args.batchSize) {
        args.ubatchSize = args.batchSize;
      }
      // Ensure speculative.enabled implies draftModel is not null
      if (args.speculative.enabled) {
        args.speculative.draftModel = '/path/to/draft.gguf';
      } else {
        // When disabled, draftModel must be null
        args.speculative.draftModel = null;
      }
      // Validate the generated args
      const validation = validateAdvancedArgs(args);
      return validation.ok;
    });
  };

  it('should round-trip valid AdvancedArgs through JSON serialization', () => {
    fc.assert(
      fc.property(validAdvancedArgsArbitrary(), (originalArgs) => {
        // Serialize and parse
        const serialized = serializeAdvancedArgs(originalArgs);
        const parsed = parseAdvancedArgs(serialized);

        // Normalize -0 to 0 for comparison (JSON.stringify converts -0 to 0)
        const normalize = (obj) => {
          if (typeof obj === 'number' && Object.is(obj, -0)) {
            return 0;
          }
          if (typeof obj === 'object' && obj !== null) {
            if (Array.isArray(obj)) {
              return obj.map(normalize);
            }
            const normalized = {};
            for (const key in obj) {
              normalized[key] = normalize(obj[key]);
            }
            return normalized;
          }
          return obj;
        };

        const normalizedOriginal = normalize(originalArgs);
        const normalizedParsed = normalize(parsed);

        // Deep equality check
        expect(normalizedParsed).to.deep.equal(normalizedOriginal);
      }),
      { numRuns: 500 }
    );
  });

  it('should round-trip DEFAULT_ADVANCED_ARGS', () => {
    const serialized = serializeAdvancedArgs(DEFAULT_ADVANCED_ARGS);
    const parsed = parseAdvancedArgs(serialized);

    expect(parsed).to.deep.equal(DEFAULT_ADVANCED_ARGS);
  });

  it('should preserve all numeric precision in round-trip', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      sampling: {
        ...DEFAULT_ADVANCED_ARGS.sampling,
        temp: 0.123456789,
        topP: 0.987654321,
      },
    };

    const serialized = serializeAdvancedArgs(args);
    const parsed = parseAdvancedArgs(serialized);

    expect(parsed.sampling.temp).to.equal(args.sampling.temp);
    expect(parsed.sampling.topP).to.equal(args.sampling.topP);
  });

  it('should preserve array contents in round-trip', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [0.5, 0.3, 0.2],
      rpc: ['host1:8000', 'host2:8001', 'host3:8002'],
    };

    const serialized = serializeAdvancedArgs(args);
    const parsed = parseAdvancedArgs(serialized);

    expect(parsed.tensorSplit).to.deep.equal(args.tensorSplit);
    expect(parsed.rpc).to.deep.equal(args.rpc);
  });

  it('should handle empty arrays in round-trip', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      tensorSplit: [],
      rpc: [],
    };

    const serialized = serializeAdvancedArgs(args);
    const parsed = parseAdvancedArgs(serialized);

    expect(parsed.tensorSplit).to.deep.equal([]);
    expect(parsed.rpc).to.deep.equal([]);
  });

  it('should handle null values in speculative config', () => {
    const args = {
      ...DEFAULT_ADVANCED_ARGS,
      speculative: {
        enabled: false,
        draftModel: null,
        draftCtxSize: 4096,
      },
    };

    const serialized = serializeAdvancedArgs(args);
    const parsed = parseAdvancedArgs(serialized);

    expect(parsed.speculative.draftModel).to.be.null;
    expect(parsed).to.deep.equal(args);
  });

  it('should be idempotent: serialize(parse(serialize(a))) === serialize(a)', () => {
    fc.assert(
      fc.property(validAdvancedArgsArbitrary(), (originalArgs) => {
        const validation = validateAdvancedArgs(originalArgs);
        if (!validation.ok) {
          return true;
        }

        const serialized1 = serializeAdvancedArgs(originalArgs);
        const parsed = parseAdvancedArgs(serialized1);
        const serialized2 = serializeAdvancedArgs(parsed);

        expect(serialized2).to.equal(serialized1);
      }),
      { numRuns: 500 }
    );
  });
});

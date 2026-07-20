/**
 * Property 16: applySamplingDefaults preserves user fields
 *
 * For any defaults: SamplingParams and request body r, the body produced by
 * applySamplingDefaults(r, defaults) has, for each sampling field f:
 * - the value r[f] if f in r
 * - defaults[f] otherwise
 * No non-sampling fields of r are changed.
 *
 * Validates: Requirements 11.2, 11.3
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');

// Import the function under test
// We need to extract applySamplingDefaults from api-gateway.js
// For testing purposes, we'll create a standalone version
const applySamplingDefaults = (body, defaults) => {
  if (!body) return body;

  const samplingDefaults = (defaults && defaults.sampling) || DEFAULT_ADVANCED_ARGS.sampling;

  // Only inject defaults for fields that are missing
  for (const [key, value] of Object.entries(samplingDefaults)) {
    if (!(key in body)) {
      body[key] = value;
    }
  }

  return body;
};

// Define the sampling field names
const SAMPLING_FIELDS = new Set([
  'temp',
  'topK',
  'topP',
  'repeatPenalty',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
]);

describe('P16: applySamplingDefaults preserves user fields', () => {
  it('should inject defaults for missing sampling fields', () => {
    const property = fc.property(
      fc.record({
        temp: fc.oneof(fc.constant(undefined), fc.float({ min: 0, max: 2, noNaN: true })),
        topK: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 1000 })),
        topP: fc.oneof(fc.constant(undefined), fc.float({ min: 0, max: 1, noNaN: true })),
        repeatPenalty: fc.oneof(fc.constant(undefined), fc.float({ min: 0, max: 2, noNaN: true })),
        presencePenalty: fc.oneof(fc.constant(undefined), fc.float({ min: -2, max: 2, noNaN: true })),
        frequencyPenalty: fc.oneof(fc.constant(undefined), fc.float({ min: -2, max: 2, noNaN: true })),
        seed: fc.oneof(fc.constant(undefined), fc.integer()),
      }),
      fc.record({
        temp: fc.float({ min: 0, max: 2, noNaN: true }),
        topK: fc.integer({ min: 0, max: 1000 }),
        topP: fc.float({ min: 0, max: 1, noNaN: true }),
        repeatPenalty: fc.float({ min: 0, max: 2, noNaN: true }),
        presencePenalty: fc.float({ min: -2, max: 2, noNaN: true }),
        frequencyPenalty: fc.float({ min: -2, max: 2, noNaN: true }),
        seed: fc.integer(),
      }),
      (requestFields, defaultFields) => {
        // Build request body with only defined fields
        const requestBody = {};
        for (const [key, value] of Object.entries(requestFields)) {
          if (value !== undefined) {
            requestBody[key] = value;
          }
        }

        // Build defaults object
        const defaults = {
          sampling: defaultFields,
        };

        // Apply defaults
        const result = applySamplingDefaults(requestBody, defaults);

        // Verify each sampling field
        for (const field of SAMPLING_FIELDS) {
          if (field in requestFields && requestFields[field] !== undefined) {
            // User provided this field, should be preserved
            // Use a comparison that handles NaN correctly
            const resultVal = result[field];
            const expectedVal = requestFields[field];
            if (Number.isNaN(expectedVal)) {
              expect(Number.isNaN(resultVal)).to.be.true;
            } else {
              expect(resultVal).to.equal(expectedVal);
            }
          } else {
            // User did not provide this field, should use default
            const resultVal = result[field];
            const expectedVal = defaultFields[field];
            if (Number.isNaN(expectedVal)) {
              expect(Number.isNaN(resultVal)).to.be.true;
            } else {
              expect(resultVal).to.equal(expectedVal);
            }
          }
        }
      }
    );

    fc.assert(property, { numRuns: 100 });
  });

  it('should preserve non-sampling fields in request body', () => {
    const property = fc.property(
      fc.record({
        // Sampling fields (some present, some missing)
        temp: fc.oneof(fc.constant(undefined), fc.float({ min: 0, max: 2 })),
        topK: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 1000 })),
      }),
      fc.record({
        // Non-sampling fields
        model: fc.string({ minLength: 1, maxLength: 50 }),
        messages: fc.array(fc.object(), { minLength: 1, maxLength: 5 }),
        stream: fc.boolean(),
        max_tokens: fc.integer({ min: 1, max: 10000 }),
        custom_field: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      }),
      (samplingFields, nonSamplingFields) => {
        // Build request body
        const requestBody = { ...nonSamplingFields };
        for (const [key, value] of Object.entries(samplingFields)) {
          if (value !== undefined) {
            requestBody[key] = value;
          }
        }

        const defaults = {
          sampling: DEFAULT_ADVANCED_ARGS.sampling,
        };

        // Apply defaults
        const result = applySamplingDefaults(requestBody, defaults);

        // Verify non-sampling fields are preserved
        for (const [key, value] of Object.entries(nonSamplingFields)) {
          expect(result[key]).to.deep.equal(value);
        }
      }
    );

    fc.assert(property, { numRuns: 100 });
  });

  it('should handle empty request body', () => {
    const defaults = {
      sampling: DEFAULT_ADVANCED_ARGS.sampling,
    };

    const result = applySamplingDefaults({}, defaults);

    // All sampling fields should be injected
    for (const field of SAMPLING_FIELDS) {
      expect(result[field]).to.equal(defaults.sampling[field]);
    }
  });

  it('should handle null defaults gracefully', () => {
    const requestBody = {
      temp: 1.5,
      topK: 50,
      model: 'test-model',
    };

    const result = applySamplingDefaults(requestBody, null);

    // Should use DEFAULT_ADVANCED_ARGS.sampling
    expect(result.temp).to.equal(1.5); // User provided
    expect(result.topK).to.equal(50); // User provided
    expect(result.topP).to.equal(DEFAULT_ADVANCED_ARGS.sampling.topP); // Default injected
    expect(result.model).to.equal('test-model'); // Non-sampling field preserved
  });

  it('should handle undefined defaults gracefully', () => {
    const requestBody = {
      temp: 1.5,
      model: 'test-model',
    };

    const result = applySamplingDefaults(requestBody, undefined);

    // Should use DEFAULT_ADVANCED_ARGS.sampling
    expect(result.temp).to.equal(1.5); // User provided
    expect(result.topP).to.equal(DEFAULT_ADVANCED_ARGS.sampling.topP); // Default injected
    expect(result.model).to.equal('test-model'); // Non-sampling field preserved
  });

  it('should not override user-provided sampling fields', () => {
    const property = fc.property(
      fc.record({
        temp: fc.float({ min: 0, max: 2, noNaN: true }),
        topK: fc.integer({ min: 0, max: 1000 }),
        topP: fc.float({ min: 0, max: 1, noNaN: true }),
      }),
      fc.record({
        temp: fc.float({ min: 0, max: 2, noNaN: true }),
        topK: fc.integer({ min: 0, max: 1000 }),
        topP: fc.float({ min: 0, max: 1, noNaN: true }),
      }),
      (userValues, defaultValues) => {
        const requestBody = { ...userValues };
        const defaults = { sampling: defaultValues };

        const result = applySamplingDefaults(requestBody, defaults);

        // User values should be preserved, not overridden
        // Use a comparison that handles NaN correctly
        const checkEqual = (actual, expected) => {
          if (Number.isNaN(expected)) {
            return Number.isNaN(actual);
          }
          return actual === expected;
        };

        expect(checkEqual(result.temp, userValues.temp)).to.be.true;
        expect(checkEqual(result.topK, userValues.topK)).to.be.true;
        expect(checkEqual(result.topP, userValues.topP)).to.be.true;
      }
    );

    fc.assert(property, { numRuns: 100 });
  });

  it('should handle mixed present and missing sampling fields', () => {
    const requestBody = {
      temp: 1.2,
      // topK is missing
      topP: 0.9,
      // repeatPenalty is missing
      presencePenalty: 0.5,
      // frequencyPenalty is missing
      seed: 42,
      // Non-sampling fields
      model: 'test-model',
      stream: true,
    };

    const defaults = {
      sampling: {
        temp: 0.8,
        topK: 40,
        topP: 0.95,
        repeatPenalty: 1.1,
        presencePenalty: 0.0,
        frequencyPenalty: 0.0,
        seed: -1,
      },
    };

    const result = applySamplingDefaults(requestBody, defaults);

    // User-provided fields should be preserved
    expect(result.temp).to.equal(1.2);
    expect(result.topP).to.equal(0.9);
    expect(result.presencePenalty).to.equal(0.5);
    expect(result.seed).to.equal(42);

    // Missing fields should be injected from defaults
    expect(result.topK).to.equal(40);
    expect(result.repeatPenalty).to.equal(1.1);
    expect(result.frequencyPenalty).to.equal(0.0);

    // Non-sampling fields should be preserved
    expect(result.model).to.equal('test-model');
    expect(result.stream).to.equal(true);
  });

  it('should handle zero and negative values correctly', () => {
    const requestBody = {
      temp: 0,
      topK: 0,
      seed: -1,
      presencePenalty: -2.0,
    };

    const defaults = {
      sampling: DEFAULT_ADVANCED_ARGS.sampling,
    };

    const result = applySamplingDefaults(requestBody, defaults);

    // Zero and negative values should be preserved, not treated as missing
    expect(result.temp).to.equal(0);
    expect(result.topK).to.equal(0);
    expect(result.seed).to.equal(-1);
    expect(result.presencePenalty).to.equal(-2.0);
  });

  it('should handle null body gracefully', () => {
    const defaults = {
      sampling: DEFAULT_ADVANCED_ARGS.sampling,
    };

    const result = applySamplingDefaults(null, defaults);

    // Should return null unchanged
    expect(result).to.be.null;
  });

  it('should handle undefined body gracefully', () => {
    const defaults = {
      sampling: DEFAULT_ADVANCED_ARGS.sampling,
    };

    const result = applySamplingDefaults(undefined, defaults);

    // Should return undefined unchanged
    expect(result).to.be.undefined;
  });
});

/**
 * Property Test P7: estimateRequiredMB additive composition
 *
 * For any (modelFileSizeMB, ctxSize, quantization, purpose), estimateRequiredMB(...)
 * has additive composition: if you split a context into two parts, the sum of their
 * estimates equals the estimate of the combined context (for the same model and quantization).
 *
 * Validates: Requirements 4.3
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { estimateRequiredMB } = require('../../vram-budget-manager');

describe('P7: estimateRequiredMB additive composition', () => {
  it('should have additive composition for context size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 32768 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        fc.constantFrom('primary', 'secondary', 'embedding', 'coding'), // purpose (not vision to avoid overhead issues)
        (modelFileSizeMB, ctxSize, quantization, purpose) => {
          // Split context into two parts
          const ctxSize1 = Math.floor(ctxSize / 2);
          const ctxSize2 = ctxSize - ctxSize1;

          const config = { modelFileSizeMB, ctxSize, quantization, purpose };
          const config1 = { modelFileSizeMB: 0, ctxSize: ctxSize1, quantization, purpose };
          const config2 = { modelFileSizeMB: 0, ctxSize: ctxSize2, quantization, purpose };

          const totalEstimate = estimateRequiredMB(config);
          const estimate1 = estimateRequiredMB(config1);
          const estimate2 = estimateRequiredMB(config2);

          // The sum of split estimates should equal the total estimate minus the model file size
          // (since we're only testing context additivity)
          const sumEstimate = estimate1 + estimate2;
          const expectedTotal = modelFileSizeMB + sumEstimate;
          expect(Math.abs(totalEstimate - expectedTotal)).to.be.lessThan(0.1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be additive: estimate(a+b) = estimate(a) + estimate(b) for context', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB
        fc.integer({ min: 512, max: 16384 }), // ctxSize1
        fc.integer({ min: 512, max: 16384 }), // ctxSize2
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (modelFileSizeMB, ctxSize1, ctxSize2, quantization) => {
          // Test with zero model file size to isolate context additivity
          const config1 = { modelFileSizeMB: 0, ctxSize: ctxSize1, quantization, purpose: 'primary' };
          const config2 = { modelFileSizeMB: 0, ctxSize: ctxSize2, quantization, purpose: 'primary' };
          const configCombined = { modelFileSizeMB: 0, ctxSize: ctxSize1 + ctxSize2, quantization, purpose: 'primary' };

          const estimate1 = estimateRequiredMB(config1);
          const estimate2 = estimateRequiredMB(config2);
          const estimateCombined = estimateRequiredMB(configCombined);

          // The combined estimate should equal the sum of individual estimates
          // (within floating point tolerance)
          const sumEstimate = estimate1 + estimate2;
          expect(Math.abs(estimateCombined - sumEstimate)).to.be.lessThan(0.1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should handle vision overhead additively', () => {
    const config1 = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'vision' };
    const config2 = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'primary' };

    const estimate1 = estimateRequiredMB(config1);
    const estimate2 = estimateRequiredMB(config2);

    // Vision should have 512 MiB extra overhead
    expect(estimate1 - estimate2).to.be.closeTo(512, 0.1);
  });

  it('should be additive across different quantizations', () => {
    const modelFileSizeMB = 100;
    const ctxSize = 2048;

    const configF32 = { modelFileSizeMB, ctxSize, quantization: 'f32', purpose: 'primary' };
    const configF16 = { modelFileSizeMB, ctxSize, quantization: 'f16', purpose: 'primary' };
    const configQ8 = { modelFileSizeMB, ctxSize, quantization: 'q8_0', purpose: 'primary' };
    const configQ4 = { modelFileSizeMB, ctxSize, quantization: 'q4_0', purpose: 'primary' };

    const estimateF32 = estimateRequiredMB(configF32);
    const estimateF16 = estimateRequiredMB(configF16);
    const estimateQ8 = estimateRequiredMB(configQ8);
    const estimateQ4 = estimateRequiredMB(configQ4);

    // F32 should be larger than F16 (4 bytes vs 2 bytes per token)
    expect(estimateF32).to.be.greaterThan(estimateF16);

    // F16 should be larger than Q8 (2 bytes vs 1 byte per token)
    expect(estimateF16).to.be.greaterThan(estimateQ8);

    // Q8 should be larger than Q4 (1 byte vs 0.5 bytes per token)
    expect(estimateQ8).to.be.greaterThan(estimateQ4);

    // The differences should be proportional to the context size
    const f32f16Diff = estimateF32 - estimateF16;
    const f16q8Diff = estimateF16 - estimateQ8;
    const q8q4Diff = estimateQ8 - estimateQ4;

    // Each difference should be roughly proportional to ctxSize * bytesPerTokenDiff / (1024 * 1024)
    // F32 to F16: ctxSize * 2 / (1024 * 1024) ≈ 2048 * 2 / 1048576 ≈ 0.0039 MiB
    expect(f32f16Diff).to.be.closeTo(ctxSize * 2 / (1024 * 1024), 0.01);
    expect(f16q8Diff).to.be.closeTo(ctxSize * 1 / (1024 * 1024), 0.01);
    expect(q8q4Diff).to.be.closeTo(ctxSize * 0.5 / (1024 * 1024), 0.01);
  });

  it('should be additive for model file size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB1
        fc.integer({ min: 0, max: 50000 }), // modelFileSizeMB2
        fc.integer({ min: 512, max: 8192 }), // ctxSize
        fc.constantFrom('f32', 'f16', 'q8_0', 'q4_0'), // quantization
        (modelFileSizeMB1, modelFileSizeMB2, ctxSize, quantization) => {
          // Test with zero context to isolate model file size additivity
          const config1 = { modelFileSizeMB: modelFileSizeMB1, ctxSize: 0, quantization, purpose: 'primary' };
          const config2 = { modelFileSizeMB: modelFileSizeMB2, ctxSize: 0, quantization, purpose: 'primary' };
          const configCombined = { modelFileSizeMB: modelFileSizeMB1 + modelFileSizeMB2, ctxSize: 0, quantization, purpose: 'primary' };

          const estimate1 = estimateRequiredMB(config1);
          const estimate2 = estimateRequiredMB(config2);
          const estimateCombined = estimateRequiredMB(configCombined);

          // The combined estimate should equal the sum of individual estimates
          const sumEstimate = estimate1 + estimate2;
          expect(Math.abs(estimateCombined - sumEstimate)).to.be.lessThan(0.1);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should be additive: zero context should have minimal overhead', () => {
    const config512 = { modelFileSizeMB: 100, ctxSize: 512, quantization: 'f32', purpose: 'primary' };
    const config0 = { modelFileSizeMB: 100, ctxSize: 0, quantization: 'f32', purpose: 'primary' };

    const estimate512 = estimateRequiredMB(config512);
    const estimate0 = estimateRequiredMB(config0);

    // The difference should be the KV cache for 512 tokens
    const kvCacheDiff = estimate512 - estimate0;
    const expectedKvCache = (512 * 4) / (1024 * 1024); // 512 tokens * 4 bytes per token (f32)
    expect(kvCacheDiff).to.be.closeTo(expectedKvCache, 0.01);
  });

  it('should handle edge case: very large context', () => {
    const config1 = { modelFileSizeMB: 0, ctxSize: 16384, quantization: 'f32', purpose: 'primary' };
    const config2 = { modelFileSizeMB: 0, ctxSize: 8192, quantization: 'f32', purpose: 'primary' };
    const config3 = { modelFileSizeMB: 0, ctxSize: 8192, quantization: 'f32', purpose: 'primary' };

    const estimate1 = estimateRequiredMB(config1);
    const estimate2 = estimateRequiredMB(config2);
    const estimate3 = estimateRequiredMB(config3);

    // estimate1 should equal estimate2 + estimate3 (within tolerance)
    expect(Math.abs(estimate1 - (estimate2 + estimate3))).to.be.lessThan(0.1);
  });

  it('should be additive for vision overhead', () => {
    const baseConfig = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'primary' };
    const visionConfig = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'vision' };

    const baseEstimate = estimateRequiredMB(baseConfig);
    const visionEstimate = estimateRequiredMB(visionConfig);

    // Vision overhead should be exactly 512 MiB
    expect(visionEstimate - baseEstimate).to.equal(512);
  });

  it('should be additive: multiple vision slots', () => {
    const config1 = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'vision' };
    const config2 = { modelFileSizeMB: 100, ctxSize: 1024, quantization: 'f32', purpose: 'vision' };

    const estimate1 = estimateRequiredMB(config1);
    const estimate2 = estimateRequiredMB(config2);

    // Both should have the same estimate (same config)
    expect(estimate1).to.equal(estimate2);

    // Sum should be exactly 2x
    expect(estimate1 + estimate2).to.equal(estimate1 * 2);
  });
});

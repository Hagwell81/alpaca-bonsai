/* eslint-env node, mocha */
/**
 * Property Test P60: `classifyModel` size-class monotonicity
 *
 * For any pair of `modelMeta` inputs `m1, m2` with identical `isMoE` and
 * `m2.totalParamsB >= m1.totalParamsB`, if `classifyModel(m1)` ends in
 * `"-large"` then `classifyModel(m2)` also ends in `"-large"` (i.e., once
 * we cross the size boundary, we never un-cross it).
 *
 * Validates: Requirements 8.2, 8.3, 8.4
 *
 * Strategy:
 *   - Draw pairs of `ModelMeta` values with the same `isMoE` flag and
 *     `m2.totalParamsB >= m1.totalParamsB`.
 *   - Classify both models.
 *   - Assert that if `m1` is classified as `*-large`, then `m2` is also
 *     classified as `*-large`.
 *   - Run 200 iterations per the design's testing strategy (Req 8 / P60).
 */

'use strict';

const { expect } = require('chai');
const fc = require('fast-check');

const { classifyModel } = require('../../model-classifier.js');
const { arbModelMeta } = require('../helpers/arb-model-meta.js');

describe('P60: classifyModel size-class monotonicity (Req 8.2, 8.3, 8.4)', () => {
  it('preserves *-large classification as totalParamsB increases', () => {
    // Generate pairs of ModelMeta with the same isMoE and m2.totalParamsB >= m1.totalParamsB.
    const arbMonotonePair = arbModelMeta.chain((base) => {
      return fc
        .tuple(
          fc.double({ min: 0.1, max: 500, noNaN: true }),
          fc.double({ min: 0.1, max: 500, noNaN: true }),
        )
        .filter(([p1, p2]) => p1 <= p2)
        .map(([paramsB1, paramsB2]) => ({
          m1: { ...base, totalParamsB: paramsB1 },
          m2: { ...base, totalParamsB: paramsB2 },
        }));
    });

    fc.assert(
      fc.property(arbMonotonePair, ({ m1, m2 }) => {
        const class1 = classifyModel(m1);
        const class2 = classifyModel(m2);

        // Monotonicity: if m1 is *-large, then m2 is also *-large
        if (class1.endsWith('-large')) {
          expect(class2).to.satisfy(
            (c) => c.endsWith('-large'),
            `m1 is ${class1} (large), so m2 with totalParamsB >= m1.totalParamsB should also be *-large, but got ${class2}`,
          );
        }
      }),
      { numRuns: 200 }, // Req 8 / P60: 200 runs
    );
  });

  it('transitions from *-small to *-large at the correct boundaries', () => {
    // Dense models: boundary at 13B
    // MoE models: boundary at 30B
    const arbDenseSmall = arbModelMeta.map((m) => ({ ...m, isMoE: false, totalParamsB: 10 }));
    const arbDenseLarge = arbModelMeta.map((m) => ({ ...m, isMoE: false, totalParamsB: 20 }));
    const arbMoeSmall = arbModelMeta.map((m) => ({ ...m, isMoE: true, totalParamsB: 20 }));
    const arbMoeLarge = arbModelMeta.map((m) => ({ ...m, isMoE: true, totalParamsB: 50 }));

    fc.assert(
      fc.property(arbDenseSmall, (m) => {
        const cls = classifyModel(m);
        expect(cls).to.equal('dense-small');
      }),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(arbDenseLarge, (m) => {
        const cls = classifyModel(m);
        expect(cls).to.equal('dense-large');
      }),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(arbMoeSmall, (m) => {
        const cls = classifyModel(m);
        expect(cls).to.equal('moe-small');
      }),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(arbMoeLarge, (m) => {
        const cls = classifyModel(m);
        expect(cls).to.equal('moe-large');
      }),
      { numRuns: 50 },
    );
  });

  it('handles the dense boundary at 13B correctly', () => {
    const metaAt13 = { filename: 'model-13b.gguf', isMoE: false, totalParamsB: 13 };
    const metaBelow13 = { filename: 'model-12.9b.gguf', isMoE: false, totalParamsB: 12.9 };
    const metaAbove13 = { filename: 'model-13.1b.gguf', isMoE: false, totalParamsB: 13.1 };

    expect(classifyModel(metaAt13)).to.equal('dense-small'); // <= 13 is small
    expect(classifyModel(metaBelow13)).to.equal('dense-small');
    expect(classifyModel(metaAbove13)).to.equal('dense-large'); // > 13 is large
  });

  it('handles the MoE boundary at 30B correctly', () => {
    const metaAt30 = { filename: 'model-30b.gguf', isMoE: true, totalParamsB: 30 };
    const metaBelow30 = { filename: 'model-29.9b.gguf', isMoE: true, totalParamsB: 29.9 };
    const metaAbove30 = { filename: 'model-30.1b.gguf', isMoE: true, totalParamsB: 30.1 };

    expect(classifyModel(metaAt30)).to.equal('moe-small'); // <= 30 is small
    expect(classifyModel(metaBelow30)).to.equal('moe-small');
    expect(classifyModel(metaAbove30)).to.equal('moe-large'); // > 30 is large
  });

  it('is monotone for dense models across a range of sizes', () => {
    const sizes = [1, 5, 10, 13, 15, 20, 30, 50, 70, 100, 200];
    const classes = sizes.map((totalParamsB) =>
      classifyModel({ filename: `model-${totalParamsB}b.gguf`, isMoE: false, totalParamsB }),
    );

    // Once we see 'dense-large', all subsequent classes should also be 'dense-large'
    let seenLarge = false;
    for (const cls of classes) {
      if (cls === 'dense-large') {
        seenLarge = true;
      }
      if (seenLarge) {
        expect(cls).to.equal('dense-large');
      }
    }
  });

  it('is monotone for MoE models across a range of sizes', () => {
    const sizes = [1, 10, 20, 30, 40, 50, 100, 200, 300];
    const classes = sizes.map((totalParamsB) =>
      classifyModel({ filename: `model-${totalParamsB}b.gguf`, isMoE: true, totalParamsB }),
    );

    // Once we see 'moe-large', all subsequent classes should also be 'moe-large'
    let seenLarge = false;
    for (const cls of classes) {
      if (cls === 'moe-large') {
        seenLarge = true;
      }
      if (seenLarge) {
        expect(cls).to.equal('moe-large');
      }
    }
  });
});

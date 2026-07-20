/**
 * Property Test P13: buildArgs matches the flag contribution table
 *
 * For each row of the flag contribution table, verify that:
 * - When the input condition is true, the corresponding flag(s) appear in the output
 * - When the input condition is false, the corresponding flag(s) do not appear
 *
 * Flag contribution table:
 * | Field                   | Contribution                                        | Req   |
 * | ----------------------- | --------------------------------------------------- | ----- |
 * | flashAttn == true       | ['--flash-attn']                                    | 9.2   |
 * | mmap == false           | ['--no-mmap'] (no flag when true)                   | 9.3   |
 * | mlock == true           | ['--mlock']                                         | 9.4   |
 * | ctxSize                 | ['-c', String(ctxSize)]                             | 9.5   |
 * | batchSize               | ['-b', String(batchSize)]                           | 9.5   |
 * | ubatchSize              | ['-ub', String(ubatchSize)]                         | 9.5   |
 * | parallel                | ['-np', String(parallel)]                           | 9.5   |
 * | tensorSplit.length > 0  | ['--tensor-split', tensorSplit.join(',')]           | 10.2  |
 * | mainGpu >= 0            | ['--main-gpu', String(mainGpu)]                     | 10.3  |
 * | splitMode (always)      | ['--split-mode', splitMode]                         | 10.4  |
 * | rpc.length > 0          | ['--rpc', rpc.join(',')]                            | 10.5  |
 * | contBatching == true    | ['--cont-batching']                                 | 10.6  |
 * | contBatching == false   | ['--no-cont-batching']                              | 10.6  |
 * | speculative.enabled     | ['-md', draftModel, '-cd', String(draftCtxSize)]    | 12.2  |
 * | purpose == 'embedding'  | ['--embedding', '--pooling', 'mean']                | 16.2  |
 * | mmprojPath != null      | ['--mmproj', mmprojPath]                            | legacy |
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 10.2, 10.3, 10.4, 10.5, 10.6, 12.2, 16.2
 */

const { expect } = require('chai');
const fc = require('fast-check');
const { buildArgs } = require('../../slot-args-builder');
const { DEFAULT_ADVANCED_ARGS } = require('../../advanced-args');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Helper to check if a flag and its value appear consecutively in argv
 */
function hasConsecutiveFlag(argv, flag, value) {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === flag && argv[i + 1] === value) {
      return true;
    }
  }
  return false;
}

/**
 * Helper to check if a flag appears in argv
 */
function hasFlag(argv, flag) {
  return argv.includes(flag);
}

/**
 * Helper to find the value following a flag
 */
function getFlagValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx === argv.length - 1) {
    return null;
  }
  return argv[idx + 1];
}

describe('P13: buildArgs matches the flag contribution table', () => {
  // Helper to create a minimal valid SlotConfig
  function createSlotConfig(overrides = {}) {
    const {
      modelPath = '/path/to/model.gguf',
      mmprojPath = null,
      port = 13434,
      purpose = 'primary',
      ...advancedArgsOverrides
    } = overrides;

    return {
      modelPath,
      mmprojPath,
      port,
      purpose,
      advancedArgs: {
        ...DEFAULT_ADVANCED_ARGS,
        ...advancedArgsOverrides,
      },
    };
  }

  describe('Req 9.2: flashAttn flag', () => {
    it('should include --flash-attn when flashAttn == true', () => {
      const config = createSlotConfig({ flashAttn: true });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--flash-attn')).to.be.true;
    });

    it('should not include --flash-attn when flashAttn == false', () => {
      const config = createSlotConfig({ flashAttn: false });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--flash-attn')).to.be.false;
    });

    it('should be deterministic across multiple calls', () => {
      const config = createSlotConfig({ flashAttn: true });
      const argv1 = buildArgs(config);
      const argv2 = buildArgs(config);
      expect(hasFlag(argv1, '--flash-attn')).to.equal(hasFlag(argv2, '--flash-attn'));
    });
  });

  describe('Req 9.3: mmap flag', () => {
    it('should include --no-mmap when mmap == false', () => {
      const config = createSlotConfig({ mmap: false });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--no-mmap')).to.be.true;
    });

    it('should not include --no-mmap when mmap == true', () => {
      const config = createSlotConfig({ mmap: true });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--no-mmap')).to.be.false;
    });

    it('should not include --mmap flag (upstream default)', () => {
      const config = createSlotConfig({ mmap: true });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--mmap')).to.be.false;
    });
  });

  describe('Req 9.4: mlock flag', () => {
    it('should include --mlock when mlock == true', () => {
      const config = createSlotConfig({ mlock: true });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--mlock')).to.be.true;
    });

    it('should not include --mlock when mlock == false', () => {
      const config = createSlotConfig({ mlock: false });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--mlock')).to.be.false;
    });
  });

  describe('Req 9.5: context and batch size flags', () => {
    it('should include -c with ctxSize value', () => {
      const config = createSlotConfig({ ctxSize: 2048 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '-c', '2048')).to.be.true;
    });

    it('should include -b with batchSize value', () => {
      const config = createSlotConfig({ batchSize: 1024 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '-b', '1024')).to.be.true;
    });

    it('should include -ub with ubatchSize value', () => {
      const config = createSlotConfig({ ubatchSize: 256 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '-ub', '256')).to.be.true;
    });

    it('should include -np with parallel value', () => {
      const config = createSlotConfig({ parallel: 4 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '-np', '4')).to.be.true;
    });

    it('should include all four flags exactly once each', () => {
      const config = createSlotConfig({
        ctxSize: 2048,
        batchSize: 1024,
        ubatchSize: 256,
        parallel: 2,
      });
      const argv = buildArgs(config);

      const cCount = argv.filter((x) => x === '-c').length;
      const bCount = argv.filter((x) => x === '-b').length;
      const ubCount = argv.filter((x) => x === '-ub').length;
      const npCount = argv.filter((x) => x === '-np').length;

      expect(cCount).to.equal(1);
      expect(bCount).to.equal(1);
      expect(ubCount).to.equal(1);
      expect(npCount).to.equal(1);
    });

    it('should have each flag immediately followed by its numeric value', () => {
      const config = createSlotConfig({
        ctxSize: 512,
        batchSize: 64,
        ubatchSize: 32,
        parallel: 1,
      });
      const argv = buildArgs(config);

      const cIdx = argv.indexOf('-c');
      const bIdx = argv.indexOf('-b');
      const ubIdx = argv.indexOf('-ub');
      const npIdx = argv.indexOf('-np');

      expect(cIdx).to.not.equal(-1);
      expect(bIdx).to.not.equal(-1);
      expect(ubIdx).to.not.equal(-1);
      expect(npIdx).to.not.equal(-1);

      expect(argv[cIdx + 1]).to.equal('512');
      expect(argv[bIdx + 1]).to.equal('64');
      expect(argv[ubIdx + 1]).to.equal('32');
      expect(argv[npIdx + 1]).to.equal('1');
    });
  });

  describe('Req 10.2: tensorSplit flag', () => {
    it('should include --tensor-split when tensorSplit is non-empty', () => {
      const config = createSlotConfig({ tensorSplit: [0.5, 0.5] });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '--tensor-split', '0.5,0.5')).to.be.true;
    });

    it('should not include --tensor-split when tensorSplit is empty', () => {
      const config = createSlotConfig({ tensorSplit: [] });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--tensor-split')).to.be.false;
    });

    it('should join tensorSplit values with commas', () => {
      const config = createSlotConfig({ tensorSplit: [0.25, 0.5, 0.25] });
      const argv = buildArgs(config);
      const idx = argv.indexOf('--tensor-split');
      expect(idx).to.not.equal(-1);
      expect(argv[idx + 1]).to.equal('0.25,0.5,0.25');
    });
  });

  describe('Req 10.3: mainGpu flag', () => {
    it('should include --main-gpu when mainGpu >= 0', () => {
      const config = createSlotConfig({ mainGpu: 1 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '--main-gpu', '1')).to.be.true;
    });

    it('should include --main-gpu even when mainGpu is 0', () => {
      const config = createSlotConfig({ mainGpu: 0 });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '--main-gpu', '0')).to.be.true;
    });
  });

  describe('Req 10.4: splitMode flag', () => {
    it('should always include --split-mode with the configured value', () => {
      const modes = ['none', 'layer', 'row'];
      modes.forEach((mode) => {
        const config = createSlotConfig({ splitMode: mode });
        const argv = buildArgs(config);
        expect(hasConsecutiveFlag(argv, '--split-mode', mode)).to.be.true;
      });
    });

    it('should include --split-mode even with default value', () => {
      const config = createSlotConfig({ splitMode: 'layer' });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '--split-mode', 'layer')).to.be.true;
    });
  });

  describe('Req 10.5: rpc flag', () => {
    it('should include --rpc when rpc is non-empty', () => {
      const config = createSlotConfig({ rpc: ['localhost:8000', 'localhost:8001'] });
      const argv = buildArgs(config);
      expect(hasConsecutiveFlag(argv, '--rpc', 'localhost:8000,localhost:8001')).to.be.true;
    });

    it('should not include --rpc when rpc is empty', () => {
      const config = createSlotConfig({ rpc: [] });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--rpc')).to.be.false;
    });

    it('should join rpc entries with commas', () => {
      const config = createSlotConfig({ rpc: ['host1:5000', 'host2:5001', 'host3:5002'] });
      const argv = buildArgs(config);
      const idx = argv.indexOf('--rpc');
      expect(idx).to.not.equal(-1);
      expect(argv[idx + 1]).to.equal('host1:5000,host2:5001,host3:5002');
    });
  });

  describe('Req 10.6: contBatching flag', () => {
    it('should include --cont-batching when contBatching == true', () => {
      const config = createSlotConfig({ contBatching: true });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--cont-batching')).to.be.true;
    });

    it('should include --no-cont-batching when contBatching == false', () => {
      const config = createSlotConfig({ contBatching: false });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--no-cont-batching')).to.be.true;
    });

    it('should not include both flags simultaneously', () => {
      const config1 = createSlotConfig({ contBatching: true });
      const argv1 = buildArgs(config1);
      expect(hasFlag(argv1, '--cont-batching')).to.be.true;
      expect(hasFlag(argv1, '--no-cont-batching')).to.be.false;

      const config2 = createSlotConfig({ contBatching: false });
      const argv2 = buildArgs(config2);
      expect(hasFlag(argv2, '--cont-batching')).to.be.false;
      expect(hasFlag(argv2, '--no-cont-batching')).to.be.true;
    });
  });

  describe('Req 12.2: speculative decoding flag', () => {
    it('should include -md and -cd when speculative.enabled == true (draft-model mode)', () => {
      // Create a temporary draft model file
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-'));
      const draftModelPath = path.join(tmpDir, 'draft.gguf');
      fs.writeFileSync(draftModelPath, 'dummy');

      try {
        const config = createSlotConfig({
          speculative: {
            enabled: true,
            mode: 'draft-model',
            draftModel: draftModelPath,
            draftCtxSize: 2048,
            nMax: 16,
            nMin: 4,
            pMin: 0.8,
          },
        });
        const argv = buildArgs(config);

        expect(hasConsecutiveFlag(argv, '-md', draftModelPath)).to.be.true;
        expect(hasConsecutiveFlag(argv, '-cd', '2048')).to.be.true;
      } finally {
        fs.unlinkSync(draftModelPath);
        fs.rmdirSync(tmpDir);
      }
    });

    it('should not include -md/-cd when speculative.enabled == false', () => {
      const config = createSlotConfig({
        speculative: {
          enabled: false,
          mode: 'off',
          draftModel: null,
          draftCtxSize: 4096,
          nMax: 16,
          nMin: 4,
          pMin: 0.8,
        },
      });
      const argv = buildArgs(config);

      expect(hasFlag(argv, '-md')).to.be.false;
      expect(hasFlag(argv, '-cd')).to.be.false;
    });

    it('should not include -md/-cd when draftModel is null despite enabled=true', () => {
      const config = createSlotConfig({
        speculative: {
          enabled: true,
          mode: 'draft-model',
          draftModel: null,
          draftCtxSize: 4096,
          nMax: 16,
          nMin: 4,
          pMin: 0.8,
        },
      });
      const argv = buildArgs(config);

      // Should not include the flags if draftModel is null
      expect(hasFlag(argv, '-md')).to.be.false;
      expect(hasFlag(argv, '-cd')).to.be.false;
    });
  });

  describe('Req 16.2: embedding slot flag', () => {
    it('should include --embedding and --pooling mean when purpose == "embedding"', () => {
      const config = createSlotConfig({ purpose: 'embedding' });
      const argv = buildArgs(config);

      expect(hasFlag(argv, '--embedding')).to.be.true;
      // Check that --pooling is followed by 'mean'
      const poolingIdx = argv.indexOf('--pooling');
      expect(poolingIdx).to.not.equal(-1);
      expect(argv[poolingIdx + 1]).to.equal('mean');
    });

    it('should not include --embedding for non-embedding purposes', () => {
      const purposes = ['primary', 'secondary', 'vision', 'coding'];
      purposes.forEach((purpose) => {
        const config = createSlotConfig({ purpose });
        const argv = buildArgs(config);
        expect(hasFlag(argv, '--embedding')).to.be.false;
      });
    });

    it('should not include --pooling for non-embedding purposes', () => {
      const purposes = ['primary', 'secondary', 'vision', 'coding'];
      purposes.forEach((purpose) => {
        const config = createSlotConfig({ purpose });
        const argv = buildArgs(config);
        expect(hasFlag(argv, '--pooling')).to.be.false;
      });
    });
  });

  describe('Legacy: mmproj flag', () => {
    it('should include --mmproj when mmprojPath is not null', () => {
      const config = createSlotConfig({ mmprojPath: '/path/to/mmproj.gguf' });
      const argv = buildArgs(config);
      // Check that --mmproj is followed by the path
      const mmIdx = argv.indexOf('--mmproj');
      expect(mmIdx).to.not.equal(-1);
      expect(argv[mmIdx + 1]).to.equal('/path/to/mmproj.gguf');
    });

    it('should not include --mmproj when mmprojPath is null', () => {
      const config = createSlotConfig({ mmprojPath: null });
      const argv = buildArgs(config);
      expect(hasFlag(argv, '--mmproj')).to.be.false;
    });
  });

  describe('Base arguments', () => {
    it('should always start with --model, --host, --port', () => {
      const config = createSlotConfig();
      const argv = buildArgs(config);

      expect(argv[0]).to.equal('--model');
      expect(argv[1]).to.equal('/path/to/model.gguf');
      expect(argv[2]).to.equal('--host');
      expect(argv[3]).to.equal('127.0.0.1');
      expect(argv[4]).to.equal('--port');
      expect(argv[5]).to.equal('13434');
    });

    it('should preserve model path exactly', () => {
      const modelPath = '/some/complex/path/with spaces/model.gguf';
      const config = createSlotConfig({ modelPath });
      const argv = buildArgs(config);

      expect(argv[1]).to.equal(modelPath);
    });

    it('should convert port to string', () => {
      const config = createSlotConfig({ port: 13437 });
      const argv = buildArgs(config);

      expect(argv[5]).to.equal('13437');
      expect(typeof argv[5]).to.equal('string');
    });
  });

  describe('Property-based tests', () => {
    it('should handle all valid AdvancedArgs combinations', () => {
      fc.assert(
        fc.property(
          fc.record({
            flashAttn: fc.boolean(),
            mmap: fc.boolean(),
            mlock: fc.boolean(),
            ctxSize: fc.integer({ min: 512, max: 32768 }),
            batchSize: fc.integer({ min: 32, max: 4096 }),
            ubatchSize: fc.integer({ min: 32, max: 4096 }),
            parallel: fc.integer({ min: 1, max: 16 }),
            tensorSplit: fc.array(fc.float({ min: 0, max: 1, noNaN: true }), {
              maxLength: 4,
            }),
            mainGpu: fc.integer({ min: 0, max: 7 }),
            splitMode: fc.constantFrom('none', 'layer', 'row'),
            rpc: fc.array(
              fc.tuple(
                fc.string({ minLength: 1, maxLength: 20 }),
                fc.integer({ min: 1024, max: 65535 })
              ).map(([host, port]) => `${host}:${port}`),
              { maxLength: 4 }
            ),
            contBatching: fc.boolean(),
          }),
          (advancedArgs) => {
            // Ensure ubatchSize <= batchSize
            const ubatchSize = Math.min(advancedArgs.ubatchSize, advancedArgs.batchSize);

            const config = createSlotConfig({
              ...advancedArgs,
              ubatchSize,
              speculative: {
                enabled: false,
                draftModel: null,
                draftCtxSize: 4096,
              },
            });

            // Should not throw
            const argv = buildArgs(config);

            // Should return an array
            expect(Array.isArray(argv)).to.be.true;

            // Should start with base arguments
            expect(argv[0]).to.equal('--model');
            expect(argv[2]).to.equal('--host');
            expect(argv[4]).to.equal('--port');

            // Should contain all required numeric flags
            expect(hasFlag(argv, '-c')).to.be.true;
            expect(hasFlag(argv, '-b')).to.be.true;
            expect(hasFlag(argv, '-ub')).to.be.true;
            expect(hasFlag(argv, '-np')).to.be.true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce deterministic output for the same input', () => {
      fc.assert(
        fc.property(
          fc.record({
            flashAttn: fc.boolean(),
            mmap: fc.boolean(),
            mlock: fc.boolean(),
            ctxSize: fc.integer({ min: 512, max: 8192 }),
            batchSize: fc.integer({ min: 32, max: 2048 }),
            ubatchSize: fc.integer({ min: 32, max: 2048 }),
            parallel: fc.integer({ min: 1, max: 8 }),
            tensorSplit: fc.array(fc.float({ min: 0, max: 1, noNaN: true }), {
              maxLength: 2,
            }),
            mainGpu: fc.integer({ min: 0, max: 3 }),
            splitMode: fc.constantFrom('none', 'layer', 'row'),
            rpc: fc.array(
              fc.tuple(
                fc.string({ minLength: 1, maxLength: 10 }),
                fc.integer({ min: 5000, max: 9999 })
              ).map(([host, port]) => `${host}:${port}`),
              { maxLength: 2 }
            ),
            contBatching: fc.boolean(),
          }),
          (advancedArgs) => {
            const ubatchSize = Math.min(advancedArgs.ubatchSize, advancedArgs.batchSize);

            const config = createSlotConfig({
              ...advancedArgs,
              ubatchSize,
            });

            const argv1 = buildArgs(config);
            const argv2 = buildArgs(config);

            // Should produce identical output
            expect(JSON.stringify(argv1)).to.equal(JSON.stringify(argv2));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/* eslint-env node */
const { describe, it } = require('mocha');
const { expect } = require('chai');
const {
  STATES,
  ALL_STATES,
  createRunnerRef,
  isValidTransition,
  transitionState,
  normalizeKey,
} = require('../runner-ref');

describe('runner-ref', () => {
  describe('STATES', () => {
    it('should export all seven states', () => {
      expect(ALL_STATES).to.have.lengthOf(7);
      expect(ALL_STATES).to.include('spawning');
      expect(ALL_STATES).to.include('loading');
      expect(ALL_STATES).to.include('ready');
      expect(ALL_STATES).to.include('serving');
      expect(ALL_STATES).to.include('idle');
      expect(ALL_STATES).to.include('evicting');
      expect(ALL_STATES).to.include('terminated');
    });
  });

  describe('createRunnerRef', () => {
    it('should create a RunnerRef with default values', () => {
      const ref = createRunnerRef();
      expect(ref.modelPath).to.be.null;
      expect(ref.modelKey).to.be.null;
      expect(ref.port).to.be.null;
      expect(ref.process).to.be.null;
      expect(ref.pid).to.be.null;
      expect(ref.refCount).to.equal(0);
      expect(ref.state).to.equal('spawning');
      expect(ref.purpose).to.equal('primary');
      expect(ref.estimatedVramMB).to.equal(0);
      expect(ref.lastUsedAt).to.be.a('number');
      expect(ref.loadedAt).to.be.null;
      expect(ref.keepAliveTimer).to.be.null;
      expect(ref.keepAliveDurationMs).to.equal(300000);
      expect(ref.stderrTail).to.equal('');
      expect(ref.metadata).to.deep.equal({});
    });

    it('should derive modelKey from modelPath when omitted', () => {
      const ref = createRunnerRef({ modelPath: 'C:\\Models\\model.gguf' });
      expect(ref.modelKey).to.equal('c:/models/model.gguf');
    });

    it('should accept an explicit modelKey', () => {
      const ref = createRunnerRef({ modelPath: 'a.gguf', modelKey: 'custom-key' });
      expect(ref.modelKey).to.equal('custom-key');
    });

    it('should override defaults with options', () => {
      const ref = createRunnerRef({
        modelPath: '/models/m.gguf',
        port: 13435,
        pid: 12345,
        refCount: 2,
        state: STATES.SERVING,
        purpose: 'vision',
        estimatedVramMB: 4096,
        keepAliveDurationMs: 60000,
        stderrTail: 'error log',
        metadata: { arch: 'llama' },
      });
      expect(ref.modelPath).to.equal('/models/m.gguf');
      expect(ref.port).to.equal(13435);
      expect(ref.pid).to.equal(12345);
      expect(ref.refCount).to.equal(2);
      expect(ref.state).to.equal('serving');
      expect(ref.purpose).to.equal('vision');
      expect(ref.estimatedVramMB).to.equal(4096);
      expect(ref.keepAliveDurationMs).to.equal(60000);
      expect(ref.stderrTail).to.equal('error log');
      expect(ref.metadata).to.deep.equal({ arch: 'llama' });
    });
  });

  describe('isValidTransition', () => {
    it('should allow spawning -> loading', () => {
      expect(isValidTransition('spawning', 'loading')).to.be.true;
    });

    it('should allow spawning -> terminated', () => {
      expect(isValidTransition('spawning', 'terminated')).to.be.true;
    });

    it('should allow loading -> ready', () => {
      expect(isValidTransition('loading', 'ready')).to.be.true;
    });

    it('should allow loading -> terminated', () => {
      expect(isValidTransition('loading', 'terminated')).to.be.true;
    });

    it('should allow ready -> serving', () => {
      expect(isValidTransition('ready', 'serving')).to.be.true;
    });

    it('should allow ready -> idle', () => {
      expect(isValidTransition('ready', 'idle')).to.be.true;
    });

    it('should allow ready -> evicting', () => {
      expect(isValidTransition('ready', 'evicting')).to.be.true;
    });

    it('should allow serving -> idle', () => {
      expect(isValidTransition('serving', 'idle')).to.be.true;
    });

    it('should allow serving -> evicting', () => {
      expect(isValidTransition('serving', 'evicting')).to.be.true;
    });

    it('should allow idle -> serving', () => {
      expect(isValidTransition('idle', 'serving')).to.be.true;
    });

    it('should allow idle -> evicting', () => {
      expect(isValidTransition('idle', 'evicting')).to.be.true;
    });

    it('should allow evicting -> terminated', () => {
      expect(isValidTransition('evicting', 'terminated')).to.be.true;
    });

    it('should allow terminated -> spawning', () => {
      expect(isValidTransition('terminated', 'spawning')).to.be.true;
    });

    it('should disallow spawning -> ready directly', () => {
      expect(isValidTransition('spawning', 'ready')).to.be.false;
    });

    it('should disallow serving -> loading', () => {
      expect(isValidTransition('serving', 'loading')).to.be.false;
    });

    it('should disallow evicting -> serving', () => {
      expect(isValidTransition('evicting', 'serving')).to.be.false;
    });

    it('should return false for unknown states', () => {
      expect(isValidTransition('unknown', 'spawning')).to.be.false;
      expect(isValidTransition('spawning', 'unknown')).to.be.false;
    });
  });

  describe('transitionState', () => {
    it('should update the state and return the previous state', () => {
      const ref = createRunnerRef({ state: STATES.LOADING });
      const prev = transitionState(ref, STATES.READY);
      expect(prev).to.equal('loading');
      expect(ref.state).to.equal('ready');
    });

    it('should throw on invalid transitions', () => {
      const ref = createRunnerRef({ state: STATES.SPAWNING });
      expect(() => transitionState(ref, STATES.SERVING)).to.throw(
        'Invalid state transition'
      );
    });
  });

  describe('normalizeKey', () => {
    it('should lowercase and convert backslashes to forward slashes', () => {
      expect(normalizeKey('C:\\Models\\Llama.gguf')).to.equal('c:/models/llama.gguf');
    });

    it('should return null for null input', () => {
      expect(normalizeKey(null)).to.be.null;
    });

    it('should return null for undefined input', () => {
      expect(normalizeKey(undefined)).to.be.null;
    });
  });
});

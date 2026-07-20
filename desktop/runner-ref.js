/**
 * RunnerRef Module
 *
 * Factory function and state machine utilities for RunnerRef data structures.
 *
 * Requirements: 2.1, 2.7, 1.4
 */

// ---------------------------------------------------------------------------
// State constants
// ---------------------------------------------------------------------------
const STATES = {
  SPAWNING: 'spawning',
  LOADING: 'loading',
  READY: 'ready',
  SERVING: 'serving',
  IDLE: 'idle',
  EVICTING: 'evicting',
  TERMINATED: 'terminated',
};

const ALL_STATES = Object.values(STATES);

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------
const VALID_TRANSITIONS = {
  [STATES.SPAWNING]: [STATES.LOADING, STATES.TERMINATED],
  [STATES.LOADING]: [STATES.READY, STATES.TERMINATED],
  [STATES.READY]: [STATES.SERVING, STATES.IDLE, STATES.EVICTING, STATES.TERMINATED],
  [STATES.SERVING]: [STATES.IDLE, STATES.EVICTING, STATES.TERMINATED],
  [STATES.IDLE]: [STATES.SERVING, STATES.EVICTING, STATES.TERMINATED],
  [STATES.EVICTING]: [STATES.TERMINATED],
  [STATES.TERMINATED]: [STATES.SPAWNING],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a model path into a stable registry key.
 * @param {string} modelPath
 * @returns {string}
 */
function normalizeKey(modelPath) {
  if (!modelPath) return null;
  return modelPath.replace(/\\/g, '/').toLowerCase();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new RunnerRef object.
 *
 * @param {Object} options
 * @param {string} [options.modelPath]
 * @param {string} [options.modelKey] - auto-derived from modelPath if omitted
 * @param {number} [options.port]
 * @param {import('child_process').ChildProcess} [options.process]
 * @param {number} [options.pid]
 * @param {number} [options.refCount=0]
 * @param {string} [options.state='spawning']
 * @param {string} [options.purpose='primary']
 * @param {number} [options.estimatedVramMB=0]
 * @param {number} [options.lastUsedAt=Date.now()]
 * @param {number} [options.loadedAt=null]
 * @param {NodeJS.Timeout|null} [options.keepAliveTimer=null]
 * @param {number} [options.keepAliveDurationMs=300000]
 * @param {string} [options.stderrTail='']
 * @param {Object} [options.metadata={}]
 * @returns {Object} RunnerRef
 */
function createRunnerRef(options = {}) {
  const now = Date.now();
  const modelPath = options.modelPath || null;
  const modelKey =
    options.modelKey != null ? options.modelKey : normalizeKey(modelPath);

  return {
    modelPath,
    modelKey,
    port: options.port != null ? options.port : null,
    process: options.process || null,
    pid: options.pid != null ? options.pid : null,
    refCount: options.refCount != null ? options.refCount : 0,
    state: options.state || STATES.SPAWNING,
    purpose: options.purpose || 'primary',
    estimatedVramMB: options.estimatedVramMB != null ? options.estimatedVramMB : 0,
    lastUsedAt: options.lastUsedAt != null ? options.lastUsedAt : now,
    loadedAt: options.loadedAt != null ? options.loadedAt : null,
    keepAliveTimer: options.keepAliveTimer || null,
    keepAliveDurationMs: options.keepAliveDurationMs != null ? options.keepAliveDurationMs : 300000,
    stderrTail: options.stderrTail || '',
    metadata: options.metadata || {},
  };
}

// ---------------------------------------------------------------------------
// State machine guards
// ---------------------------------------------------------------------------

/**
 * Check whether a state transition is legal.
 *
 * @param {string} from - current state
 * @param {string} to - desired next state
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Apply a state transition to a RunnerRef.
 *
 * @param {Object} runnerRef
 * @param {string} newState
 * @returns {string} previous state
 * @throws {Error} if the transition is illegal
 */
function transitionState(runnerRef, newState) {
  if (!isValidTransition(runnerRef.state, newState)) {
    throw new Error(
      `Invalid state transition from "${runnerRef.state}" to "${newState}"`
    );
  }
  const previous = runnerRef.state;
  runnerRef.state = newState;
  return previous;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  STATES,
  ALL_STATES,
  createRunnerRef,
  isValidTransition,
  transitionState,
  normalizeKey,
};

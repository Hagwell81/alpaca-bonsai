/**
 * Health Probe Poller
 *
 * Polls a runner's /health endpoint until it returns HTTP 200.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

const http = require('http');

/**
 * Poll a runner's /health endpoint until it returns HTTP 200.
 *
 * @param {number} port
 * @param {Object} [options={}]
 * @param {number} [options.intervalMs=1000] - Polling interval in milliseconds
 * @param {number} [options.timeoutMs=90000] - Maximum time to wait in milliseconds
 * @param {Function} [options.onProgress=(elapsedMs)=>{}] - Called on each poll iteration
 * @returns {Promise<boolean>} true when HTTP 200 is received, false on timeout
 */
async function pollHealthUntilReady(port, options = {}) {
  const {
    intervalMs = 1000,
    timeoutMs = 90000,
    onProgress = () => {},
  } = options;

  const startTime = Date.now();

  return new Promise((resolve) => {
    let timer = null;
    let isResolved = false;

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function probe() {
      if (isResolved) return;

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        isResolved = true;
        cleanup();
        resolve(false);
        return;
      }

      onProgress(elapsed);

      const req = http.get(
        `http://127.0.0.1:${port}/health`,
        { timeout: 2000 },
        (res) => {
          if (isResolved) {
            res.resume();
            return;
          }

          if (res.statusCode === 200) {
            isResolved = true;
            cleanup();
            res.resume();
            resolve(true);
          } else {
            // Runner is still loading (typically returns 503)
            res.resume();
            timer = setTimeout(probe, intervalMs);
          }
        }
      );

      req.on('error', () => {
        if (!isResolved) {
          timer = setTimeout(probe, intervalMs);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (!isResolved) {
          timer = setTimeout(probe, intervalMs);
        }
      });
    }

    probe();
  });
}

module.exports = { pollHealthUntilReady };

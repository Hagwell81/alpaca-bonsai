/* eslint-env node */
/**
 * Lazy-Start Manager
 *
 * Controls whether the llama-server starts automatically at app boot
 * or waits for an explicit user action (on-demand start).
 *
 * When lazy-start is enabled:
 *   - The app boots to a landing page instead of launching the webui
 *   - The server is only started when the user clicks "Start Chatting"
 *   - This keeps model RAM/VRAM free until the user actually wants to chat
 *
 * @module lazy-start-manager
 */

const path = require('path');
const fs = require('fs');

/**
 * Default lazy-start configuration.
 * @type {Object}
 */
const DEFAULTS = {
	enabled: true,
	autoShutdownDelayMinutes: 0 // 0 = disabled; >0 = stop server after N minutes idle
};

/**
 * Creates a LazyStartManager instance backed by electron-store.
 *
 * @param {Object} store - electron-store instance
 * @returns {LazyStartManager}
 */
function createManager(store) {
	return new LazyStartManager(store);
}

/**
 * Manages lazy-start settings and landing-page HTML generation.
 */
class LazyStartManager {
	/**
	 * @param {Object} store - electron-store instance
	 */
	constructor(store) {
		this.store = store;
	}

	/**
	 * Reads the lazy-start setting from persistent storage.
	 *
	 * @returns {boolean} True if lazy-start is enabled
	 */
	isEnabled() {
		try {
			return this.store.get('lazyStart.enabled', DEFAULTS.enabled);
		} catch (err) {
			console.error('[lazy-start] Failed to read setting:', err.message);
			return DEFAULTS.enabled;
		}
	}

	/**
	 * Persists the lazy-start setting.
	 *
	 * @param {boolean} value - Whether lazy-start should be enabled
	 */
	setEnabled(value) {
		try {
			this.store.set('lazyStart.enabled', Boolean(value));
		} catch (err) {
			console.error('[lazy-start] Failed to write setting:', err.message);
		}
	}

	/**
	 * Gets the configured auto-shutdown delay in minutes.
	 *
	 * @returns {number} Minutes of inactivity before auto-shutdown (0 = disabled)
	 */
	getAutoShutdownDelayMinutes() {
		try {
			return this.store.get('lazyStart.autoShutdownDelayMinutes', DEFAULTS.autoShutdownDelayMinutes);
		} catch (err) {
			return DEFAULTS.autoShutdownDelayMinutes;
		}
	}

	/**
	 * Sets the auto-shutdown delay.
	 *
	 * @param {number} minutes - Minutes of inactivity before shutdown (0 to disable)
	 */
	setAutoShutdownDelayMinutes(minutes) {
		try {
			const safe = Math.max(0, Math.min(1440, Number(minutes) || 0));
			this.store.set('lazyStart.autoShutdownDelayMinutes', safe);
		} catch (err) {
			console.error('[lazy-start] Failed to write auto-shutdown:', err.message);
		}
	}

	/**
	 * Resets all lazy-start settings to defaults.
	 */
	resetToDefaults() {
		this.setEnabled(DEFAULTS.enabled);
		this.setAutoShutdownDelayMinutes(DEFAULTS.autoShutdownDelayMinutes);
	}

	/**
	 * Generates the landing page HTML that is shown when lazy-start is active.
	 *
	 * @param {Object} options - Page generation options
	 * @param {string} [options.logoHtml] - Optional logo image HTML
	 * @param {string} [options.modelName] - Name of the default/selected model
	 * @param {string} [options.modelSize] - Human-readable model size
	 * @param {string} [options.backendName] - Detected backend (e.g. "CUDA")
	 * @returns {string} Complete HTML document
	 */
	generateLandingPage(options = {}) {
		const logoHtml = options.logoHtml || '<div style="font-size:64px;line-height:120px;">🦙</div>';
		const modelName = options.modelName || 'Available model';
		const modelSize = options.modelSize || '';
		const backendName = options.backendName || 'CPU';

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>alpaca</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 420px;
    }
    .logo {
      width: 120px;
      height: 120px;
      margin: 0 auto 20px;
      object-fit: contain;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 600;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
      color: #fff;
    }
    .subtitle {
      font-size: 0.95rem;
      color: #8b949e;
      margin-bottom: 32px;
    }
    .info-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 24px;
      text-align: left;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 0.9rem;
    }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #8b949e; }
    .info-value { color: #e6edf3; font-weight: 500; }
    .badge {
      display: inline-block;
      background: #10a37f22;
      color: #10a37f;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-left: 6px;
    }
    .start-btn {
      background: #10a37f;
      color: white;
      border: none;
      padding: 14px 32px;
      font-size: 1rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      font-weight: 600;
      width: 100%;
    }
    .start-btn:hover { background: #0d8c6d; }
    .start-btn:active { transform: scale(0.98); }
    .start-btn:disabled {
      background: #30363d;
      color: #8b949e;
      cursor: not-allowed;
    }
    .secondary-text {
      margin-top: 16px;
      font-size: 0.8rem;
      color: #666;
    }
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255,255,255,0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">${logoHtml}</div>
    <h1>alpaca</h1>
    <p class="subtitle">Your AI is resting to save memory.<br>Wake it up when you are ready to chat.<br><span style="color:#10a37f;font-size:0.8rem;">First-time setup may take a few minutes. The app will update automatically once ready.</span></p>

    <div class="info-card">
      <div class="info-row">
        <span class="info-label">Model</span>
        <span class="info-value">${escapeHtml(modelName)} ${modelSize ? `<span class="badge">${escapeHtml(modelSize)}</span>` : ''}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Backend</span>
        <span class="info-value">${escapeHtml(backendName)}</span>
      </div>
    </div>

    <button id="startBtn" class="start-btn" onclick="startChatting()">Start Chatting</button>
    <p class="secondary-text" id="hint">Click to load the model into memory.</p>
  </div>

  <script>
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    async function startChatting() {
      const btn = document.getElementById('startBtn');
      const hint = document.getElementById('hint');
      if (!window.llamaAPI || !window.llamaAPI.startLazyServer) {
        hint.textContent = 'App bridge not available. Please restart.';
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Starting AI...';
      hint.textContent = 'Loading model into memory. This may take a moment.';
      try {
        const result = await window.llamaAPI.startLazyServer();
        if (result && result.success) {
          btn.innerHTML = 'Launching chat...';
          hint.textContent = '';
        } else {
          btn.disabled = false;
          btn.textContent = 'Retry Start';
          hint.textContent = 'Failed to start: ' + (result && result.error ? result.error : 'Unknown error');
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Retry Start';
        hint.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
      }
    }
  </script>
</body>
</html>`;
	}
}

/**
 * Escapes HTML special characters to prevent XSS in generated pages.
 *
 * @param {string} text - Raw text
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
	if (typeof text !== 'string') return '';
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

module.exports = {
	createManager,
	LazyStartManager,
	escapeHtml,
	DEFAULTS
};

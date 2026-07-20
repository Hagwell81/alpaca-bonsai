/* eslint-env node */
/**
 * Splash Screen Manager
 *
 * Handles all interactions with the persistent splash screen renderer.
 * Instead of reloading the window to show progress (which causes blank flashes),
 * this module sends IPC messages to update text, progress, and status in-place.
 *
 * @module splash-manager
 */

const path = require('path');
const fs = require('fs');

/**
 * Tracks the currently active BrowserWindow so the manager can send IPC messages.
 * @type {Electron.BrowserWindow|null}
 */
let activeWindow = null;

/**
 * Caches the alpaca logo as a base64 data URI so the splash screen can display it
 * without filesystem access inside the renderer.
 *
 * @param {string} resourcesDir - Absolute path to the resources directory
 * @returns {string|null} Base64 data URI or null if logo not found
 */
function getSplashLogo(resourcesDir) {
	const pngPaths = [
		path.join(resourcesDir, 'alpaca.png')
	];
	if (process.resourcesPath) {
		pngPaths.push(
			path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'alpaca.png'),
			path.join(process.resourcesPath, 'app', 'resources', 'alpaca.png')
		);
	}

	for (const pngPath of pngPaths) {
		try {
			if (fs.existsSync(pngPath)) {
				const data = fs.readFileSync(pngPath).toString('base64');
				return `data:image/png;base64,${data}`;
			}
		} catch (_) {
			/* ignore */
		}
	}
	return null;
}

/**
 * Binds the manager to a specific BrowserWindow instance.
 * Must be called once after the main window is created.
 *
 * @param {Electron.BrowserWindow} browserWindow - The main application window
 */
function bindWindow(browserWindow) {
	activeWindow = browserWindow;
}

/**
 * Sends an update to the splash screen renderer via IPC.
 *
 * @param {Object} payload - Update payload
 * @param {string} [payload.title] - Window / app title text
 * @param {string} [payload.message] - Primary message text
 * @param {number} [payload.percent] - Progress percentage (0-100)
 * @param {string} [payload.status] - Secondary status line
 * @param {boolean} [payload.autoTick] - Whether to start/stop auto progress tick
 */
function sendSplashUpdate(payload) {
	if (!activeWindow || activeWindow.isDestroyed()) {
		return;
	}
	try {
		activeWindow.webContents.send('splash:update', payload);
	} catch (err) {
		console.error('[splash-manager] Failed to send splash update:', err.message);
	}
}

/**
 * Updates the splash screen text and optional progress.
 * Safe to call repeatedly; does nothing if no window is bound.
 *
 * @param {string} title - Title text (e.g. app name)
 * @param {string} message - Primary message (e.g. "Loading AI model...")
 * @param {number} [percent] - Optional progress percentage (0-100)
 * @param {string} [status] - Optional secondary status line
 */
function updateSplash(title, message, percent, status) {
	const payload = { title, message };
	if (typeof percent === 'number') payload.percent = percent;
	if (typeof status === 'string') payload.status = status;
	sendSplashUpdate(payload);
}

/**
 * Shows an indeterminate progress state with auto-ticking animation.
 * Use this when you don't know exactly how long an operation will take.
 *
 * @param {string} title - Title text
 * @param {string} message - Primary message
 * @param {string} [status] - Optional secondary status line
 */
function showIndeterminate(title, message, status) {
	const payload = { title, message, autoTick: true };
	if (typeof status === 'string') payload.status = status;
	sendSplashUpdate(payload);
}

/**
 * Completes the splash progress (sets percent to 100 and stops auto-tick).
 *
 * @param {string} [message] - Optional completion message
 */
function completeSplash(message) {
	const payload = { percent: 100, autoTick: false };
	if (typeof message === 'string') payload.message = message;
	sendSplashUpdate(payload);
}

/**
 * Sends the cached logo to the splash screen so it can render the branded image.
 *
 * @param {string} resourcesDir - Absolute path to the resources directory
 */
function sendSplashLogo(resourcesDir) {
	const logo = getSplashLogo(resourcesDir);
	if (logo) {
		sendSplashUpdate({ logo });
	}
}

module.exports = {
	bindWindow,
	updateSplash,
	showIndeterminate,
	completeSplash,
	sendSplashLogo,
	getSplashLogo
};

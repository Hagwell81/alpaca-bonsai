/* eslint-env node */
/**
 * Tests for splash-manager.js
 *
 * Run with: node desktop/tests/splash-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const { bindWindow, updateSplash, showIndeterminate, completeSplash, getSplashLogo } = require('../splash-manager');

function test(name, fn) {
	try {
		fn();
		console.log(`  PASS: ${name}`);
	} catch (err) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${err.message}`);
		process.exitCode = 1;
	}
}

console.log('splash-manager tests');

// Mock BrowserWindow with a fake webContents
function createMockWindow() {
	const sentMessages = [];
	const mockWindow = {
		isDestroyed: () => false,
		webContents: {
			send: (channel, payload) => {
				sentMessages.push({ channel, payload });
			}
		}
	};
	return { window: mockWindow, sentMessages };
}

test('bindWindow attaches window for IPC', () => {
	const { window: mw } = createMockWindow();
	bindWindow(mw);
	updateSplash('title', 'msg');
	// Should not throw
});

test('updateSplash sends title and message', () => {
	const { window: mw, sentMessages } = createMockWindow();
	bindWindow(mw);
	updateSplash('MyApp', 'Loading...');
	assert.strictEqual(sentMessages.length, 1);
	assert.strictEqual(sentMessages[0].channel, 'splash:update');
	assert.strictEqual(sentMessages[0].payload.title, 'MyApp');
	assert.strictEqual(sentMessages[0].payload.message, 'Loading...');
});

test('updateSplash sends optional percent and status', () => {
	const { window: mw, sentMessages } = createMockWindow();
	bindWindow(mw);
	updateSplash('App', 'Working', 45, 'step 2');
	assert.strictEqual(sentMessages.length, 1);
	const p = sentMessages[0].payload;
	assert.strictEqual(p.percent, 45);
	assert.strictEqual(p.status, 'step 2');
});

test('showIndeterminate sends autoTick true', () => {
	const { window: mw, sentMessages } = createMockWindow();
	bindWindow(mw);
	showIndeterminate('App', 'Please wait');
	const p = sentMessages[0].payload;
	assert.strictEqual(p.title, 'App');
	assert.strictEqual(p.message, 'Please wait');
	assert.strictEqual(p.autoTick, true);
});

test('completeSplash sends percent 100 and stops autoTick', () => {
	const { window: mw, sentMessages } = createMockWindow();
	bindWindow(mw);
	completeSplash('Done');
	const p = sentMessages[0].payload;
	assert.strictEqual(p.percent, 100);
	assert.strictEqual(p.autoTick, false);
	assert.strictEqual(p.message, 'Done');
});

test('updateSplash is safe when window destroyed', () => {
	const destroyedWindow = {
		isDestroyed: () => true,
		webContents: { send: () => { throw new Error('should not call'); } }
	};
	bindWindow(destroyedWindow);
	updateSplash('t', 'm');
	// Should not throw
});

test('getSplashLogo returns null for missing resources', () => {
	const logo = getSplashLogo(path.join(__dirname, 'nonexistent'));
	assert.strictEqual(logo, null);
});

console.log('\nAll tests completed.');

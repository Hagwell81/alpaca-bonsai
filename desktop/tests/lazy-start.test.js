/* eslint-env node */
/**
 * Tests for lazy-start-manager.js
 *
 * Run with: node desktop/tests/lazy-start.test.js
 */

const assert = require('assert');
const { LazyStartManager, escapeHtml, DEFAULTS } = require('../lazy-start-manager');

// Simple mock electron-store
function createMockStore(initial = {}) {
	const data = { ...initial };
	return {
		get: (key, defaultValue) => {
			return key in data ? data[key] : defaultValue;
		},
		set: (key, value) => {
			data[key] = value;
		}
	};
}

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

console.log('lazy-start-manager tests');

test('isEnabled returns default true when unset', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	assert.strictEqual(manager.isEnabled(), true);
});

test('isEnabled reads stored value', () => {
	const store = createMockStore({ 'lazyStart.enabled': false });
	const manager = new LazyStartManager(store);
	assert.strictEqual(manager.isEnabled(), false);
});

test('setEnabled persists boolean', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	manager.setEnabled(false);
	assert.strictEqual(store.get('lazyStart.enabled'), false);
});

test('setEnabled coerces to boolean', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	manager.setEnabled(1);
	assert.strictEqual(store.get('lazyStart.enabled'), true);
});

test('getAutoShutdownDelayMinutes returns default 0', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	assert.strictEqual(manager.getAutoShutdownDelayMinutes(), 0);
});

test('setAutoShutdownDelayMinutes clamps values', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	manager.setAutoShutdownDelayMinutes(-5);
	assert.strictEqual(store.get('lazyStart.autoShutdownDelayMinutes'), 0);

	manager.setAutoShutdownDelayMinutes(2000);
	assert.strictEqual(store.get('lazyStart.autoShutdownDelayMinutes'), 1440);
});

test('resetToDefaults restores defaults', () => {
	const store = createMockStore({ 'lazyStart.enabled': false, 'lazyStart.autoShutdownDelayMinutes': 30 });
	const manager = new LazyStartManager(store);
	manager.resetToDefaults();
	assert.strictEqual(manager.isEnabled(), DEFAULTS.enabled);
	assert.strictEqual(manager.getAutoShutdownDelayMinutes(), DEFAULTS.autoShutdownDelayMinutes);
});

test('generateLandingPage produces valid HTML', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	const html = manager.generateLandingPage({
		modelName: 'TestModel',
		modelSize: '4B',
		backendName: 'CUDA'
	});
	assert.ok(html.includes('<!DOCTYPE html>'));
	assert.ok(html.includes('TestModel'));
	assert.ok(html.includes('CUDA'));
	assert.ok(html.includes('startChatting'));
});

test('generateLandingPage escapes HTML in model name', () => {
	const store = createMockStore();
	const manager = new LazyStartManager(store);
	const html = manager.generateLandingPage({
		modelName: '<script>alert(1)</script>',
		backendName: 'CPU'
	});
	assert.ok(!html.includes('<script>alert(1)</script>'));
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('escapeHtml handles common characters', () => {
	assert.strictEqual(escapeHtml('<div>"test" & \'ok\'</div>'),
		'&lt;div&gt;&quot;test&quot; &amp; &#39;ok&#39;&lt;/div&gt;');
});

test('escapeHtml handles non-string input', () => {
	assert.strictEqual(escapeHtml(null), '');
	assert.strictEqual(escapeHtml(123), '');
});

console.log('\nAll tests completed.');

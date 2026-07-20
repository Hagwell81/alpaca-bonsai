/* eslint-env node */
/**
 * Tests for migration-dialog-manager.js
 *
 * Run with: node desktop/tests/migration-dialog-manager.test.js
 */

const assert = require('assert');
const { MigrationDialogManager } = require('../migration-dialog-manager');

/**
 * Mock electron-store
 */
function createMockStore(initial = {}) {
	const data = { ...initial };
	return {
		get: (key, defaultValue) => {
			return key in data ? data[key] : defaultValue;
		},
		set: (key, value) => {
			data[key] = value;
		},
		delete: (key) => {
			delete data[key];
		},
		store: data
	};
}

/**
 * Mock UserMigration
 */
function createMockUserMigration(migrationNeeded = true, shouldSucceed = true) {
	return {
		isMigrationNeeded: async () => migrationNeeded,
		migrate: async () => {
			if (!shouldSucceed) {
				throw new Error('Migration failed');
			}
			return {
				success: true,
				totalRecords: 5,
				migratedRecords: 5,
				failedRecords: 0,
				failedDetails: []
			};
		},
		on: () => {},
		off: () => {}
	};
}



/**
 * Run all tests
 */
async function runTests() {
	console.log('Running MigrationDialogManager tests...\n');

	const tests = [
		{
			name: 'constructor - should create instance with valid parameters',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				assert.strictEqual(manager.userMigration, userMigration);
				assert.strictEqual(manager.store, store);
				assert.strictEqual(manager.dialogWindow, null);
				assert.strictEqual(manager.dialogShown, false);
				assert.strictEqual(manager.migrationInProgress, false);
			}
		},
		{
			name: 'constructor - should throw error if UserMigration is missing',
			fn: () => {
				const store = createMockStore();
				assert.throws(
					() => new MigrationDialogManager(null, store),
					/UserMigration instance is required/
				);
			}
		},
		{
			name: 'constructor - should throw error if Store is missing',
			fn: () => {
				const userMigration = createMockUserMigration();
				assert.throws(
					() => new MigrationDialogManager(userMigration, null),
					/Store instance is required/
				);
			}
		},
		{
			name: 'showDialogIfNeeded - should return success if migration not needed',
			fn: async () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration(false);
				const manager = new MigrationDialogManager(userMigration, store);
				const result = await manager.showDialogIfNeeded();
				assert.strictEqual(result.success, true);
				assert.strictEqual(result.migrated, false);
				assert.strictEqual(result.cancelled, false);
			}
		},
		{
			name: 'showDialogIfNeeded - should return success if dialog already shown',
			fn: async () => {
				const store = createMockStore({ migrationDialogShown: true });
				const userMigration = createMockUserMigration(true);
				const manager = new MigrationDialogManager(userMigration, store);
				const result = await manager.showDialogIfNeeded();
				assert.strictEqual(result.success, true);
				assert.strictEqual(result.migrated, false);
				assert.strictEqual(result.cancelled, false);
			}
		},
		{
			name: 'showDialogIfNeeded - should handle errors gracefully',
			fn: async () => {
				const store = createMockStore();
				const userMigration = {
					isMigrationNeeded: async () => {
						throw new Error('Check failed');
					}
				};
				const manager = new MigrationDialogManager(userMigration, store);
				const result = await manager.showDialogIfNeeded();
				assert.strictEqual(result.success, false);
				assert(result.error);
			}
		},
		{
			name: 'event listeners - should register and emit events',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				let eventFired = false;
				let eventData = null;
				manager.on('test-event', (data) => {
					eventFired = true;
					eventData = data;
				});
				manager._emit('test-event', { message: 'test' });
				assert.strictEqual(eventFired, true);
				assert.deepStrictEqual(eventData, { message: 'test' });
			}
		},
		{
			name: 'event listeners - should unregister event listeners',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				let callCount = 0;
				const callback = () => {
					callCount++;
				};
				manager.on('test-event', callback);
				manager._emit('test-event', {});
				assert.strictEqual(callCount, 1);
				manager.off('test-event', callback);
				manager._emit('test-event', {});
				assert.strictEqual(callCount, 1);
			}
		},
		{
			name: 'event listeners - should handle multiple listeners for same event',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				let count1 = 0;
				let count2 = 0;
				manager.on('test-event', () => {
					count1++;
				});
				manager.on('test-event', () => {
					count2++;
				});
				manager._emit('test-event', {});
				assert.strictEqual(count1, 1);
				assert.strictEqual(count2, 1);
			}
		},
		{
			name: 'event listeners - should handle listener errors gracefully',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				let secondListenerCalled = false;
				manager.on('test-event', () => {
					throw new Error('Listener error');
				});
				manager.on('test-event', () => {
					secondListenerCalled = true;
				});
				manager._emit('test-event', {});
				assert.strictEqual(secondListenerCalled, true);
			}
		},
		{
			name: 'destroy - should clean up resources',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				manager.on('test-event', () => {});
				manager.destroy();
				assert.strictEqual(manager.eventListeners['test-event'], undefined);
			}
		},
		{
			name: 'dialog state management - should track dialog shown state',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				assert.strictEqual(manager.dialogShown, false);
			}
		},
		{
			name: 'dialog state management - should track migration in progress state',
			fn: () => {
				const store = createMockStore();
				const userMigration = createMockUserMigration();
				const manager = new MigrationDialogManager(userMigration, store);
				assert.strictEqual(manager.migrationInProgress, false);
			}
		}
	];

	let passed = 0;
	let failed = 0;

	for (const test of tests) {
		try {
			const result = test.fn();
			if (result && typeof result.then === 'function') {
				await result;
			}
			console.log(`✓ ${test.name}`);
			passed++;
		} catch (err) {
			console.log(`✗ ${test.name}`);
			console.log(`  Error: ${err.message}`);
			failed++;
		}
	}

	console.log(`\n${passed} passed, ${failed} failed\n`);
	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
	console.error('Test runner error:', err);
	process.exit(1);
});

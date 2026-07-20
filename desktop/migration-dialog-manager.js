/**
 * Migration Dialog Manager
 *
 * Manages the display and interaction of the user migration dialog.
 * Handles one-time display per machine and coordinates with UserMigration service.
 *
 * @module migration-dialog-manager
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

/**
 * MigrationDialogManager
 *
 * Manages the migration dialog window and coordinates with the UserMigration service.
 */
class MigrationDialogManager {
	/**
	 * Create a new MigrationDialogManager instance
	 *
	 * @param {UserMigration} userMigration - UserMigration service instance
	 * @param {Object} store - electron-store instance for persistence
	 */
	constructor(userMigration, store) {
		if (!userMigration) {
			throw new Error('UserMigration instance is required');
		}
		if (!store) {
			throw new Error('Store instance is required');
		}

		this.userMigration = userMigration;
		this.store = store;
		this.dialogWindow = null;
		this.dialogShown = false;
		this.migrationInProgress = false;
		this.eventListeners = {};
	}

	/**
	 * Show the migration dialog if needed
	 *
	 * Checks if migration is needed and if the dialog hasn't been shown yet.
	 * Returns a promise that resolves when the dialog is closed or migration completes.
	 *
	 * @returns {Promise<Object>} Result object with { success, migrated, cancelled }
	 */
	async showDialogIfNeeded() {
		try {
			// Check if migration is needed
			const migrationNeeded = await this.userMigration.isMigrationNeeded();
			if (!migrationNeeded) {
				return { success: true, migrated: false, cancelled: false };
			}

			// Check if dialog has already been shown for this machine
			const dialogShownFlag = this.store.get('migrationDialogShown', false);
			if (dialogShownFlag) {
				// Dialog was already shown, but migration wasn't completed
				// This shouldn't happen in normal flow, but handle it gracefully
				console.warn('[MigrationDialogManager] Migration needed but dialog already shown');
				return { success: true, migrated: false, cancelled: false };
			}

			// Show the dialog
			return await this.showDialog();
		} catch (error) {
			console.error('[MigrationDialogManager] Error checking if dialog needed:', error.message);
			return { success: false, error: error.message };
		}
	}

	/**
	 * Show the migration dialog
	 *
	 * Creates and displays the migration dialog window.
	 * Returns a promise that resolves when the dialog is closed.
	 *
	 * @returns {Promise<Object>} Result object with { success, migrated, cancelled }
	 */
	async showDialog() {
		return new Promise((resolve) => {
			try {
				if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
					this.dialogWindow.focus();
					resolve({ success: true, migrated: false, cancelled: false });
					return;
				}

				// Create the dialog window
				this.dialogWindow = new BrowserWindow({
					width: 550,
					height: 650,
					minWidth: 450,
					minHeight: 500,
					show: false,
					modal: true,
					resizable: false,
					webPreferences: {
						preload: path.join(__dirname, 'preload.js'),
						contextIsolation: true,
						nodeIntegration: false,
						sandbox: true,
					},
					icon: path.join(__dirname, 'resources', process.platform === 'win32' ? 'alpaca.ico' : 'alpaca.png'),
				});

				// Load the migration dialog HTML
				const dialogHtmlPath = path.join(__dirname, 'migration-dialog.html');
				this.dialogWindow.loadFile(dialogHtmlPath);

				// Set up IPC handlers for the dialog
				this._setupIpcHandlers(resolve);

				// Show the dialog
				this.dialogWindow.once('ready-to-show', () => {
					this.dialogWindow.show();
					this.dialogShown = true;
				});

				// Handle window closed
				this.dialogWindow.on('closed', () => {
					this.dialogWindow = null;
					// If migration wasn't completed, resolve with cancelled
					if (!this.migrationInProgress) {
						resolve({ success: true, migrated: false, cancelled: true });
					}
				});

				// Open DevTools in development (optional)
				// this.dialogWindow.webContents.openDevTools();
			} catch (error) {
				console.error('[MigrationDialogManager] Error showing dialog:', error.message);
				resolve({ success: false, error: error.message });
			}
		});
	}

	/**
	 * Set up IPC handlers for the dialog
	 *
	 * @private
	 * @param {Function} resolve - Promise resolve function
	 */
	_setupIpcHandlers(resolve) {
		// Handle migration request
		const performMigrationHandler = async (event) => {
			try {
				this.migrationInProgress = true;

				// Perform the migration
				const result = await this.userMigration.migrate();

				// Mark dialog as shown
				this.store.set('migrationDialogShown', true);

				// Emit migration complete event
				this._emit('migration-complete', result);

				// Close the dialog
				if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
					this.dialogWindow.close();
				}

				// Resolve with success
				resolve({ success: true, migrated: true, cancelled: false });

				return { success: true };
			} catch (error) {
				console.error('[MigrationDialogManager] Migration error:', error.message);
				this.migrationInProgress = false;

				// Emit migration error event
				this._emit('migration-error', { error: error.message });

				return {
					success: false,
					error: error.message || 'Migration failed'
				};
			}
		};

		// Handle cancel request
		const cancelMigrationHandler = (event) => {
			try {
				// Mark dialog as shown (so it won't show again)
				this.store.set('migrationDialogShown', true);

				// Close the dialog
				if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
					this.dialogWindow.close();
				}

				// Emit migration cancelled event
				this._emit('migration-cancelled', {});

				// Resolve with cancelled
				resolve({ success: true, migrated: false, cancelled: true });
			} catch (error) {
				console.error('[MigrationDialogManager] Error handling cancel:', error.message);
			}
		};

		// Handle close request
		const closeDialogHandler = (event) => {
			try {
				if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
					this.dialogWindow.close();
				}
			} catch (error) {
				console.error('[MigrationDialogManager] Error closing dialog:', error.message);
			}
		};

		// Register IPC handlers
		ipcMain.handle('migration:performMigration', performMigrationHandler);
		ipcMain.on('migration:cancelMigration', cancelMigrationHandler);
		ipcMain.on('migration:closeDialog', closeDialogHandler);

		// Store handlers for cleanup
		this._ipcHandlers = {
			performMigration: performMigrationHandler,
			cancelMigration: cancelMigrationHandler,
			closeDialog: closeDialogHandler
		};
	}

	/**
	 * Clean up IPC handlers
	 *
	 * @private
	 */
	_cleanupIpcHandlers() {
		if (this._ipcHandlers) {
			try {
				ipcMain.removeHandler('migration:performMigration');
				ipcMain.removeAllListeners('migration:cancelMigration');
				ipcMain.removeAllListeners('migration:closeDialog');
			} catch (error) {
				console.error('[MigrationDialogManager] Error cleaning up IPC handlers:', error.message);
			}
			this._ipcHandlers = null;
		}
	}

	/**
	 * Close the migration dialog
	 *
	 * @returns {void}
	 */
	closeDialog() {
		try {
			if (this.dialogWindow && !this.dialogWindow.isDestroyed()) {
				this.dialogWindow.close();
			}
		} catch (error) {
			console.error('[MigrationDialogManager] Error closing dialog:', error.message);
		}
	}

	/**
	 * Destroy the manager and clean up resources
	 *
	 * @returns {void}
	 */
	destroy() {
		try {
			this._cleanupIpcHandlers();
			this.closeDialog();
			this.eventListeners = {};
		} catch (error) {
			console.error('[MigrationDialogManager] Error destroying manager:', error.message);
		}
	}

	/**
	 * Event listener management
	 */

	/**
	 * Register event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 */
	on(event, callback) {
		if (!this.eventListeners[event]) {
			this.eventListeners[event] = [];
		}
		this.eventListeners[event].push(callback);
	}

	/**
	 * Unregister event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} callback - Callback function
	 */
	off(event, callback) {
		if (!this.eventListeners[event]) {
			return;
		}
		this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
	}

	/**
	 * Emit event
	 *
	 * @private
	 * @param {string} event - Event name
	 * @param {*} data - Event data
	 */
	_emit(event, data) {
		if (!this.eventListeners[event]) {
			return;
		}
		this.eventListeners[event].forEach(callback => {
			try {
				callback(data);
			} catch (error) {
				console.error(`[MigrationDialogManager] Error in event listener for ${event}:`, error.message);
			}
		});
	}
}

module.exports = {
	MigrationDialogManager
};

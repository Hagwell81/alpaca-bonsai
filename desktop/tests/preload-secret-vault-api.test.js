/* eslint-env node */
/**
 * Tests for preload.js Secret_Vault API exposure
 *
 * Verifies that Secret_Vault APIs are properly exposed via contextBridge
 * and that IPC handlers in main.js work correctly.
 *
 * Run with: node desktop/tests/preload-secret-vault-api.test.js
 */

const assert = require('assert');
const path = require('path');

/**
 * Test helper
 */
function test(name, fn) {
	try {
		const result = fn();
		if (result && typeof result.then === 'function') {
			// Async test
			result
				.then(() => {
					console.log(`  PASS: ${name}`);
				})
				.catch((err) => {
					console.error(`  FAIL: ${name}`);
					console.error(`    ${err.message}`);
					process.exitCode = 1;
				});
		} else {
			// Sync test
			console.log(`  PASS: ${name}`);
		}
	} catch (err) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${err.message}`);
		process.exitCode = 1;
	}
}

console.log('Preload Secret_Vault API Tests\n');

// ============================================================================
// Preload API Structure Tests
// ============================================================================

console.log('Preload API Structure:');

test('preload.js exists', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	assert.ok(fs.existsSync(preloadPath), 'preload.js file should exist');
});

test('preload.js contains secretVaultAPI exposure', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('secretVaultAPI'),
		'preload.js should expose secretVaultAPI'
	);
	assert.ok(
		content.includes('contextBridge.exposeInMainWorld'),
		'preload.js should use contextBridge.exposeInMainWorld'
	);
});

test('preload.js exposes getSecret API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('getSecret:'),
		'preload.js should expose getSecret method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:getSecret'"),
		'getSecret should use vault:getSecret IPC handler'
	);
});

test('preload.js exposes setSecret API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('setSecret:'),
		'preload.js should expose setSecret method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:setSecret'"),
		'setSecret should use vault:setSecret IPC handler'
	);
});

test('preload.js exposes deleteSecret API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('deleteSecret:'),
		'preload.js should expose deleteSecret method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:deleteSecret'"),
		'deleteSecret should use vault:deleteSecret IPC handler'
	);
});

test('preload.js exposes getSecretMetadata API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('getSecretMetadata:'),
		'preload.js should expose getSecretMetadata method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:getSecretMetadata'"),
		'getSecretMetadata should use vault:getSecretMetadata IPC handler'
	);
});

test('preload.js exposes listSecrets API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('listSecrets:'),
		'preload.js should expose listSecrets method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:listSecrets'"),
		'listSecrets should use vault:listSecrets IPC handler'
	);
});

test('preload.js exposes refreshToken API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('refreshToken:'),
		'preload.js should expose refreshToken method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:refreshToken'"),
		'refreshToken should use vault:refreshToken IPC handler'
	);
});

test('preload.js exposes verifyMasterKeyChecksum API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('verifyMasterKeyChecksum:'),
		'preload.js should expose verifyMasterKeyChecksum method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:verifyMasterKeyChecksum'"),
		'verifyMasterKeyChecksum should use vault:verifyMasterKeyChecksum IPC handler'
	);
});

test('preload.js exposes isInitialized API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('isInitialized:'),
		'preload.js should expose isInitialized method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:isInitialized'"),
		'isInitialized should use vault:isInitialized IPC handler'
	);
});

test('preload.js exposes getEncryptionBackend API', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('getEncryptionBackend:'),
		'preload.js should expose getEncryptionBackend method'
	);
	assert.ok(
		content.includes("ipcRenderer.invoke('vault:getEncryptionBackend'"),
		'getEncryptionBackend should use vault:getEncryptionBackend IPC handler'
	);
});

// ============================================================================
// IPC Handler Tests
// ============================================================================

console.log('\nIPC Handler Structure:');

test('main.js contains vault:getSecret handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:getSecret'"),
		'main.js should have vault:getSecret IPC handler'
	);
});

test('main.js contains vault:setSecret handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:setSecret'"),
		'main.js should have vault:setSecret IPC handler'
	);
});

test('main.js contains vault:deleteSecret handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:deleteSecret'"),
		'main.js should have vault:deleteSecret IPC handler'
	);
});

test('main.js contains vault:getSecretMetadata handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:getSecretMetadata'"),
		'main.js should have vault:getSecretMetadata IPC handler'
	);
});

test('main.js contains vault:listSecrets handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:listSecrets'"),
		'main.js should have vault:listSecrets IPC handler'
	);
});

test('main.js contains vault:refreshToken handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:refreshToken'"),
		'main.js should have vault:refreshToken IPC handler'
	);
});

test('main.js contains vault:verifyMasterKeyChecksum handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:verifyMasterKeyChecksum'"),
		'main.js should have vault:verifyMasterKeyChecksum IPC handler'
	);
});

test('main.js contains vault:isInitialized handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:isInitialized'"),
		'main.js should have vault:isInitialized IPC handler'
	);
});

test('main.js contains vault:getEncryptionBackend handler', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	assert.ok(
		content.includes("ipcMain.handle('vault:getEncryptionBackend'"),
		'main.js should have vault:getEncryptionBackend IPC handler'
	);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

console.log('\nError Handling:');

test('vault:getSecret handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:getSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:setSecret'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:getSecret handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:getSecret handler should have error handling'
	);
});

test('vault:setSecret handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:setSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:deleteSecret'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:setSecret handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:setSecret handler should have error handling'
	);
});

test('vault:deleteSecret handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:deleteSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:getSecretMetadata'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:deleteSecret handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:deleteSecret handler should have error handling'
	);
});

test('vault:getSecretMetadata handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:getSecretMetadata'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:listSecrets'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:getSecretMetadata handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:getSecretMetadata handler should have error handling'
	);
});

test('vault:listSecrets handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:listSecrets'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:refreshToken'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:listSecrets handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:listSecrets handler should have error handling'
	);
});

test('vault:verifyMasterKeyChecksum handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:verifyMasterKeyChecksum'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:isInitialized'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:verifyMasterKeyChecksum handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:verifyMasterKeyChecksum handler should have error handling'
	);
});

test('vault:isInitialized handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:isInitialized'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:getEncryptionBackend'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:isInitialized handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:isInitialized handler should have error handling'
	);
});

test('vault:getEncryptionBackend handler checks for global.secretVault', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:getEncryptionBackend'");
	const handlerEnd = content.indexOf('// Web search IPC handlers');
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('global.secretVault'),
		'vault:getEncryptionBackend handler should check global.secretVault'
	);
	assert.ok(
		handlerCode.includes('try') && handlerCode.includes('catch'),
		'vault:getEncryptionBackend handler should have error handling'
	);
});

// ============================================================================
// Logging Tests
// ============================================================================

console.log('\nLogging:');

test('vault:getSecret handler includes logging', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:getSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:setSecret'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('console.error'),
		'vault:getSecret handler should include error logging'
	);
});

test('vault:setSecret handler includes logging', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:setSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:deleteSecret'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('console.log') || handlerCode.includes('console.error'),
		'vault:setSecret handler should include logging'
	);
});

test('vault:deleteSecret handler includes logging', () => {
	const mainPath = path.join(__dirname, '..', 'main.js');
	const fs = require('fs');
	const content = fs.readFileSync(mainPath, 'utf8');
	const handlerStart = content.indexOf("ipcMain.handle('vault:deleteSecret'");
	const handlerEnd = content.indexOf("ipcMain.handle('vault:getSecretMetadata'");
	const handlerCode = content.substring(handlerStart, handlerEnd);
	assert.ok(
		handlerCode.includes('console.log') || handlerCode.includes('console.error'),
		'vault:deleteSecret handler should include logging'
	);
});

// ============================================================================
// API Documentation Tests
// ============================================================================

console.log('\nAPI Documentation:');

test('preload.js secretVaultAPI has JSDoc comments', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	const secretVaultStart = content.indexOf('secretVaultAPI');
	const secretVaultEnd = content.indexOf('});', secretVaultStart) + 3;
	const secretVaultCode = content.substring(secretVaultStart, secretVaultEnd);
	assert.ok(
		secretVaultCode.includes('//'),
		'secretVaultAPI should have comments explaining the API'
	);
});

test('preload.js getSecret has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Get a secret by key'),
		'getSecret should have documentation comment'
	);
});

test('preload.js setSecret has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Store a secret with optional metadata'),
		'setSecret should have documentation comment'
	);
});

test('preload.js deleteSecret has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Delete a secret by key'),
		'deleteSecret should have documentation comment'
	);
});

test('preload.js getSecretMetadata has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Get metadata for a secret'),
		'getSecretMetadata should have documentation comment'
	);
});

test('preload.js listSecrets has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// List all stored secret keys'),
		'listSecrets should have documentation comment'
	);
});

test('preload.js verifyMasterKeyChecksum has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Verify master key checksum'),
		'verifyMasterKeyChecksum should have documentation comment'
	);
});

test('preload.js isInitialized has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Check if Secret_Vault is initialized'),
		'isInitialized should have documentation comment'
	);
});

test('preload.js getEncryptionBackend has documentation', () => {
	const preloadPath = path.join(__dirname, '..', 'preload.js');
	const fs = require('fs');
	const content = fs.readFileSync(preloadPath, 'utf8');
	assert.ok(
		content.includes('// Get the current encryption backend'),
		'getEncryptionBackend should have documentation comment'
	);
});

console.log('\nAll tests completed!');

# API Reference - Pre-Dev Enhancements

Complete API reference for all Pre-Dev Enhancements components.

## Table of Contents

1. [Secret_Vault API](#secret_vault-api)
2. [Key_Derivation API](#key_derivation-api)
3. [User_Migration API](#user_migration-api)
4. [HuggingFaceModelService API](#huggingfacemodelservice-api)
5. [Vision_Pairing_Manager API](#vision_pairing_manager-api)
6. [Model_Loader API](#model_loader-api)
7. [Startup_Telemetry API](#startup_telemetry-api)
8. [Connection_Pool API](#connection_pool-api)
9. [Request_Batcher API](#request_batcher-api)

---

## Secret_Vault API

### Class: SecretVault

Centralized encrypted storage for sensitive data.

#### Constructor

```javascript
const vault = new SecretVault(options);
```

**Parameters:**
- `options` (Object, optional)
  - `storageDir` (string) - Directory for vault storage (default: `~/.config/alpaca/vault`)
  - `encryptionAlgorithm` (string) - Encryption algorithm (default: `aes-256-gcm`)
  - `keyDerivationIterations` (number) - PBKDF2 iterations (default: 100000)

#### Methods

##### initialize()

Initialize vault with master key derivation.

```javascript
await vault.initialize();
```

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `SecretVaultError` - If initialization fails

**Example:**
```javascript
try {
  await vault.initialize();
  console.log('Vault initialized');
} catch (error) {
  console.error('Initialization failed:', error.message);
}
```

##### setSecret(key, value, options)

Store encrypted secret.

```javascript
await vault.setSecret(key, value, options);
```

**Parameters:**
- `key` (string) - Secret identifier
- `value` (string) - Secret value to encrypt
- `options` (Object, optional)
  - `expiresAt` (Date) - Expiration date
  - `scope` (string) - Scope identifier (e.g., 'huggingface')
  - `metadata` (Object) - Additional metadata

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `SecretVaultError` - If encryption fails

**Example:**
```javascript
await vault.setSecret('hf-token', 'hf_xxxxxxxxxxxx', {
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  scope: 'huggingface',
  metadata: { model: 'llama-2' }
});
```

##### getSecret(key)

Retrieve decrypted secret.

```javascript
const value = await vault.getSecret(key);
```

**Parameters:**
- `key` (string) - Secret identifier

**Returns:** `Promise&lt;string&gt; - Decrypted secret value

**Throws:**
- `SecretVaultError` - If secret not found or decryption fails

**Error Codes:**
- `SECRET_NOT_FOUND` - Secret does not exist
- `DECRYPTION_FAILED` - Failed to decrypt secret
- `CROSS_MACHINE_DETECTED` - Secret from different machine

**Example:**
```javascript
try {
  const token = await vault.getSecret('hf-token');
  console.log('Token retrieved:', token.substring(0, 10) + '...');
} catch (error) {
  if (error.code === 'SECRET_NOT_FOUND') {
    console.log('Secret does not exist');
  } else if (error.code === 'CROSS_MACHINE_DETECTED') {
    console.log('Secret from different machine');
  }
}
```

##### deleteSecret(key)

Delete secret.

```javascript
await vault.deleteSecret(key);
```

**Parameters:**
- `key` (string) - Secret identifier

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `SecretVaultError` - If deletion fails

**Example:**
```javascript
await vault.deleteSecret('hf-token');
console.log('Secret deleted');
```

##### listSecrets()

List all stored secret keys.

```javascript
const keys = await vault.listSecrets();
```

**Returns:** Promise&lt;string[]&gt; - Array of secret keys

**Throws:**
- `SecretVaultError` - If listing fails

**Example:**
```javascript
const secrets = await vault.listSecrets();
console.log('Stored secrets:', secrets);
// Output: ['hf-token', 'api-key', 'user-record-1']
```

##### refreshToken(key, refreshFn)

Refresh expiring token.

```javascript
const newToken = await vault.refreshToken(key, refreshFn);
```

**Parameters:**
- `key` (string) - Secret identifier
- `refreshFn` (Function) - Async function that returns new token

**Returns:** `Promise&lt;string&gt; - New token value

**Throws:**
- `SecretVaultError` - If refresh fails

**Example:**
```javascript
const newToken = await vault.refreshToken('hf-token', async () => {
  // Fetch new token from HuggingFace API
  const response = await fetch('https://huggingface.co/api/token/refresh', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${oldToken}` }
  });
  const data = await response.json();
  return data.token;
});
```

##### getSecretMetadata(key)

Get secret metadata.

```javascript
const metadata = await vault.getSecretMetadata(key);
```

**Parameters:**
- `key` (string) - Secret identifier

**Returns:** `Promise&lt;Object&gt;
- `expiresAt` (Date) - Expiration date
- `scope` (string) - Scope identifier
- `metadata` (Object) - Additional metadata
- `createdAt` (Date) - Creation date
- `updatedAt` (Date) - Last update date

**Throws:**
- `SecretVaultError` - If metadata retrieval fails

**Example:**
```javascript
const metadata = await vault.getSecretMetadata('hf-token');
console.log('Expires at:', metadata.expiresAt);
console.log('Scope:', metadata.scope);
```

##### verifyMasterKeyChecksum()

Verify cross-machine detection.

```javascript
const isValid = await vault.verifyMasterKeyChecksum();
```

**Returns:** `Promise&lt;boolean&gt; - True if checksum valid

**Throws:**
- `SecretVaultError` - If verification fails

**Example:**
```javascript
const isValid = await vault.verifyMasterKeyChecksum();
if (!isValid) {
  console.log('Machine changed, re-initialize vault');
}
```

---

## Key_Derivation API

### Class: KeyDerivation

Machine-bound key derivation service.

#### Constructor

```javascript
const keyDerivation = new KeyDerivation(options);
```

**Parameters:**
- `options` (Object, optional)
  - `algorithm` (string) - Derivation algorithm (default: `pbkdf2`)
  - `iterations` (number) - PBKDF2 iterations (default: 100000)
  - `hashAlgorithm` (string) - Hash algorithm (default: `sha256`)

#### Methods

##### deriveKey()

Derive machine-bound key from platform identity.

```javascript
const key = await keyDerivation.deriveKey();
```

**Returns:** `Promise&lt;Buffer&gt; - Derived key

**Throws:**
- `KeyDerivationError` - If key derivation fails

**Platform-Specific Behavior:**
- **Windows**: Uses System UUID + User SID
- **macOS**: Uses Hardware UUID
- **Linux**: Uses Machine ID + User UID

**Example:**
```javascript
try {
  const key = await keyDerivation.deriveKey();
  console.log('Key derived:', key.toString('hex').substring(0, 16) + '...');
} catch (error) {
  console.error('Key derivation failed:', error.message);
}
```

##### deriveKeyFromPassphrase(passphrase)

Derive key from user-provided passphrase.

```javascript
const key = await keyDerivation.deriveKeyFromPassphrase(passphrase);
```

**Parameters:**
- `passphrase` (string) - User-provided passphrase

**Returns:** `Promise&lt;Buffer&gt; - Derived key

**Throws:**
- `KeyDerivationError` - If derivation fails

**Example:**
```javascript
const passphrase = await getUserPassphrase();
const key = await keyDerivation.deriveKeyFromPassphrase(passphrase);
```

##### verifyChecksum(checksum)

Verify cross-machine detection.

```javascript
const isValid = await keyDerivation.verifyChecksum(checksum);
```

**Parameters:**
- `checksum` (string) - SHA-256 checksum to verify

**Returns:** `Promise&lt;boolean&gt; - True if checksum matches

**Throws:**
- `KeyDerivationError` - If verification fails

**Example:**
```javascript
const isValid = await keyDerivation.verifyChecksum(storedChecksum);
if (!isValid) {
  console.log('Machine changed');
}
```

##### getPlatformIdentity()

Get platform-specific identity.

```javascript
const identity = await keyDerivation.getPlatformIdentity();
```

**Returns:** `Promise&lt;string&gt; - Platform identity string

**Throws:**
- `KeyDerivationError` - If identity collection fails

**Example:**
```javascript
const identity = await keyDerivation.getPlatformIdentity();
console.log('Platform identity:', identity);
```

---

## User_Migration API

### Class: UserMigration

User record migration service.

#### Constructor

```javascript
const migration = new UserMigration(vault, keyDerivation);
```

**Parameters:**
- `vault` (SecretVault) - Secret vault instance
- `keyDerivation` (KeyDerivation) - Key derivation instance

#### Methods

##### isMigrationNeeded()

Check if migration is needed.

```javascript
const needed = await migration.isMigrationNeeded();
```

**Returns:** `Promise&lt;boolean&gt; - True if migration needed

**Throws:**
- `MigrationError` - If check fails

**Example:**
```javascript
if (await migration.isMigrationNeeded()) {
  console.log('Migration needed');
}
```

##### showMigrationDialog()

Show migration dialog to user.

```javascript
await migration.showMigrationDialog();
```

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `MigrationError` - If dialog fails

**Example:**
```javascript
await migration.showMigrationDialog();
```

##### migrate()

Perform migration.

```javascript
const result = await migration.migrate();
```

**Returns:** `Promise&lt;Object&gt;
- `recordsEncrypted` (number) - Number of records encrypted
- `recordsDeleted` (number) - Number of old records deleted
- `duration` (number) - Migration duration in milliseconds

**Throws:**
- `MigrationError` - If migration fails

**Example:**
```javascript
const result = await migration.migrate();
console.log(`Migrated ${result.recordsEncrypted} records in ${result.duration}ms`);
```

##### decryptUserRecord(envelope)

Decrypt user record.

```javascript
const record = await migration.decryptUserRecord(envelope);
```

**Parameters:**
- `envelope` (Object) - Encrypted record envelope

**Returns:** `Promise&lt;Object&gt; - Decrypted record

**Throws:**
- `MigrationError` - If decryption fails

**Example:**
```javascript
const envelope = await vault.getSecret('user-record-1');
const record = await migration.decryptUserRecord(envelope);
console.log('Record:', record);
```

##### verifyRecordChecksum(record)

Verify record integrity.

```javascript
const isValid = await migration.verifyRecordChecksum(record);
```

**Parameters:**
- `record` (Object) - Record to verify

**Returns:** `Promise&lt;boolean&gt; - True if checksum valid

**Throws:**
- `MigrationError` - If verification fails

**Example:**
```javascript
const isValid = await migration.verifyRecordChecksum(record);
if (!isValid) {
  console.log('Record integrity check failed');
}
```

---

## HuggingFaceModelService API

### Class: HuggingFaceModelService

HuggingFace API service.

#### Constructor

```javascript
const hfService = new HuggingFaceModelService(vault, options);
```

**Parameters:**
- `vault` (SecretVault) - Secret vault for token storage
- `options` (Object, optional)
  - `baseUrl` (string) - HF API base URL (default: `https://huggingface.co`)
  - `timeout` (number) - Request timeout in ms (default: 30000)
  - `maxRetries` (number) - Max retry attempts (default: 5)

#### Methods

##### fetchRepoMetadata(repoId)

Fetch repository metadata.

```javascript
const metadata = await hfService.fetchRepoMetadata(repoId);
```

**Parameters:**
- `repoId` (string) - Repository ID (e.g., `bartowski/Llama-2-7B-GGUF`)

**Returns:** `Promise&lt;Object&gt;
- `id` (string) - Repository ID
- `private` (boolean) - Is private
- `gated` (boolean) - Is gated
- `siblings` (Array) - Files in repository

**Throws:**
- `HFServiceError` - If fetch fails

**Error Codes:**
- `REPO_NOT_FOUND` - Repository not found (404)
- `UNAUTHORIZED` - Token required (401)
- `RATE_LIMITED` - Rate limited (429)

**Example:**
```javascript
try {
  const metadata = await hfService.fetchRepoMetadata('bartowski/Llama-2-7B-GGUF');
  console.log('Files:', metadata.siblings.length);
} catch (error) {
  if (error.code === 'REPO_NOT_FOUND') {
    console.log('Repository not found');
  }
}
```

##### parseRepoSiblings(siblings)

Parse repository siblings.

```javascript
const parsed = await hfService.parseRepoSiblings(siblings);
```

**Parameters:**
- `siblings` (Array) - Siblings array from metadata

**Returns:** `Promise&lt;Object&gt;
- `models` (Array) - GGUF model files
- `mmprojs` (Array) - Vision model files
- `other` (Array) - Other files

**Throws:**
- `HFServiceError` - If parsing fails

**Example:**
```javascript
const parsed = await hfService.parseRepoSiblings(metadata.siblings);
console.log('Models:', parsed.models);
console.log('Vision models:', parsed.mmprojs);
```

##### downloadWithResume(repoId, filename, targetPath)

Download with resume support.

```javascript
const download = await hfService.downloadWithResume(repoId, filename, targetPath);
```

**Parameters:**
- `repoId` (string) - Repository ID
- `filename` (string) - File to download
- `targetPath` (string) - Target file path

**Returns:** EventEmitter
- `progress` event: `{ downloaded, total, percentage }`
- `complete` event: `{ filePath, hash }`
- `error` event: `{ error, resumeFrom }`

**Throws:**
- `HFServiceError` - If download fails

**Example:**
```javascript
const download = await hfService.downloadWithResume(
  'bartowski/Llama-2-7B-GGUF',
  'model.gguf',
  '/path/to/model.gguf'
);

download.on('progress', (progress) => {
  console.log(`Downloaded: ${progress.percentage}%`);
});

download.on('complete', (result) => {
  console.log('Download complete:', result.filePath);
});

download.on('error', (error) => {
  console.error('Download error:', error.message);
});
```

##### verifyDownloadHash(filePath, expectedHash)

Verify download hash.

```javascript
const isValid = await hfService.verifyDownloadHash(filePath, expectedHash);
```

**Parameters:**
- `filePath` (string) - File path to verify
- `expectedHash` (string) - Expected SHA-256 hash

**Returns:** `Promise&lt;boolean&gt; - True if hash matches

**Throws:**
- `HFServiceError` - If verification fails

**Example:**
```javascript
const isValid = await hfService.verifyDownloadHash(
  '/path/to/model.gguf',
  'sha256_hash_from_metadata'
);
if (!isValid) {
  console.log('Hash mismatch, file corrupted');
}
```

##### detectVisionPairing(siblings)

Detect vision model pairing.

```javascript
const pairing = await hfService.detectVisionPairing(siblings);
```

**Parameters:**
- `siblings` (Array) - Siblings array from metadata

**Returns:** `Promise&lt;Object&gt;
- `baseModel` (string) - Base model filename
- `mmproj` (string) - Vision model filename
- `quantization` (string) - Quantization level

**Throws:**
- `HFServiceError` - If detection fails

**Example:**
```javascript
const pairing = await hfService.detectVisionPairing(metadata.siblings);
if (pairing) {
  console.log('Vision model:', pairing.mmproj);
}
```

---

## Vision_Pairing_Manager API

### Class: VisionPairingManager

Vision model pairing manager.

#### Constructor

```javascript
const pairingManager = new VisionPairingManager(options);
```

**Parameters:**
- `options` (Object, optional)
  - `storageDir` (string) - Storage directory (default: `~/.config/alpaca/pairings`)

#### Methods

##### storeModelPair(baseModel, mmproj, quantization)

Store model pair.

```javascript
await pairingManager.storeModelPair(baseModel, mmproj, quantization);
```

**Parameters:**
- `baseModel` (string) - Base model filename
- `mmproj` (string) - Vision model filename
- `quantization` (string) - Quantization level

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `PairingError` - If storage fails

**Example:**
```javascript
await pairingManager.storeModelPair(
  'Llama-2-7B-GGUF.gguf',
  'Llama-2-7B-GGUF.mmproj',
  'Q4_K_M'
);
```

##### getModelPair(baseModel)

Get model pair.

```javascript
const pair = await pairingManager.getModelPair(baseModel);
```

**Parameters:**
- `baseModel` (string) - Base model filename

**Returns:** `Promise&lt;Object&gt;
- `mmproj` (string) - Vision model filename
- `quantization` (string) - Quantization level
- `offload` (boolean) - Offload flag

**Throws:**
- `PairingError` - If retrieval fails

**Example:**
```javascript
const pair = await pairingManager.getModelPair('Llama-2-7B-GGUF.gguf');
console.log('Vision model:', pair.mmproj);
```

##### updateOffloadFlag(baseModel, offload)

Update offload flag.

```javascript
await pairingManager.updateOffloadFlag(baseModel, offload);
```

**Parameters:**
- `baseModel` (string) - Base model filename
- `offload` (boolean) - Offload flag

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `PairingError` - If update fails

**Example:**
```javascript
await pairingManager.updateOffloadFlag('Llama-2-7B-GGUF.gguf', true);
```

##### getAllPairs()

Get all pairings.

```javascript
const pairs = await pairingManager.getAllPairs();
```

**Returns:** `Promise&lt;Object&gt; - Map of base model to pairing

**Throws:**
- `PairingError` - If retrieval fails

**Example:**
```javascript
const pairs = await pairingManager.getAllPairs();
for (const [baseModel, pair] of Object.entries(pairs)) {
  console.log(`${baseModel} -> ${pair.mmproj}`);
}
```

##### deletePair(baseModel)

Delete pairing.

```javascript
await pairingManager.deletePair(baseModel);
```

**Parameters:**
- `baseModel` (string) - Base model filename

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `PairingError` - If deletion fails

**Example:**
```javascript
await pairingManager.deletePair('Llama-2-7B-GGUF.gguf');
```

---

## Model_Loader API

### Class: ModelLoader

Model loader with warm-cache.

#### Constructor

```javascript
const loader = new ModelLoader(options);
```

**Parameters:**
- `options` (Object, optional)
  - `cacheSize` (number) - Cache size (default: 3)
  - `cacheTTL` (number) - Cache TTL in ms (default: 5 * 60 * 1000)

#### Methods

##### loadModel(modelPath)

Load model.

```javascript
const model = await loader.loadModel(modelPath);
```

**Parameters:**
- `modelPath` (string) - Path to model file

**Returns:** `Promise&lt;Object&gt; - Model object

**Throws:**
- `LoaderError` - If loading fails

**Example:**
```javascript
const model = await loader.loadModel('/path/to/model.gguf');
console.log('Model loaded');
```

##### checkQuantizationCompatibility(modelPath, quantization)

Check quantization compatibility.

```javascript
const isCompatible = await loader.checkQuantizationCompatibility(modelPath, quantization);
```

**Parameters:**
- `modelPath` (string) - Path to model file
- `quantization` (string) - Quantization level

**Returns:** `Promise&lt;boolean&gt; - True if compatible

**Throws:**
- `LoaderError` - If check fails

**Example:**
```javascript
const isCompatible = await loader.checkQuantizationCompatibility(
  '/path/to/model.gguf',
  'Q4_K_M'
);
```

##### getCacheStatistics()

Get cache statistics.

```javascript
const stats = loader.getCacheStatistics();
```

**Returns:** Object
- `cacheHits` (number) - Number of cache hits
- `cacheMisses` (number) - Number of cache misses
- `averageLoadTime` (number) - Average load time in ms
- `cachedModels` (Array) - Currently cached models

**Example:**
```javascript
const stats = loader.getCacheStatistics();
console.log('Cache hits:', stats.cacheHits);
console.log('Average load time:', stats.averageLoadTime, 'ms');
```

---

## Startup_Telemetry API

### Class: StartupTelemetry

Startup performance telemetry.

#### Constructor

```javascript
const telemetry = new StartupTelemetry(options);
```

**Parameters:**
- `options` (Object, optional)
  - `storageDir` (string) - Storage directory (default: `~/.config/alpaca/telemetry`)
  - `slowStartupThreshold` (number) - Slow startup threshold in ms (default: 120000)

#### Methods

##### recordStage(stageName, durationMs, metadata)

Record startup stage.

```javascript
await telemetry.recordStage(stageName, durationMs, metadata);
```

**Parameters:**
- `stageName` (string) - Stage name
- `durationMs` (number) - Duration in milliseconds
- `metadata` (Object, optional) - Additional metadata

**Returns:** `Promise&lt;void&gt;

**Throws:**
- `TelemetryError` - If recording fails

**Example:**
```javascript
await telemetry.recordStage('model-load', 3000, { model: 'llama-2' });
```

##### getMetrics()

Get aggregated metrics.

```javascript
const metrics = await telemetry.getMetrics();
```

**Returns:** `Promise&lt;Object&gt;
- `stages` (Object) - Per-stage statistics
- `totalTime` (number) - Total startup time
- `slowStartupCount` (number) - Count of slow startups

**Throws:**
- `TelemetryError` - If retrieval fails

**Example:**
```javascript
const metrics = await telemetry.getMetrics();
console.log('Total startup time:', metrics.totalTime, 'ms');
console.log('Slow startups:', metrics.slowStartupCount);
```

##### getTrend(days)

Get 30-day trend.

```javascript
const trend = await telemetry.getTrend(days);
```

**Parameters:**
- `days` (number) - Number of days to analyze (default: 30)

**Returns:** `Promise&lt;Object&gt;
- `averageByDay` (Array) - Average startup time by day
- `slowStartupTrend` (Array) - Slow startup count by day

**Throws:**
- `TelemetryError` - If retrieval fails

**Example:**
```javascript
const trend = await telemetry.getTrend(30);
console.log('30-day average:', trend.averageByDay);
```

---

## Connection_Pool API

### Class: ConnectionPool

HTTP connection pooling.

#### Constructor

```javascript
const pool = new ConnectionPool(options);
```

**Parameters:**
- `options` (Object, optional)
  - `maxSockets` (number) - Max sockets (default: 8)
  - `keepAlive` (boolean) - Keep alive (default: true)
  - `keepAliveMsecs` (number) - Keep alive interval in ms (default: 30000)
  - `timeout` (number) - Timeout in ms (default: 60000)

#### Methods

##### getAgent()

Get pooled agent.

```javascript
const agent = pool.getAgent();
```

**Returns:** http.Agent - Pooled HTTP agent

**Example:**
```javascript
const agent = pool.getAgent();
const response = await fetch(url, { agent });
```

##### getStatistics()

Get pool statistics.

```javascript
const stats = pool.getStatistics();
```

**Returns:** Object
- `activeConnections` (number) - Active connections
- `totalRequests` (number) - Total requests
- `averageLatency` (number) - Average latency in ms

**Example:**
```javascript
const stats = pool.getStatistics();
console.log('Active connections:', stats.activeConnections);
```

---

## Request_Batcher API

### Class: RequestBatcher

Request batching for embeddings.

#### Constructor

```javascript
const batcher = new RequestBatcher(options);
```

**Parameters:**
- `options` (Object, optional)
  - `timeWindow` (number) - Time window in ms (default: 50)
  - `batchSize` (number) - Batch size (default: 100)
  - `endpoint` (string) - API endpoint (default: `/v1/embeddings`)

#### Methods

##### queue(request)

Queue request for batching.

```javascript
const promise = batcher.queue(request);
```

**Parameters:**
- `request` (Object) - Request object

**Returns:** `Promise&lt;Object&gt; - Response object

**Example:**
```javascript
const result = await batcher.queue({ input: 'text' });
console.log('Result:', result);
```

##### getStatistics()

Get batching statistics.

```javascript
const stats = batcher.getStatistics();
```

**Returns:** Object
- `totalBatches` (number) - Total batches sent
- `averageBatchSize` (number) - Average batch size
- `totalRequests` (number) - Total requests processed

**Example:**
```javascript
const stats = batcher.getStatistics();
console.log('Total batches:', stats.totalBatches);
console.log('Average batch size:', stats.averageBatchSize);
```

---

## Error Handling

All APIs throw errors with the following structure:

```javascript
{
  code: 'ERROR_CODE',
  message: 'Human-readable error message',
  details: { /* Additional details */ }
}
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| `VAULT_NOT_INITIALIZED` | Vault not initialized |
| `SECRET_NOT_FOUND` | Secret does not exist |
| `DECRYPTION_FAILED` | Failed to decrypt secret |
| `CROSS_MACHINE_DETECTED` | Secret from different machine |
| `REPO_NOT_FOUND` | Repository not found |
| `UNAUTHORIZED` | Token required |
| `RATE_LIMITED` | Rate limited |
| `DOWNLOAD_FAILED` | Download failed |
| `HASH_MISMATCH` | Hash verification failed |

---

## Examples

### Complete Example: Download and Load Model

```javascript
const { SecretVault } = require('./secret-vault');
const { HuggingFaceModelService } = require('./hf-model-service');
const { VisionPairingManager } = require('./vision-pairing-manager');
const { ModelLoader } = require('./model-loader');

// Initialize components
const vault = new SecretVault();
await vault.initialize();

const hfService = new HuggingFaceModelService(vault);
const pairingManager = new VisionPairingManager();
const loader = new ModelLoader();

// Fetch repository metadata
const metadata = await hfService.fetchRepoMetadata('bartowski/Llama-2-7B-GGUF');

// Parse files
const parsed = await hfService.parseRepoSiblings(metadata.siblings);

// Download model
const download = await hfService.downloadWithResume(
  'bartowski/Llama-2-7B-GGUF',
  parsed.models[0].filename,
  '/path/to/model.gguf'
);

download.on('progress', (progress) => {
  console.log(`Downloaded: ${progress.percentage}%`);
});

await new Promise((resolve, reject) => {
  download.on('complete', resolve);
  download.on('error', reject);
});

// Detect vision pairing
const pairing = await hfService.detectVisionPairing(metadata.siblings);
if (pairing) {
  await pairingManager.storeModelPair(
    parsed.models[0].filename,
    pairing.mmproj,
    pairing.quantization
  );
}

// Load model
const model = await loader.loadModel('/path/to/model.gguf');
console.log('Model loaded successfully');
```





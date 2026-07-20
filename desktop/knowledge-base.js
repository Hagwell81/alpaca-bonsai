/**
 * Knowledge Base Module
 *
 * Provides document ingestion, vector storage, semantic search, and RAG
 * capabilities for the alpaca desktop application.
 *
 * Architecture:
 * - SQLite-backed storage for documents, chunks, and embeddings
 * - Embeddings generated via the local /v1/embeddings API endpoint
 * - Cosine similarity search in JavaScript (no native vector extension required)
 * - MCP server exposure for external tool integration
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

const sqlite3 = require('sqlite3').verbose();

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;

function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  if (!text || typeof text !== 'string') return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let splitPoint = end;
    if (end < text.length) {
      // Try to split at a sentence boundary or whitespace
      const searchRange = text.slice(Math.max(start, end - 64), end);
      const lastSentence = searchRange.lastIndexOf('. ');
      const lastNewline = searchRange.lastIndexOf('\n');
      const lastSpace = searchRange.lastIndexOf(' ');
      const best = Math.max(lastSentence, lastNewline, lastSpace);
      if (best > 0) {
        splitPoint = Math.max(start, end - 64) + best + 1;
      }
    }
    chunks.push(text.slice(start, splitPoint).trim());
    start = splitPoint - overlap;
    if (start <= 0 || splitPoint >= text.length) break;
  }
  return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// Embedding client (calls local llama-server /v1/embeddings)
// ---------------------------------------------------------------------------

async function getEmbedding(text, port = 13434) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      input: text,
      model: 'local-embedding'
    });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/embeddings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.data && json.data[0] && json.data[0].embedding) {
              resolve(json.data[0].embedding);
            } else if (json.error) {
              reject(new Error(json.error.message || JSON.stringify(json.error)));
            } else {
              reject(new Error('Invalid embedding response'));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Embedding request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// KnowledgeBase class
// ---------------------------------------------------------------------------

class KnowledgeBase extends EventEmitter {
  constructor({ app, store, logger = console, embeddingPort = 13434 } = {}) {
    super();
    this.app = app;
    this.store = store;
    this.logger = logger;
    this.embeddingPort = embeddingPort;
    this.db = null;
    this.dbPath = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    const kbDir = this.app
      ? path.join(this.app.getPath('userData'), 'knowledge-base')
      : path.join(require('os').homedir(), '.alpaca', 'knowledge-base');
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }
    this.dbPath = path.join(kbDir, 'knowledge-base.db');
    this.db = new sqlite3.Database(this.dbPath);
    await this._runMigrations();
    this.initialized = true;
    this.logger.log('[KnowledgeBase] Initialized at', this.dbPath);
  }

  _runMigrations() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          `CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at INTEGER,
            updated_at INTEGER
          )`
        );
        this.db.run(
          `CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_path TEXT,
            content_preview TEXT,
            chunk_count INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
          )`
        );
        this.db.run(
          `CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            text TEXT NOT NULL,
            embedding_json TEXT,
            chunk_index INTEGER,
            created_at INTEGER,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
          )`
        );
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_chunks_collection ON chunks(collection_id)`
        );
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)`
        );
        this.db.run(
          `CREATE TABLE IF NOT EXISTS ingest_jobs (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            error TEXT,
            created_at INTEGER,
            completed_at INTEGER
          )`
        );
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // Collections
  // -------------------------------------------------------------------------

  async createCollection(name, description = '') {
    const id = `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, name, description, now, now],
        (err) => {
          if (err) return reject(err);
          resolve({ id, name, description, created_at: now, updated_at: now });
        }
      );
    });
  }

  async getCollections() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM collections ORDER BY updated_at DESC',
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  async deleteCollection(id) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM collections WHERE id = ?', [id], (err) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Document ingestion
  // -------------------------------------------------------------------------

  async ingestDocuments(collectionId, fileEntries, options = {}) {
    const jobId = `job_${Date.now()}`;
    const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;

    // Insert job
    await new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO ingest_jobs (id, collection_id, status, total, created_at) VALUES (?, ?, ?, ?, ?)',
        [jobId, collectionId, 'running', fileEntries.length, Date.now()],
        (err) => (err ? reject(err) : resolve())
      );
    });

    (async () => {
      try {
        for (let i = 0; i < fileEntries.length; i++) {
          const entry = fileEntries[i];
          try {
            await this._ingestSingleFile(collectionId, entry, chunkSize, chunkOverlap);
          } catch (err) {
            this.logger.warn(`[KnowledgeBase] Failed to ingest ${entry.name}:`, err.message);
          }
          await this._updateJobProgress(jobId, i + 1);
        }
        await this._completeJob(jobId);
        this.emit('ingestComplete', { jobId, collectionId });
      } catch (err) {
        await this._failJob(jobId, err.message);
        this.emit('ingestError', { jobId, collectionId, error: err.message });
      }
    })();

    return { jobId, status: 'running', total: fileEntries.length };
  }

  async ingestUrl(collectionId, url, options = {}) {
    const text = await this._fetchWebPageText(url);
    const filename = url.replace(/^https?:\/\//, '').replace(/[<>:"|?*]/g, '_');
    return this.ingestDocuments(collectionId, [
      { name: filename, path: url, content: text, sourceType: 'url' }
    ], options);
  }

  async _ingestSingleFile(collectionId, entry, chunkSize, chunkOverlap) {
    const { name, path: filePath, content, sourceType = 'file' } = entry;
    let text = content;

    if (!text && filePath && fs.existsSync(filePath)) {
      text = await this._readFileText(filePath);
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text content available');
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // Chunk
    const chunks = chunkText(text, chunkSize, chunkOverlap);

    // Insert document
    await new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO documents (id, collection_id, filename, source_type, source_path, content_preview, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [docId, collectionId, name, sourceType, filePath || '', text.slice(0, 500), chunks.length, now, now],
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Generate embeddings and insert chunks
    for (let idx = 0; idx < chunks.length; idx++) {
      let embedding = null;
      try {
        embedding = await getEmbedding(chunks[idx], this.embeddingPort);
      } catch (err) {
        this.logger.warn(`[KnowledgeBase] Embedding failed for chunk ${idx}:`, err.message);
      }
      const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await new Promise((resolve, reject) => {
        this.db.run(
          'INSERT INTO chunks (id, document_id, collection_id, text, embedding_json, chunk_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [chunkId, docId, collectionId, chunks[idx], embedding ? JSON.stringify(embedding) : null, idx, now],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    return docId;
  }

  async _readFileText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '.json' || ext === '.csv') {
      return fs.readFileSync(filePath, 'utf8');
    }
    if (ext === '.pdf') {
      return this._readPdfText(filePath);
    }
    if (ext === '.docx') {
      return this._readDocxText(filePath);
    }
    // Try as plain text for anything else
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  async _readPdfText(filePath) {
    // Optional: if pdf-parse is installed
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text || '';
    } catch {
      this.logger.warn('[KnowledgeBase] pdf-parse not available; install with: npm install pdf-parse');
      return `[PDF content not extracted - install pdf-parse to enable PDF support]`;
    }
  }

  async _readDocxText(filePath) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    } catch {
      this.logger.warn('[KnowledgeBase] mammoth not available; install with: npm install mammoth');
      return `[DOCX content not extracted - install mammoth to enable DOCX support]`;
    }
  }

  async _fetchWebPageText(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const req = client.get(url, { timeout: 15000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._fetchWebPageText(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // Very basic HTML stripping
          const text = data
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          resolve(text);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async _updateJobProgress(jobId, progress) {
    return new Promise((resolve, reject) => {
      this.db.run('UPDATE ingest_jobs SET progress = ? WHERE id = ?', [progress, jobId], (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  async _completeJob(jobId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE ingest_jobs SET status = 'completed', completed_at = ? WHERE id = ?",
        [Date.now(), jobId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  async _failJob(jobId, error) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE ingest_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
        [error, Date.now(), jobId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(collectionId, query, topK = 5) {
    const queryEmbedding = await getEmbedding(query, this.embeddingPort);
    const chunks = await new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, document_id, text, embedding_json, chunk_index FROM chunks WHERE collection_id = ?',
        [collectionId],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    const scored = chunks
      .map((chunk) => {
        let embedding = null;
        try {
          embedding = chunk.embedding_json ? JSON.parse(chunk.embedding_json) : null;
        } catch {
          embedding = null;
        }
        const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
        return { ...chunk, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Fetch document metadata for results
    const docIds = [...new Set(scored.map((s) => s.document_id))];
    const docs = await new Promise((resolve, reject) => {
      if (docIds.length === 0) return resolve([]);
      const placeholders = docIds.map(() => '?').join(',');
      this.db.all(
        `SELECT id, filename, source_type, source_path FROM documents WHERE id IN (${placeholders})`,
        docIds,
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    const docMap = new Map(docs.map((d) => [d.id, d]));

    return scored.map((s) => ({
      chunkId: s.id,
      documentId: s.document_id,
      documentName: docMap.get(s.document_id)?.filename || 'Unknown',
      sourceType: docMap.get(s.document_id)?.source_type || 'file',
      sourcePath: docMap.get(s.document_id)?.source_path || '',
      text: s.text,
      chunkIndex: s.chunk_index,
      score: s.score
    }));
  }

  async getDocuments(collectionId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, filename, source_type, source_path, content_preview, chunk_count, created_at FROM documents WHERE collection_id = ? ORDER BY created_at DESC',
        [collectionId],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
  }

  async deleteDocument(collectionId, docId) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM documents WHERE id = ? AND collection_id = ?', [docId, collectionId], (err) =>
        err ? reject(err) : resolve({ success: true })
      );
    });
  }

  async getJobStatus(jobId) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM ingest_jobs WHERE id = ?', [jobId], (err, row) =>
        err ? reject(err) : resolve(row || null)
      );
    });
  }

  // -------------------------------------------------------------------------
  // RAG helper
  // -------------------------------------------------------------------------

  async buildRagContext(collectionId, query, topK = 5) {
    const results = await this.search(collectionId, query, topK);
    if (results.length === 0) return '';
    const chunks = results.map((r, i) => `[${i + 1}] ${r.text} (from ${r.documentName})`);
    return `Relevant context from knowledge base:\n\n${chunks.join('\n\n')}`;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  async getStats() {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT COUNT(*) as collectionCount FROM collections',
        (err, colRow) => {
          if (err) return reject(err);
          this.db.get(
            'SELECT COUNT(*) as documentCount FROM documents',
            (err2, docRow) => {
              if (err2) return reject(err2);
              this.db.get(
                'SELECT COUNT(*) as chunkCount FROM chunks',
                (err3, chunkRow) => {
                  if (err3) return reject(err3);
                  resolve({
                    collections: colRow.collectionCount,
                    documents: docRow.documentCount,
                    chunks: chunkRow.chunkCount
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) this.logger.error('[KnowledgeBase] DB close error:', err.message);
          resolve();
        });
      });
    }
  }
}

module.exports = { KnowledgeBase, chunkText, cosineSimilarity };

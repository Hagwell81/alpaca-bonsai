/* eslint-env node */
/**
 * Startup Telemetry Module
 * 
 * Records and analyzes startup performance metrics with SQLite persistence,
 * per-stage metrics computation, 30-day trend analysis, and slow startup warnings.
 * 
 * @module startup-telemetry
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');
const EventEmitter = require('events');

/**
 * Startup Telemetry implementation that records startup stages and computes
 * performance metrics for trend analysis and optimization.
 */
class StartupTelemetry extends EventEmitter {
  /**
   * Creates a new StartupTelemetry instance.
   * 
   * @param {string} dbPath - Path to SQLite database file
   * @param {Object} options - Configuration options
   * @param {number} options.slowStartupThresholdMs - Threshold for slow startup warning (default: 120000ms)
   * @param {number} options.retentionDays - Days to retain telemetry data (default: 90)
   */
  constructor(dbPath = null, options = {}) {
    super();
    
    this.dbPath = dbPath || path.join(app.getPath('userData'), 'startup-telemetry.db');
    this.slowStartupThresholdMs = options.slowStartupThresholdMs || 120000;
    this.retentionDays = options.retentionDays || 90;
    
    this.db = null;
    this.initialized = false;
    this.sessionId = this.generateSessionId();
    this.appVersion = options.appVersion || '1.0.0';
    this.currentSession = {
      stages: {},
      startTime: Date.now(),
      model: null,
      backend: null
    };
    
    // Statistics cache
    this.metricsCache = null;
    this.metricsCacheTime = null;
    this.metricsCacheTTL = 60000; // 1 minute
  }

  /**
   * Generate a unique session ID.
   * 
   * @private
   * @returns {string} Unique session identifier
   */
  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize the telemetry database and create tables if needed.
   * 
   * @returns {Promise<void>}
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to open telemetry database: ${err.message}`));
          return;
        }

        // Create startup_events table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS startup_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            stage TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            metadata TEXT,
            session_id TEXT NOT NULL,
            version TEXT
          )
        `, (err) => {
          if (err) {
            reject(new Error(`Failed to create startup_events table: ${err.message}`));
            return;
          }

          // Create indexes for performance
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON startup_events(timestamp)`, (err) => {
            if (err) {
              reject(new Error(`Failed to create timestamp index: ${err.message}`));
              return;
            }

            this.db.run(`CREATE INDEX IF NOT EXISTS idx_stage ON startup_events(stage)`, (err) => {
              if (err) {
                reject(new Error(`Failed to create stage index: ${err.message}`));
                return;
              }

              // Create index for session_id for session grouping
              this.db.run(`CREATE INDEX IF NOT EXISTS idx_session_id ON startup_events(session_id)`, (err) => {
                if (err) {
                  reject(new Error(`Failed to create session_id index: ${err.message}`));
                  return;
                }

                this.initialized = true;
                resolve();
              });
            });
          });
        });
      });
    });
  }

  /**
   * Record a startup stage completion.
   * 
   * @param {string} stage - Stage name (e.g., "binary-check", "model-load", "http-bind", "webui-load", "total")
   * @param {number} durationMs - Duration of the stage in milliseconds
   * @param {Object} metadata - Additional metadata (model, backend, etc.)
   * @returns {Promise<void>}
   */
  async recordStage(stage, durationMs, metadata = {}) {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    if (typeof stage !== 'string' || !stage.trim()) {
      throw new Error('Stage name must be a non-empty string');
    }

    if (typeof durationMs !== 'number' || durationMs < 0) {
      throw new Error('Duration must be a non-negative number');
    }

    // Check for timeout (300 seconds)
    if (durationMs > 300000) {
      console.warn(`Stage "${stage}" exceeded 300 second timeout: ${durationMs}ms`);
    }

    // Store in current session
    this.currentSession.stages[stage] = durationMs;
    if (metadata.model) this.currentSession.model = metadata.model;
    if (metadata.backend) this.currentSession.backend = metadata.backend;

    // Record to database
    return new Promise((resolve, reject) => {
      const timestamp = Date.now(); // Unix milliseconds
      const metadataJson = JSON.stringify({
        model: metadata.model || this.currentSession.model || null,
        backend: metadata.backend || this.currentSession.backend || null,
        ...metadata
      });

      this.db.run(
        `INSERT INTO startup_events (timestamp, stage, duration_ms, metadata, session_id, version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [timestamp, stage, durationMs, metadataJson, this.sessionId, this.appVersion],
        (err) => {
          if (err) {
            reject(new Error(`Failed to record stage: ${err.message}`));
            return;
          }

          // Invalidate metrics cache
          this.metricsCache = null;

          // Check for slow startup warning
          if (stage === 'total' && durationMs > this.slowStartupThresholdMs) {
            this.emit('startup-slow', {
              duration: durationMs,
              threshold: this.slowStartupThresholdMs,
              sessionId: this.sessionId,
              timestamp,
              excess: durationMs - this.slowStartupThresholdMs
            });
          }

          resolve();
        }
      );
    });
  }

  /**
   * Get aggregated startup metrics.
   * 
   * @param {number} days - Number of days to analyze (default: 30)
   * @returns {Promise<Object>} Metrics object with per-stage statistics and trends
   */
  async getMetrics(days = 30) {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    // Check cache
    if (this.metricsCache && this.metricsCacheTime && Date.now() - this.metricsCacheTime < this.metricsCacheTTL) {
      return this.metricsCache;
    }

    return new Promise((resolve, reject) => {
      const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);

      // Get all events in the time range
      this.db.all(
        `SELECT stage, duration_ms, metadata, session_id, version, timestamp
         FROM startup_events
         WHERE timestamp >= ?
         ORDER BY timestamp DESC`,
        [cutoffMs],
        async (err, rows) => {
          if (err) {
            reject(new Error(`Failed to query metrics: ${err.message}`));
            return;
          }

          try {
            const metrics = this.computeMetrics(rows, days);
            
            // Cache the result
            this.metricsCache = metrics;
            this.metricsCacheTime = Date.now();

            resolve(metrics);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  }

  /**
   * Compute per-stage metrics (average, min, max, p95).
   * 
   * @private
   * @param {Array} rows - Database rows
   * @param {number} days - Number of days analyzed
   * @returns {Object} Computed metrics
   */
  computeMetrics(rows, days) {
    const stageData = {};
    const dailyTotals = {};

    // Group by stage
    for (const row of rows) {
      if (!stageData[row.stage]) {
        stageData[row.stage] = [];
      }
      stageData[row.stage].push(row.duration_ms);

      // Track daily totals for trend
      const date = new Date(row.timestamp).toISOString().split('T')[0];
      if (!dailyTotals[date]) {
        dailyTotals[date] = [];
      }
      if (row.stage === 'total') {
        dailyTotals[date].push(row.duration_ms);
      }
    }

    // Compute per-stage statistics
    const stageMetrics = {};
    for (const [stage, durations] of Object.entries(stageData)) {
      stageMetrics[stage] = this.computeStageStats(durations);
    }

    // Compute trend (daily averages)
    const trend = [];
    const sortedDates = Object.keys(dailyTotals).sort();
    for (const date of sortedDates) {
      const durations = dailyTotals[date];
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      trend.push({
        date,
        avgDuration: Math.round(avg),
        count: durations.length
      });
    }

    // Compute overall statistics
    const totalDurations = stageData['total'] || [];
    const overallStats = totalDurations.length > 0 ? this.computeStageStats(totalDurations) : null;

    return {
      days,
      recordCount: rows.length,
      stageMetrics,
      overallStats,
      trend,
      computedAt: new Date().toISOString()
    };
  }

  /**
   * Compute statistics for a set of durations.
   * 
   * @private
   * @param {Array<number>} durations - Array of duration values
   * @returns {Object} Statistics object with average, min, max, p95
   */
  computeStageStats(durations) {
    if (durations.length === 0) {
      return null;
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / sorted.length);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    // Calculate p95 (95th percentile)
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95 = sorted[Math.max(0, p95Index)];

    return {
      count: sorted.length,
      average: avg,
      min,
      max,
      p95,
      median: sorted[Math.floor(sorted.length / 2)]
    };
  }

  /**
   * Get 30-day trend analysis.
   * 
   * @returns {Promise<Array>} Array of daily trend data
   */
  async getTrendAnalysis() {
    const metrics = await this.getMetrics(30);
    return metrics.trend;
  }

  /**
   * Get slow startup warning if applicable.
   * 
   * @returns {Promise<Object|null>} Warning object or null if no warning
   */
  async getSlowStartupWarning() {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    return new Promise((resolve, reject) => {
      // Get the most recent startup
      this.db.get(
        `SELECT duration_ms, metadata, session_id, timestamp
         FROM startup_events
         WHERE stage = 'total'
         ORDER BY timestamp DESC
         LIMIT 1`,
        (err, row) => {
          if (err) {
            reject(new Error(`Failed to query slow startup: ${err.message}`));
            return;
          }

          if (!row) {
            resolve(null);
            return;
          }

          const excess = row.duration_ms - this.slowStartupThresholdMs;
          if (excess > 0) {
            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            resolve({
              duration: row.duration_ms,
              threshold: this.slowStartupThresholdMs,
              sessionId: row.session_id,
              timestamp: row.timestamp,
              excess: excess,
              metadata
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Clean up old telemetry records.
   * 
   * @returns {Promise<number>} Number of records deleted
   */
  async cleanupOldRecords() {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    return new Promise((resolve, reject) => {
      const cutoffMs = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);

      this.db.run(
        `DELETE FROM startup_events WHERE timestamp < ?`,
        [cutoffMs],
        function(err) {
          if (err) {
            reject(new Error(`Failed to cleanup old records: ${err.message}`));
            return;
          }

          // Invalidate cache
          this.metricsCache = null;

          resolve(this.changes);
        }
      );
    });
  }

  /**
   * Get database statistics.
   * 
   * @returns {Promise<Object>} Database statistics
   */
  async getStats() {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as totalRecords, 
                COUNT(DISTINCT stage) as uniqueStages,
                MIN(timestamp) as oldestRecord,
                MAX(timestamp) as newestRecord
         FROM startup_events`,
        (err, row) => {
          if (err) {
            reject(new Error(`Failed to get stats: ${err.message}`));
            return;
          }

          resolve({
            totalRecords: row.totalRecords,
            uniqueStages: row.uniqueStages,
            oldestRecord: row.oldestRecord,
            newestRecord: row.newestRecord,
            dbPath: this.dbPath
          });
        }
      );
    });
  }

  /**
   * Close the database connection.
   * 
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(new Error(`Failed to close database: ${err.message}`));
          return;
        }
        this.db = null;
        this.initialized = false;
        resolve();
      });
    });
  }

  /**
   * Reset all telemetry data (for testing).
   * 
   * @returns {Promise<void>}
   */
  async reset() {
    if (!this.initialized) {
      throw new Error('StartupTelemetry not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM startup_events`, (err) => {
        if (err) {
          reject(new Error(`Failed to reset telemetry: ${err.message}`));
          return;
        }

        // Invalidate cache
        this.metricsCache = null;
        this.currentSession = {
          stages: {},
          startTime: Date.now(),
          model: null,
          backend: null
        };

        resolve();
      });
    });
  }
}

module.exports = { StartupTelemetry };

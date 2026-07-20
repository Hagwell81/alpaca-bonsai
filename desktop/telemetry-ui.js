/**
 * Telemetry UI Module - Handles startup telemetry visualization and display
 * 
 * This module provides functions to:
 * - Load and display startup telemetry metrics
 * - Render telemetry chart visualization
 * - Display slow startup warnings
 * - Show per-stage metrics breakdown
 */

/**
 * Initialize telemetry UI on page load
 */
async function initializeTelemetryUI() {
  try {
    console.log('[Telemetry UI] Initializing telemetry UI...');
    
    // Check if telemetry API is available
    if (!window.telemetryAPI) {
      console.warn('[Telemetry UI] Telemetry API not available');
      return;
    }

    // Load telemetry metrics
    await loadTelemetryMetrics();
    
    // Set up event listeners
    setupTelemetryEventListeners();
    
    console.log('[Telemetry UI] Telemetry UI initialized successfully');
  } catch (error) {
    console.error('[Telemetry UI] Error initializing telemetry UI:', error);
  }
}

/**
 * Load and display telemetry metrics
 */
async function loadTelemetryMetrics() {
  try {
    // Get metrics from telemetry API
    const metrics = await window.telemetryAPI.getMetrics(30);
    
    if (!metrics) {
      console.warn('[Telemetry UI] No metrics available');
      return;
    }

    // Display overall statistics
    displayOverallStats(metrics);
    
    // Display per-stage metrics
    displayPerStageMetrics(metrics);
    
    // Display trend chart
    displayTrendChart(metrics.trend);
    
    // Check for slow startup warning
    const warning = await window.telemetryAPI.getSlowStartupWarning();
    if (warning) {
      displaySlowStartupWarning(warning);
    }
  } catch (error) {
    console.error('[Telemetry UI] Error loading telemetry metrics:', error);
    showToast('Failed to load telemetry metrics', 'error');
  }
}

/**
 * Display overall startup statistics
 */
function displayOverallStats(metrics) {
  const container = document.getElementById('telemetryOverallStats');
  if (!container) return;

  if (!metrics.overallStats) {
    container.innerHTML = '<p>No startup data available</p>';
    return;
  }

  const stats = metrics.overallStats;
  const html = `
    <div class="info-grid">
      <div class="info-card">
        <div class="value">${formatDuration(stats.average)}</div>
        <div class="label">Average Startup Time</div>
      </div>
      <div class="info-card">
        <div class="value">${formatDuration(stats.min)}</div>
        <div class="label">Fastest Startup</div>
      </div>
      <div class="info-card">
        <div class="value">${formatDuration(stats.max)}</div>
        <div class="label">Slowest Startup</div>
      </div>
      <div class="info-card">
        <div class="value">${formatDuration(stats.p95)}</div>
        <div class="label">95th Percentile</div>
      </div>
      <div class="info-card">
        <div class="value">${stats.count}</div>
        <div class="label">Total Startups</div>
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

/**
 * Display per-stage metrics breakdown
 */
function displayPerStageMetrics(metrics) {
  const container = document.getElementById('telemetryPerStageMetrics');
  if (!container) return;

  if (!metrics.stageMetrics || Object.keys(metrics.stageMetrics).length === 0) {
    container.innerHTML = '<p>No stage metrics available</p>';
    return;
  }

  let html = '<table class="telemetry-table"><thead><tr>';
  html += '<th>Stage</th><th>Count</th><th>Average</th><th>Min</th><th>Max</th><th>P95</th>';
  html += '</tr></thead><tbody>';

  for (const [stage, stats] of Object.entries(metrics.stageMetrics)) {
    if (!stats) continue;
    
    html += `<tr>
      <td><strong>${stage}</strong></td>
      <td>${stats.count}</td>
      <td>${formatDuration(stats.average)}</td>
      <td>${formatDuration(stats.min)}</td>
      <td>${formatDuration(stats.max)}</td>
      <td>${formatDuration(stats.p95)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * Display trend chart
 */
function displayTrendChart(trend) {
  const container = document.getElementById('telemetryTrendChart');
  if (!container) return;

  if (!trend || trend.length === 0) {
    container.innerHTML = '<p>No trend data available</p>';
    return;
  }

  // Create simple ASCII chart
  const maxDuration = Math.max(...trend.map(t => t.avgDuration));
  const chartHeight = 10;
  const chartWidth = Math.min(trend.length, 50);

  let html = '<div class="telemetry-chart">';
  html += '<div class="chart-title">30-Day Startup Duration Trend</div>';
  html += '<div class="chart-container">';

  // Y-axis labels
  html += '<div class="chart-y-axis">';
  for (let i = chartHeight; i >= 0; i--) {
    const value = Math.round((i / chartHeight) * maxDuration);
    html += `<div class="y-label">${formatDuration(value)}</div>`;
  }
  html += '</div>';

  // Chart area
  html += '<div class="chart-area">';
  
  // Grid lines
  for (let i = 0; i <= chartHeight; i++) {
    html += `<div class="grid-line" style="bottom: ${(i / chartHeight) * 100}%"></div>`;
  }

  // Data points
  const step = Math.max(1, Math.floor(trend.length / chartWidth));
  for (let i = 0; i < trend.length; i += step) {
    const entry = trend[i];
    const height = (entry.avgDuration / maxDuration) * 100;
    const left = (i / trend.length) * 100;
    
    html += `<div class="data-point" style="left: ${left}%; height: ${height}%" title="${entry.date}: ${formatDuration(entry.avgDuration)}"></div>`;
  }

  html += '</div>';
  html += '</div>';
  html += '</div>';

  container.innerHTML = html;
}

/**
 * Display slow startup warning
 */
function displaySlowStartupWarning(warning) {
  const container = document.getElementById('telemetrySlowWarning');
  if (!container) return;

  const html = `
    <div class="warning-box">
      <div class="warning-title">⚠️ Slow Startup Detected</div>
      <div class="warning-content">
        <p><strong>Last startup took ${formatDuration(warning.duration)}</strong></p>
        <p>Threshold: ${formatDuration(warning.threshold)}</p>
        <p>Excess: ${formatDuration(warning.excess)}</p>
        ${warning.model ? `<p>Model: ${warning.model}</p>` : ''}
        ${warning.backend ? `<p>Backend: ${warning.backend}</p>` : ''}
        <p>Time: ${new Date(warning.timestamp).toLocaleString()}</p>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
}

/**
 * Set up event listeners for telemetry updates
 */
function setupTelemetryEventListeners() {
  // Listen for slow startup warnings
  if (window.telemetryAPI && window.telemetryAPI.onSlowStartup) {
    window.telemetryAPI.onSlowStartup((warning) => {
      console.log('[Telemetry UI] Slow startup warning:', warning);
      displaySlowStartupWarning(warning);
      showToast(`Slow startup detected: ${formatDuration(warning.duration)}`, 'warning');
    });
  }
}

/**
 * Refresh telemetry data
 */
async function refreshTelemetryData() {
  try {
    console.log('[Telemetry UI] Refreshing telemetry data...');
    await loadTelemetryMetrics();
    showToast('Telemetry data refreshed', 'success');
  } catch (error) {
    console.error('[Telemetry UI] Error refreshing telemetry data:', error);
    showToast('Failed to refresh telemetry data', 'error');
  }
}

/**
 * Clear telemetry data
 */
async function clearTelemetryData() {
  if (!confirm('Are you sure you want to clear all telemetry data? This cannot be undone.')) {
    return;
  }

  try {
    if (window.telemetryAPI && window.telemetryAPI.reset) {
      await window.telemetryAPI.reset();
      showToast('Telemetry data cleared', 'success');
      await loadTelemetryMetrics();
    }
  } catch (error) {
    console.error('[Telemetry UI] Error clearing telemetry data:', error);
    showToast('Failed to clear telemetry data', 'error');
  }
}

/**
 * Export telemetry data as JSON
 */
async function exportTelemetryData() {
  try {
    if (!window.telemetryAPI || !window.telemetryAPI.getMetrics) {
      showToast('Telemetry API not available', 'error');
      return;
    }

    const metrics = await window.telemetryAPI.getMetrics(30);
    const dataStr = JSON.stringify(metrics, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `telemetry-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
    showToast('Telemetry data exported', 'success');
  } catch (error) {
    console.error('[Telemetry UI] Error exporting telemetry data:', error);
    showToast('Failed to export telemetry data', 'error');
  }
}

// Initialize telemetry UI when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTelemetryUI);
} else {
  initializeTelemetryUI();
}

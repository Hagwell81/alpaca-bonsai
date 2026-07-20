/* eslint-env node */
/**
 * Task 4.3.10: Performance Dashboard
 * 
 * Creates a performance dashboard showing:
 * - Real-time metrics
 * - Trends over time
 * - Component comparisons
 * - Performance monitoring
 * 
 * Usage:
 *   const dashboard = new PerformanceDashboard();
 *   dashboard.generateHTMLDashboard(results, history);
 *   dashboard.generateJSONDashboard(results, history);
 */

const fs = require('fs');
const path = require('path');

class PerformanceDashboard {
  constructor(options = {}) {
    this.options = {
      title: options.title || 'Performance Dashboard',
      refreshInterval: options.refreshInterval || 5000,
      ...options
    };
  }

  /**
   * Generate HTML dashboard
   */
  generateHTMLDashboard(results, history = []) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.options.title}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .header h1 {
            color: #333;
            margin-bottom: 10px;
        }
        
        .header p {
            color: #666;
            font-size: 14px;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .metric-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            border-left: 4px solid #667eea;
        }
        
        .metric-card.pass {
            border-left-color: #10b981;
        }
        
        .metric-card.fail {
            border-left-color: #ef4444;
        }
        
        .metric-card.warning {
            border-left-color: #f59e0b;
        }
        
        .metric-name {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .metric-value {
            font-size: 28px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        
        .metric-status {
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
            font-weight: 600;
        }
        
        .metric-status.pass {
            background: #d1fae5;
            color: #065f46;
        }
        
        .metric-status.fail {
            background: #fee2e2;
            color: #7f1d1d;
        }
        
        .metric-status.warning {
            background: #fef3c7;
            color: #92400e;
        }
        
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .chart-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .chart-title {
            font-size: 16px;
            font-weight: 600;
            color: #333;
            margin-bottom: 20px;
        }
        
        .chart-wrapper {
            position: relative;
            height: 300px;
        }
        
        .comparison-table {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow-x: auto;
        }
        
        .comparison-table h3 {
            margin-bottom: 20px;
            color: #333;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th {
            background: #f3f4f6;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #333;
            border-bottom: 2px solid #e5e7eb;
        }
        
        td {
            padding: 12px;
            border-bottom: 1px solid #e5e7eb;
            color: #666;
        }
        
        tr:hover {
            background: #f9fafb;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .status-badge.pass {
            background: #d1fae5;
            color: #065f46;
        }
        
        .status-badge.fail {
            background: #fee2e2;
            color: #7f1d1d;
        }
        
        .footer {
            background: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            color: #666;
            font-size: 12px;
        }
        
        .trend-up {
            color: #10b981;
        }
        
        .trend-down {
            color: #ef4444;
        }
        
        @media (max-width: 768px) {
            .metrics-grid {
                grid-template-columns: 1fr;
            }
            
            .charts-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${this.options.title}</h1>
            <p>Last updated: <span id="lastUpdated">${new Date().toLocaleString()}</span></p>
        </div>
        
        <div class="metrics-grid" id="metricsGrid">
            ${this.generateMetricsHTML(results)}
        </div>
        
        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">Performance Improvements</div>
                <div class="chart-wrapper">
                    <canvas id="improvementsChart"></canvas>
                </div>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">Target Compliance</div>
                <div class="chart-wrapper">
                    <canvas id="complianceChart"></canvas>
                </div>
            </div>
        </div>
        
        ${history.length > 0 ? `
        <div class="chart-container">
            <div class="chart-title">Performance Trends (Last 30 Days)</div>
            <div class="chart-wrapper" style="height: 400px;">
                <canvas id="trendsChart"></canvas>
            </div>
        </div>
        ` : ''}
        
        <div class="comparison-table">
            <h3>Detailed Metrics</h3>
            <table>
                <thead>
                    <tr>
                        <th>Component</th>
                        <th>Target</th>
                        <th>Achieved</th>
                        <th>Status</th>
                        <th>Margin</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.generateTableRowsHTML(results)}
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>Performance Dashboard • Auto-refresh every ${this.options.refreshInterval}ms</p>
        </div>
    </div>
    
    <script>
        ${this.generateChartScripts(results, history)}
    </script>
</body>
</html>`;

    return html;
  }

  /**
   * Generate metrics HTML
   */
  generateMetricsHTML(results) {
    let html = '';

    const metrics = [
      {
        name: 'Model Load Time',
        value: results.modelLoad?.improvement || 'N/A',
        status: results.modelLoad?.met ? 'pass' : 'fail',
        target: results.modelLoad?.target
      },
      {
        name: 'Connection Pool',
        value: results.connectionPool?.reduction || 'N/A',
        status: results.connectionPool?.met ? 'pass' : 'fail',
        target: results.connectionPool?.target
      },
      {
        name: 'Request Batching',
        value: results.requestBatching?.apiCallReduction || 'N/A',
        status: results.requestBatching?.met ? 'pass' : 'fail',
        target: results.requestBatching?.target
      },
      {
        name: 'Startup Telemetry',
        value: results.startupTelemetry?.telemetryOverhead || 'N/A',
        status: results.startupTelemetry?.met ? 'pass' : 'fail',
        target: results.startupTelemetry?.target
      },
      {
        name: 'Binary Cache',
        value: results.binaryCache?.hitRate || 'N/A',
        status: results.binaryCache?.met ? 'pass' : 'fail',
        target: results.binaryCache?.target
      },
      {
        name: 'Encryption',
        value: results.encryption?.avgEncryptionTime || 'N/A',
        status: results.encryption?.met ? 'pass' : 'fail',
        target: results.encryption?.target
      }
    ];

    for (const metric of metrics) {
      html += `
        <div class="metric-card ${metric.status}">
            <div class="metric-name">${metric.name}</div>
            <div class="metric-value">${metric.value}</div>
            <span class="metric-status ${metric.status}">
                ${metric.status === 'pass' ? '✓ PASS' : '✗ FAIL'}
            </span>
        </div>
      `;
    }

    return html;
  }

  /**
   * Generate table rows HTML
   */
  generateTableRowsHTML(results) {
    let html = '';

    const rows = [
      {
        component: 'Model Load Time',
        target: '40%',
        achieved: results.modelLoad?.improvement || 'N/A',
        status: results.modelLoad?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.modelLoad)
      },
      {
        component: 'Connection Pool',
        target: '50%',
        achieved: results.connectionPool?.reduction || 'N/A',
        status: results.connectionPool?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.connectionPool)
      },
      {
        component: 'Request Batching',
        target: '10x',
        achieved: results.requestBatching?.apiCallReduction || 'N/A',
        status: results.requestBatching?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.requestBatching)
      },
      {
        component: 'Startup Telemetry',
        target: '< 50ms',
        achieved: results.startupTelemetry?.telemetryOverhead || 'N/A',
        status: results.startupTelemetry?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.startupTelemetry)
      },
      {
        component: 'Binary Cache',
        target: '> 80%',
        achieved: results.binaryCache?.hitRate || 'N/A',
        status: results.binaryCache?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.binaryCache)
      },
      {
        component: 'Encryption',
        target: '< 5ms',
        achieved: results.encryption?.avgEncryptionTime || 'N/A',
        status: results.encryption?.met ? 'pass' : 'fail',
        margin: this.calculateMargin(results.encryption)
      }
    ];

    for (const row of rows) {
      html += `
        <tr>
            <td>${row.component}</td>
            <td>${row.target}</td>
            <td>${row.achieved}</td>
            <td><span class="status-badge ${row.status}">${row.status === 'pass' ? 'PASS' : 'FAIL'}</span></td>
            <td>${row.margin}</td>
        </tr>
      `;
    }

    return html;
  }

  /**
   * Generate chart scripts
   */
  generateChartScripts(results, history) {
    return `
        // Improvements Chart
        const improvementsCtx = document.getElementById('improvementsChart').getContext('2d');
        new Chart(improvementsCtx, {
            type: 'bar',
            data: {
                labels: ['Model Load', 'Connection Pool', 'Binary Cache'],
                datasets: [{
                    label: 'Performance Improvement (%)',
                    data: [
                        ${this.parsePercentage(results.modelLoad?.improvement) || 0},
                        ${this.parsePercentage(results.connectionPool?.reduction) || 0},
                        ${this.parsePercentage(results.binaryCache?.hitRate) || 0}
                    ],
                    backgroundColor: ['#667eea', '#764ba2', '#f093fb'],
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });
        
        // Compliance Chart
        const complianceCtx = document.getElementById('complianceChart').getContext('2d');
        const passCount = ${Object.values(results).filter(r => r?.met).length};
        const totalCount = 6;
        new Chart(complianceCtx, {
            type: 'doughnut',
            data: {
                labels: ['Compliant', 'Non-Compliant'],
                datasets: [{
                    data: [passCount, totalCount - passCount],
                    backgroundColor: ['#10b981', '#ef4444'],
                    borderColor: ['#059669', '#dc2626'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
        
        ${history.length > 0 ? this.generateTrendsChartScript(history) : ''}
    `;
  }

  /**
   * Generate trends chart script
   */
  generateTrendsChartScript(history) {
    const labels = history.map(h => new Date(h.timestamp).toLocaleDateString()).slice(-30);
    const modelLoadData = history.map(h => this.parsePercentage(h.results.modelLoad?.improvement)).slice(-30);
    const poolData = history.map(h => this.parsePercentage(h.results.connectionPool?.reduction)).slice(-30);
    const cacheData = history.map(h => this.parsePercentage(h.results.binaryCache?.hitRate)).slice(-30);

    return `
        const trendsCtx = document.getElementById('trendsChart').getContext('2d');
        new Chart(trendsCtx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'Model Load Improvement',
                        data: ${JSON.stringify(modelLoadData)},
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: 'Connection Pool Reduction',
                        data: ${JSON.stringify(poolData)},
                        borderColor: '#764ba2',
                        backgroundColor: 'rgba(118, 75, 162, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: 'Cache Hit Rate',
                        data: ${JSON.stringify(cacheData)},
                        borderColor: '#f093fb',
                        backgroundColor: 'rgba(240, 147, 251, 0.1)',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' }
                },
                scales: {
                    y: { beginAtZero: true, max: 100 }
                }
            }
        });
    `;
  }

  /**
   * Generate JSON dashboard data
   */
  generateJSONDashboard(results, history = []) {
    return {
      timestamp: new Date().toISOString(),
      metrics: {
        modelLoad: {
          name: 'Model Load Time',
          value: results.modelLoad?.improvement,
          target: '40%',
          status: results.modelLoad?.met ? 'PASS' : 'FAIL'
        },
        connectionPool: {
          name: 'Connection Pool',
          value: results.connectionPool?.reduction,
          target: '50%',
          status: results.connectionPool?.met ? 'PASS' : 'FAIL'
        },
        requestBatching: {
          name: 'Request Batching',
          value: results.requestBatching?.apiCallReduction,
          target: '10x',
          status: results.requestBatching?.met ? 'PASS' : 'FAIL'
        },
        startupTelemetry: {
          name: 'Startup Telemetry',
          value: results.startupTelemetry?.telemetryOverhead,
          target: '< 50ms',
          status: results.startupTelemetry?.met ? 'PASS' : 'FAIL'
        },
        binaryCache: {
          name: 'Binary Cache',
          value: results.binaryCache?.hitRate,
          target: '> 80%',
          status: results.binaryCache?.met ? 'PASS' : 'FAIL'
        },
        encryption: {
          name: 'Encryption',
          value: results.encryption?.avgEncryptionTime,
          target: '< 5ms',
          status: results.encryption?.met ? 'PASS' : 'FAIL'
        }
      },
      summary: {
        totalMetrics: 6,
        passingMetrics: Object.values(results).filter(r => r?.met).length,
        complianceRate: `${((Object.values(results).filter(r => r?.met).length / 6) * 100).toFixed(1)}%`
      },
      history: history.slice(-30)
    };
  }

  /**
   * Save dashboard to file
   */
  saveDashboard(html, filePath) {
    fs.writeFileSync(filePath, html);
    return filePath;
  }

  /**
   * Helper: Parse percentage
   */
  parsePercentage(str) {
    if (!str) return 0;
    const match = str.toString().match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  }

  /**
   * Helper: Calculate margin
   */
  calculateMargin(metric) {
    if (!metric) return 'N/A';
    if (metric.met) return '✓ Above target';
    return '✗ Below target';
  }
}

module.exports = { PerformanceDashboard };

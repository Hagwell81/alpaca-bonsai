/* eslint-env node */
/**
 * Task 4.3.7: Benchmark Report Generator
 * 
 * Generates comprehensive performance benchmark reports with:
 * - Before/after metrics comparison
 * - Visualization data
 * - Methodology documentation
 * - Executive summary
 * 
 * Usage:
 *   const reporter = new BenchmarkReportGenerator();
 *   const report = reporter.generateReport(benchmarkResults);
 *   reporter.saveReport(report, 'benchmark-report.json');
 *   reporter.generateMarkdownReport(report, 'benchmark-report.md');
 */

const fs = require('fs');
const path = require('path');

class BenchmarkReportGenerator {
  constructor(options = {}) {
    this.options = {
      includeCharts: options.includeCharts !== false,
      includeMethodology: options.includeMethodology !== false,
      includeExecutiveSummary: options.includeExecutiveSummary !== false,
      ...options
    };
  }

  /**
   * Generate comprehensive benchmark report
   */
  generateReport(benchmarkResults) {
    const timestamp = new Date().toISOString();
    
    return {
      metadata: {
        timestamp,
        version: '1.0.0',
        title: 'Pre-Dev Enhancements Performance Benchmarks',
        description: 'Comprehensive performance metrics for optimization components'
      },
      executiveSummary: this.generateExecutiveSummary(benchmarkResults),
      benchmarks: this.formatBenchmarks(benchmarkResults),
      comparisons: this.generateComparisons(benchmarkResults),
      visualizations: this.generateVisualizationData(benchmarkResults),
      methodology: this.generateMethodology(),
      recommendations: this.generateRecommendations(benchmarkResults)
    };
  }

  /**
   * Generate executive summary
   */
  generateExecutiveSummary(results) {
    const targetsMetCount = Object.values(results).filter(r => r.met).length;
    const totalTargets = Object.keys(results).length;
    const successRate = ((targetsMetCount / totalTargets) * 100).toFixed(1);

    return {
      overallStatus: targetsMetCount === totalTargets ? 'PASSED' : 'PARTIAL',
      successRate: `${successRate}%`,
      targetsMetCount,
      totalTargets,
      keyFindings: this.extractKeyFindings(results),
      performanceGains: this.calculatePerformanceGains(results)
    };
  }

  /**
   * Extract key findings from results
   */
  extractKeyFindings(results) {
    const findings = [];

    if (results.modelLoad && results.modelLoad.met) {
      findings.push({
        component: 'Model Loading',
        finding: `Warm-cache optimization achieved ${results.modelLoad.improvement} improvement`,
        impact: 'High - Reduces model load latency significantly'
      });
    }

    if (results.connectionPool && results.connectionPool.met) {
      findings.push({
        component: 'Connection Pooling',
        finding: `Latency reduction of ${results.connectionPool.reduction}`,
        impact: 'High - Improves API request performance'
      });
    }

    if (results.requestBatching && results.requestBatching.met) {
      findings.push({
        component: 'Request Batching',
        finding: `API call reduction of ${results.requestBatching.apiCallReduction}`,
        impact: 'Critical - Dramatically reduces API overhead'
      });
    }

    if (results.startupTelemetry && results.startupTelemetry.met) {
      findings.push({
        component: 'Startup Telemetry',
        finding: `Telemetry overhead of only ${results.startupTelemetry.telemetryOverhead}ms`,
        impact: 'Medium - Minimal performance impact'
      });
    }

    if (results.binaryCache && results.binaryCache.met) {
      findings.push({
        component: 'Binary Cache',
        finding: `Cache hit rate of ${results.binaryCache.hitRate}`,
        impact: 'High - Reduces re-download overhead'
      });
    }

    if (results.encryption && results.encryption.met) {
      findings.push({
        component: 'Encryption',
        finding: `Encryption/decryption overhead of ${results.encryption.avgEncryptionTime}/${results.encryption.avgDecryptionTime}`,
        impact: 'Medium - Acceptable security overhead'
      });
    }

    return findings;
  }

  /**
   * Calculate performance gains
   */
  calculatePerformanceGains(results) {
    const gains = {};

    if (results.modelLoad) {
      gains.modelLoadImprovement = results.modelLoad.improvement;
    }

    if (results.connectionPool) {
      gains.latencyReduction = results.connectionPool.reduction;
    }

    if (results.requestBatching) {
      gains.apiCallReduction = results.requestBatching.apiCallReduction;
    }

    return gains;
  }

  /**
   * Format benchmark results
   */
  formatBenchmarks(results) {
    return {
      modelLoad: {
        name: 'Model Load Time (Warm-Cache vs Cold)',
        metrics: {
          coldLoadTime: results.modelLoad?.coldLoadTime,
          warmLoadTime: results.modelLoad?.warmLoadTime,
          improvement: results.modelLoad?.improvement,
          target: results.modelLoad?.target,
          status: results.modelLoad?.met ? 'PASSED' : 'FAILED'
        }
      },
      connectionPool: {
        name: 'Connection Pool Latency Reduction',
        metrics: {
          withoutPool: results.connectionPool?.withoutPoolAvg,
          withPool: results.connectionPool?.withPoolAvg,
          reduction: results.connectionPool?.reduction,
          target: results.connectionPool?.target,
          status: results.connectionPool?.met ? 'PASSED' : 'FAILED'
        }
      },
      requestBatching: {
        name: 'Request Batching Throughput',
        metrics: {
          individualTime: results.requestBatching?.individualTime,
          batchedTime: results.requestBatching?.batchedTime,
          apiCallReduction: results.requestBatching?.apiCallReduction,
          target: results.requestBatching?.target,
          status: results.requestBatching?.met ? 'PASSED' : 'FAILED'
        }
      },
      startupTelemetry: {
        name: 'Startup Time with Telemetry',
        metrics: {
          totalStartupTime: results.startupTelemetry?.totalStartupTime,
          telemetryOverhead: results.startupTelemetry?.telemetryOverhead,
          overheadPercentage: results.startupTelemetry?.overheadPercentage,
          target: results.startupTelemetry?.target,
          status: results.startupTelemetry?.met ? 'PASSED' : 'FAILED'
        }
      },
      binaryCache: {
        name: 'Binary Cache Hit Rates',
        metrics: {
          cacheHits: results.binaryCache?.cacheHits,
          cacheMisses: results.binaryCache?.cacheMisses,
          hitRate: results.binaryCache?.hitRate,
          target: results.binaryCache?.target,
          status: results.binaryCache?.met ? 'PASSED' : 'FAILED'
        }
      },
      encryption: {
        name: 'Encryption/Decryption Overhead',
        metrics: {
          avgEncryption: results.encryption?.avgEncryptionTime,
          avgDecryption: results.encryption?.avgDecryptionTime,
          target: results.encryption?.target,
          status: results.encryption?.met ? 'PASSED' : 'FAILED'
        }
      }
    };
  }

  /**
   * Generate before/after comparisons
   */
  generateComparisons(results) {
    return {
      modelLoading: {
        before: 'No warm-cache optimization',
        after: `Warm-cache reduces load time by ${results.modelLoad?.improvement}`,
        improvement: results.modelLoad?.improvement
      },
      connectionPooling: {
        before: 'No connection pooling (new TCP connection per request)',
        after: `Connection pooling reduces latency by ${results.connectionPool?.reduction}`,
        improvement: results.connectionPool?.reduction
      },
      requestBatching: {
        before: 'Individual API calls for each embedding request',
        after: `Batching reduces API calls by ${results.requestBatching?.apiCallReduction}`,
        improvement: results.requestBatching?.apiCallReduction
      },
      startupTelemetry: {
        before: 'No startup performance tracking',
        after: `Telemetry adds only ${results.startupTelemetry?.telemetryOverhead}ms overhead`,
        improvement: results.startupTelemetry?.overheadPercentage
      },
      binaryCache: {
        before: 'No binary caching (re-download on each install)',
        after: `Cache achieves ${results.binaryCache?.hitRate} hit rate`,
        improvement: results.binaryCache?.hitRate
      },
      encryption: {
        before: 'No encryption overhead (unencrypted secrets)',
        after: `Encryption adds ${results.encryption?.avgEncryptionTime} per operation`,
        improvement: 'Security gain'
      }
    };
  }

  /**
   * Generate visualization data for charts
   */
  generateVisualizationData(results) {
    return {
      performanceComparison: {
        type: 'bar',
        title: 'Performance Improvements by Component',
        data: [
          {
            component: 'Model Loading',
            improvement: this.parsePercentage(results.modelLoad?.improvement)
          },
          {
            component: 'Connection Pooling',
            improvement: this.parsePercentage(results.connectionPool?.reduction)
          },
          {
            component: 'Startup Telemetry',
            improvement: this.parsePercentage(results.startupTelemetry?.overheadPercentage)
          },
          {
            component: 'Binary Cache',
            improvement: this.parsePercentage(results.binaryCache?.hitRate)
          }
        ]
      },
      targetComplianceMatrix: {
        type: 'table',
        title: 'Target Compliance Status',
        data: [
          {
            benchmark: 'Model Load Time',
            target: results.modelLoad?.target,
            achieved: results.modelLoad?.improvement,
            status: results.modelLoad?.met ? '✓ PASS' : '✗ FAIL'
          },
          {
            benchmark: 'Connection Pool Latency',
            target: results.connectionPool?.target,
            achieved: results.connectionPool?.reduction,
            status: results.connectionPool?.met ? '✓ PASS' : '✗ FAIL'
          },
          {
            benchmark: 'Request Batching',
            target: results.requestBatching?.target,
            achieved: results.requestBatching?.apiCallReduction,
            status: results.requestBatching?.met ? '✓ PASS' : '✗ FAIL'
          },
          {
            benchmark: 'Startup Telemetry',
            target: results.startupTelemetry?.target,
            achieved: results.startupTelemetry?.telemetryOverhead,
            status: results.startupTelemetry?.met ? '✓ PASS' : '✗ FAIL'
          },
          {
            benchmark: 'Binary Cache',
            target: results.binaryCache?.target,
            achieved: results.binaryCache?.hitRate,
            status: results.binaryCache?.met ? '✓ PASS' : '✗ FAIL'
          },
          {
            benchmark: 'Encryption Overhead',
            target: results.encryption?.target,
            achieved: results.encryption?.avgEncryptionTime,
            status: results.encryption?.met ? '✓ PASS' : '✗ FAIL'
          }
        ]
      }
    };
  }

  /**
   * Generate methodology documentation
   */
  generateMethodology() {
    return {
      overview: 'Performance benchmarks measure optimization improvements across six key components',
      testEnvironment: {
        description: 'Benchmarks run in isolated test environment',
        isolation: 'Each benchmark runs independently with clean state',
        repeatability: 'Results are deterministic and reproducible'
      },
      benchmarkMethodologies: {
        modelLoad: {
          description: 'Measures cold vs warm cache load times',
          coldLoadTest: 'First load without cache',
          warmLoadTest: 'Subsequent load with warm cache',
          metric: 'Percentage improvement'
        },
        connectionPool: {
          description: 'Measures latency reduction from connection pooling',
          withoutPool: 'Simulated latency without pooling',
          withPool: 'Simulated latency with pooling',
          metric: 'Percentage reduction'
        },
        requestBatching: {
          description: 'Measures throughput improvement from request batching',
          individual: 'Individual API calls',
          batched: 'Coalesced batch calls',
          metric: 'API call reduction factor'
        },
        startupTelemetry: {
          description: 'Measures telemetry recording overhead',
          stages: 'Records multiple startup stages',
          overhead: 'Measures time spent in telemetry',
          metric: 'Milliseconds and percentage'
        },
        binaryCache: {
          description: 'Measures cache hit rate for binary downloads',
          cacheSize: '3 cached versions',
          lookups: '100 cache lookups',
          metric: 'Hit rate percentage'
        },
        encryption: {
          description: 'Measures encryption/decryption performance',
          operations: '20 encrypt + 20 decrypt operations',
          dataSize: 'Variable size secrets',
          metric: 'Milliseconds per operation'
        }
      },
      dataCollection: {
        frequency: 'Benchmarks run on each test execution',
        retention: 'Results stored for trend analysis',
        aggregation: 'Results aggregated for reporting'
      },
      limitations: [
        'Benchmarks use simulated/mocked components',
        'Real-world performance may vary based on system load',
        'Network latency not included in connection pool benchmarks',
        'Encryption benchmarks use in-memory operations'
      ]
    };
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(results) {
    const recommendations = [];

    if (!results.modelLoad?.met) {
      recommendations.push({
        priority: 'HIGH',
        component: 'Model Loading',
        issue: 'Warm-cache improvement below target',
        recommendation: 'Investigate mmap reference management and cache TTL settings'
      });
    }

    if (!results.connectionPool?.met) {
      recommendations.push({
        priority: 'HIGH',
        component: 'Connection Pooling',
        issue: 'Latency reduction below target',
        recommendation: 'Verify HTTP Agent configuration and connection reuse'
      });
    }

    if (!results.requestBatching?.met) {
      recommendations.push({
        priority: 'CRITICAL',
        component: 'Request Batching',
        issue: 'API call reduction below target',
        recommendation: 'Review batch window timing and batch size limits'
      });
    }

    if (!results.startupTelemetry?.met) {
      recommendations.push({
        priority: 'MEDIUM',
        component: 'Startup Telemetry',
        issue: 'Telemetry overhead above target',
        recommendation: 'Optimize database writes and async operations'
      });
    }

    if (!results.binaryCache?.met) {
      recommendations.push({
        priority: 'MEDIUM',
        component: 'Binary Cache',
        issue: 'Cache hit rate below target',
        recommendation: 'Review cache eviction policy and directory structure'
      });
    }

    if (!results.encryption?.met) {
      recommendations.push({
        priority: 'LOW',
        component: 'Encryption',
        issue: 'Encryption overhead above target',
        recommendation: 'Consider hardware acceleration or algorithm optimization'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'INFO',
        component: 'Overall',
        issue: 'All targets met',
        recommendation: 'Continue monitoring performance in production'
      });
    }

    return recommendations;
  }

  /**
   * Save report to JSON file
   */
  saveReport(report, filePath) {
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return filePath;
  }

  /**
   * Generate Markdown report
   */
  generateMarkdownReport(report, filePath) {
    let markdown = '';

    // Header
    markdown += `# ${report.metadata.title}\n\n`;
    markdown += `**Generated:** ${new Date(report.metadata.timestamp).toLocaleString()}\n\n`;

    // Executive Summary
    markdown += '## Executive Summary\n\n';
    markdown += `**Overall Status:** ${report.executiveSummary.overallStatus}\n`;
    markdown += `**Success Rate:** ${report.executiveSummary.successRate}\n`;
    markdown += `**Targets Met:** ${report.executiveSummary.targetsMetCount}/${report.executiveSummary.totalTargets}\n\n`;

    // Key Findings
    markdown += '### Key Findings\n\n';
    for (const finding of report.executiveSummary.keyFindings) {
      markdown += `- **${finding.component}:** ${finding.finding}\n`;
      markdown += `  - Impact: ${finding.impact}\n`;
    }
    markdown += '\n';

    // Benchmarks
    markdown += '## Benchmark Results\n\n';
    for (const [key, benchmark] of Object.entries(report.benchmarks)) {
      markdown += `### ${benchmark.name}\n\n`;
      markdown += `**Status:** ${benchmark.metrics.status}\n\n`;
      markdown += '| Metric | Value |\n';
      markdown += '|--------|-------|\n';
      for (const [metricKey, metricValue] of Object.entries(benchmark.metrics)) {
        if (metricKey !== 'status') {
          markdown += `| ${this.formatMetricName(metricKey)} | ${metricValue} |\n`;
        }
      }
      markdown += '\n';
    }

    // Comparisons
    markdown += '## Before/After Comparisons\n\n';
    for (const [key, comparison] of Object.entries(report.comparisons)) {
      markdown += `### ${this.formatComponentName(key)}\n\n`;
      markdown += `**Before:** ${comparison.before}\n\n`;
      markdown += `**After:** ${comparison.after}\n\n`;
      markdown += `**Improvement:** ${comparison.improvement}\n\n`;
    }

    // Methodology
    markdown += '## Methodology\n\n';
    markdown += `${report.methodology.overview}\n\n`;
    markdown += '### Test Environment\n\n';
    markdown += `- **Isolation:** ${report.methodology.testEnvironment.isolation}\n`;
    markdown += `- **Repeatability:** ${report.methodology.testEnvironment.repeatability}\n\n`;

    markdown += '### Limitations\n\n';
    for (const limitation of report.methodology.limitations) {
      markdown += `- ${limitation}\n`;
    }
    markdown += '\n';

    // Recommendations
    markdown += '## Recommendations\n\n';
    for (const rec of report.recommendations) {
      markdown += `### [${rec.priority}] ${rec.component}\n\n`;
      markdown += `**Issue:** ${rec.issue}\n\n`;
      markdown += `**Recommendation:** ${rec.recommendation}\n\n`;
    }

    fs.writeFileSync(filePath, markdown);
    return filePath;
  }

  /**
   * Helper: Parse percentage string
   */
  parsePercentage(str) {
    if (!str) return 0;
    const match = str.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : 0;
  }

  /**
   * Helper: Format metric name
   */
  formatMetricName(name) {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Helper: Format component name
   */
  formatComponentName(name) {
    return name
      .split(/(?=[A-Z])/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

module.exports = { BenchmarkReportGenerator };

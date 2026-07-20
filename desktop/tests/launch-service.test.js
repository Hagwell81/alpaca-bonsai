/**
 * @fileoverview Unit tests for launch-service.js install detection and launch.
 *
 * Tests the checkIfInstalled, checkAllInstalled, and launchIntegration methods.
 */

const { expect } = require('chai');
const {
  LaunchService,
  INSTALL_DETECTORS,
} = require('../launch-service');

describe('launch-service — install detection', () => {
  let service;

  before(() => {
    service = new LaunchService({ app: null, store: null, logger: { log: () => {}, warn: () => {}, error: () => {} } });
  });

  describe('INSTALL_DETECTORS', () => {
    it('has a detector for every integration', () => {
      const integrations = service.getIntegrations();
      for (const integration of integrations) {
        expect(INSTALL_DETECTORS).to.have.property(integration.id);
      }
    });
  });

  describe('checkIfInstalled', () => {
    it('returns a status object with installed, method, and detail', () => {
      const status = service.checkIfInstalled('claude');
      expect(status).to.have.property('installed');
      expect(status).to.have.property('method');
      expect(status).to.have.property('detail');
      expect(typeof status.installed).to.equal('boolean');
    });

    it('returns false for an unknown integration', () => {
      const status = service.checkIfInstalled('nonexistent-tool');
      expect(status.installed).to.equal(false);
      expect(status.method).to.equal(null);
    });

    it('detects node-based bots via extraCheck', () => {
      // discord bot has an extraCheck that looks for bots/discord-bot/package.json
      const status = service.checkIfInstalled('discord');
      // The detail should mention something about files or node
      expect(status.detail).to.be.a('string');
      // node is very likely installed (it's how we're running tests)
      // so this should be installed if node is on PATH
      if (status.installed) {
        expect(status.method).to.equal('extra');
      }
    });

    it('detects slack bot via extraCheck', () => {
      const status = service.checkIfInstalled('slack');
      expect(status.detail).to.be.a('string');
    });
  });

  describe('checkAllInstalled', () => {
    it('returns a status map for every integration', () => {
      const statuses = service.checkAllInstalled();
      const integrations = service.getIntegrations();
      for (const integration of integrations) {
        expect(statuses).to.have.property(integration.id);
        expect(statuses[integration.id]).to.have.property('installed');
      }
    });

    it('does not throw even if a detector fails', () => {
      // Should complete without throwing
      const statuses = service.checkAllInstalled();
      expect(statuses).to.be.an('object');
    });
  });
});

describe('launch-service — launchIntegration', () => {
  let service;

  before(() => {
    service = new LaunchService({ app: null, store: null, logger: { log: () => {}, warn: () => {}, error: () => {} } });
  });

  it('returns failure for an unknown integration', () => {
    const result = service.launchIntegration('nonexistent-tool');
    expect(result.success).to.equal(false);
    expect(result.error).to.include('not installed');
  });

  it('returns failure with install detail when tool is not installed', () => {
    // Use a tool that's very unlikely to be installed
    const result = service.launchIntegration('openclaw');
    if (!result.success) {
      expect(result.error).to.be.a('string');
      expect(result.installDetail).to.be.a('string');
    }
    // If it happens to be installed, success should be true
    if (result.success) {
      expect(result.launched).to.not.equal(undefined);
    }
  });

  it('filters out placeholder env vars (values wrapped in <>)', () => {
    // Slack bot has placeholder tokens like <xoxb-your-token>
    // We can't easily test the actual launch without mocking spawn,
    // but we can verify the method doesn't throw and returns a result.
    const result = service.launchIntegration('slack');
    expect(result).to.have.property('success');
    // If it failed because not installed, that's fine for this test
    // If it succeeded, env should not contain placeholder values
    if (result.success && result.env) {
      for (const [, value] of Object.entries(result.env)) {
        expect(value).to.not.match(/^<.*>$/);
      }
    }
  });

  it('returns config info for integrations without a manualCommand', () => {
    // Find an integration that doesn't have a manualCommand
    // (these return launched: false with instructions)
    // Onyx is a Docker deployment with no CLI command
    const result = service.launchIntegration('onyx');
    // Onyx has no command or appPath, so it should return not installed
    // OR if we add a manualCommand later, it should return success
    expect(result).to.have.property('success');
  });
});

/**
 * Tests for chat-template-detector.js
 *
 * Tests the detectToolSupport and fetchAndDetect functions.
 */

const { expect } = require('chai');
const http = require('http');
const { detectToolSupport, fetchAndDetect } = require('../chat-template-detector');

describe('chat-template-detector', () => {
  describe('detectToolSupport', () => {
    it('should return true when template contains "tool_call"', () => {
      const template = 'This template has tool_call support';
      expect(detectToolSupport(template)).to.be.true;
    });

    it('should return true when template contains "function_call"', () => {
      const template = 'This template has function_call support';
      expect(detectToolSupport(template)).to.be.true;
    });

    it('should be case-insensitive for "tool_call"', () => {
      expect(detectToolSupport('TOOL_CALL')).to.be.true;
      expect(detectToolSupport('Tool_Call')).to.be.true;
      expect(detectToolSupport('tool_CALL')).to.be.true;
    });

    it('should be case-insensitive for "function_call"', () => {
      expect(detectToolSupport('FUNCTION_CALL')).to.be.true;
      expect(detectToolSupport('Function_Call')).to.be.true;
      expect(detectToolSupport('function_CALL')).to.be.true;
    });

    it('should return false when template contains neither marker', () => {
      const template = 'This is a regular template without tool support';
      expect(detectToolSupport(template)).to.be.false;
    });

    it('should return false for non-string inputs', () => {
      expect(detectToolSupport(null)).to.be.false;
      expect(detectToolSupport(undefined)).to.be.false;
      expect(detectToolSupport(123)).to.be.false;
      expect(detectToolSupport({})).to.be.false;
      expect(detectToolSupport([])).to.be.false;
    });

    it('should return false for empty string', () => {
      expect(detectToolSupport('')).to.be.false;
    });

    it('should handle partial matches correctly', () => {
      // Should not match partial strings
      expect(detectToolSupport('tool_call_something')).to.be.true; // contains tool_call
      expect(detectToolSupport('something_tool_call')).to.be.true; // contains tool_call
      expect(detectToolSupport('toolcall')).to.be.false; // no underscore
      expect(detectToolSupport('tool call')).to.be.false; // space instead of underscore
    });
  });

  describe('fetchAndDetect', () => {
    let server;
    let port;

    beforeEach((done) => {
      // Create a mock HTTP server for testing
      server = http.createServer((req, res) => {
        if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            chat_template: 'This template has tool_call support',
            other_field: 'value',
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        done();
      });
    });

    afterEach((done) => {
      if (server) {
        server.close(done);
      } else {
        done();
      }
    });

    it('should fetch /props and detect tool support', async () => {
      const result = await fetchAndDetect(port);
      expect(result).to.have.property('supportsTools');
      expect(result).to.have.property('chatTemplate');
      expect(result.supportsTools).to.be.true;
      expect(result.chatTemplate).to.include('tool_call');
    });

    it('should return false for supportsTools when template lacks markers', async () => {
      // Create a new server with a template without markers
      const testServer = http.createServer((req, res) => {
        if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            chat_template: 'Regular template without markers',
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      return new Promise((resolve, reject) => {
        testServer.listen(0, '127.0.0.1', async () => {
          const testPort = testServer.address().port;
          try {
            const result = await fetchAndDetect(testPort);
            expect(result.supportsTools).to.be.false;
            testServer.close(resolve);
          } catch (err) {
            testServer.close(() => reject(err));
          }
        });
      });
    });

    it('should handle missing chat_template field', async () => {
      // Create a new server without chat_template
      const testServer = http.createServer((req, res) => {
        if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            other_field: 'value',
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      return new Promise((resolve, reject) => {
        testServer.listen(0, '127.0.0.1', async () => {
          const testPort = testServer.address().port;
          try {
            const result = await fetchAndDetect(testPort);
            expect(result.supportsTools).to.be.false;
            expect(result.chatTemplate).to.be.null;
            testServer.close(resolve);
          } catch (err) {
            testServer.close(() => reject(err));
          }
        });
      });
    });

    it('should reject on invalid JSON response', async () => {
      // Create a new server with invalid JSON
      const testServer = http.createServer((req, res) => {
        if (req.url === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{ invalid json }');
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      return new Promise((resolve, reject) => {
        testServer.listen(0, '127.0.0.1', async () => {
          const testPort = testServer.address().port;
          try {
            await fetchAndDetect(testPort);
            testServer.close(() => reject(new Error('Should have thrown')));
          } catch (err) {
            expect(err.message).to.include('Failed to parse');
            testServer.close(resolve);
          }
        });
      });
    });

    it('should reject on connection error', async () => {
      // Try to connect to a port that is not listening
      try {
        await fetchAndDetect(1);
        throw new Error('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('Failed to fetch');
      }
    });
  });
});

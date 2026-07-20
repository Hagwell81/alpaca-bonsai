/* eslint-env node */
const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const http = require('http');
const { pollHealthUntilReady } = require('../health-probe');

describe('health-probe', () => {
  let server = null;
  let port = 0;

  afterEach(async function () {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  function createServer(handler) {
    return new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  }

  it('should return true when /health returns 200 immediately', async () => {
    await createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const result = await pollHealthUntilReady(port, { intervalMs: 100, timeoutMs: 2000 });
    expect(result).to.be.true;
  });

  it('should return true after runner transitions from 503 to 200', async () => {
    let requestCount = 0;
    await createServer((req, res) => {
      requestCount++;
      if (req.url === '/health') {
        if (requestCount < 3) {
          res.writeHead(503);
          res.end('Loading');
        } else {
          res.writeHead(200);
          res.end('OK');
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const result = await pollHealthUntilReady(port, { intervalMs: 100, timeoutMs: 2000 });
    expect(result).to.be.true;
    expect(requestCount).to.be.at.least(3);
  });

  it('should return false on timeout', async () => {
    await createServer((req, res) => {
      res.writeHead(503);
      res.end('Loading');
    });

    const start = Date.now();
    const result = await pollHealthUntilReady(port, { intervalMs: 100, timeoutMs: 400 });
    const elapsed = Date.now() - start;

    expect(result).to.be.false;
    expect(elapsed).to.be.at.least(350);
    expect(elapsed).to.be.below(700);
  });

  it('should call onProgress with elapsed time', async () => {
    let progressCalls = [];
    await createServer((req, res) => {
      res.writeHead(200);
      res.end('OK');
    });

    await pollHealthUntilReady(port, {
      intervalMs: 50,
      timeoutMs: 2000,
      onProgress: (elapsed) => {
        progressCalls.push(elapsed);
      },
    });

    expect(progressCalls.length).to.be.at.least(1);
    expect(progressCalls[0]).to.be.a('number');
    expect(progressCalls[0]).to.be.at.least(0);
  });

  it('should handle connection refused gracefully', async () => {
    // Use a port that is very unlikely to be open
    const unavailablePort = 65432;
    const start = Date.now();
    const result = await pollHealthUntilReady(unavailablePort, {
      intervalMs: 100,
      timeoutMs: 350,
    });
    const elapsed = Date.now() - start;

    expect(result).to.be.false;
    expect(elapsed).to.be.at.least(300);
  });
});

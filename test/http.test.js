// -----------------------------------------------------------------------------
// The real transport (node:http), against a server on the loopback interface:
// method, headers, body, size cap, timeout. Nothing leaves the machine.
// (Adapted from guim31/gladys-uptime-kuma.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MAX_BODY_BYTES, httpRequest } from '../src/tandoor/http.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('sends the method, the headers and the JSON body, and reads the answer', async () => {
  await withServer(
    (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            authorization: req.headers.authorization,
            length: req.headers['content-length'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    },
    async (base) => {
      const body = JSON.stringify({ note: 'Œufs' });
      const response = await httpRequest(`${base}/api/shopping-list-entry/`, {
        method: 'POST',
        headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
        body,
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(response.body), {
        method: 'POST',
        url: '/api/shopping-list-entry/',
        authorization: 'Bearer abc',
        length: String(Buffer.byteLength(body)),
        body,
      });
    },
  );
});

test('an answer larger than the cap is refused', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(MAX_BODY_BYTES + 1024, 'a'));
    },
    async (base) => {
      await assert.rejects(httpRequest(`${base}/api/app/about`), /too large/);
    },
  );
});

test('a server that does not answer in time is a timeout', async () => {
  await withServer(
    () => {
      // Never answers.
    },
    async (base) => {
      await assert.rejects(httpRequest(`${base}/api/app/about`, { timeoutMs: 100 }), (err) => {
        assert.equal(err.code, 'ETIMEDOUT');
        return true;
      });
    },
  );
});

test('a closed port is refused', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(httpRequest(`http://127.0.0.1:${port}/api/app/about`), (err) => {
    assert.equal(err.code, 'ECONNREFUSED');
    return true;
  });
});

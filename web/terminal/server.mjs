#!/usr/bin/env node
// Stand-alone terminal gateway (the `terminal` service in docker-compose.yml).
// nginx forwards /terminal/ws here; see gateway.mjs for what it checks.
//
//   OMADA_CONTROLLER  controller base URL   (default https://omada-controller:8043)
//   TERMINAL_PORT     listen port           (default 8091)

import http from 'node:http';
import https from 'node:https';
import { attachTerminal } from './gateway.mjs';

const CONTROLLER = new URL(process.env.OMADA_CONTROLLER ?? 'https://omada-controller:8043');
const PORT = Number(process.env.TERMINAL_PORT ?? 8091);
const transport = CONTROLLER.protocol === 'https:' ? https : http;

function controllerGet(path, { cookie, token }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONTROLLER);
    const req = transport.request(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json', 'csrf-token': token, ...(cookie ? { cookie } : {}) },
        rejectUnauthorized: false, // the controller's certificate is self-signed
        timeout: 10_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(res.statusCode === 302 ? 'not signed in' : `HTTP ${res.statusCode}`));
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json.errorCode !== 0) return reject(new Error(json.msg || `error ${json.errorCode}`));
            resolve(json.result);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('controller timed out')));
    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/terminal/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(404);
  res.end();
});
attachTerminal(server, { controllerGet });
server.listen(PORT, () => console.log(`terminal gateway on :${PORT} → ${CONTROLLER.origin}`));

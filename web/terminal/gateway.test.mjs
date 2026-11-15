// @vitest-environment node
// End to end: WebSocket → gateway → a real SSH server (ssh2), checking how
// the session is started with and without a startup command.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import WebSocket from 'ws';
import { attachTerminal, startupCommand } from './gateway.mjs';

const MAC = '20-36-26-D5-A7-20';
const seen = []; // what the SSH server was asked to start
let sshServer;
let web;
let base;

// Close a channel the way a real server does: output, exit status, then EOF/close.
// (end() alone leaves the client's close racy.)
function finish(stream, text) {
  stream.write(text);
  stream.exit(0);
  stream.end();
}

beforeAll(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  sshServer = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client
      .on('authentication', (ctx) => (ctx.method === 'password' && ctx.password === 'pw' ? ctx.accept() : ctx.reject(['password'])))
      .on('ready', () =>
        client.on('session', (accept) => {
          const session = accept();
          let pty;
          session.on('pty', (acc, _rej, info) => {
            pty = { cols: info.cols, rows: info.rows, term: info.term };
            acc?.();
          });
          session.on('shell', (acc) => {
            seen.push({ kind: 'shell', pty });
            finish(acc(), 'EAP> ');
          });
          session.on('exec', (acc, _rej, info) => {
            seen.push({ kind: 'exec', command: info.command, pty });
            finish(acc(), '~ # ');
          });
        }),
      );
  });
  await new Promise((r) => sshServer.listen(0, '127.0.0.1', r));
  const sshPort = sshServer.address().port;

  web = http.createServer();
  const controllerGet = async (path) => {
    if (path.endsWith(`/eaps/${MAC}`)) return { mac: MAC, name: 'F65', ip: '127.0.0.1', statusCategory: 1, site: 'site00001' };
    if (path.endsWith('/setting/ssh')) return { sshEnable: true, sshServerPort: sshPort };
    if (path.endsWith('/setting')) return { deviceAccount: { username: 'admin', password: 'pw' } };
    throw new Error('-39303 does not exist');
  };
  attachTerminal(web, { controllerGet, overrideTarget: () => ({ host: '127.0.0.1', port: sshPort }), log: () => {} });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  base = `ws://127.0.0.1:${web.address().port}/terminal/ws`;
});

afterAll(() => {
  web?.close();
  sshServer?.close();
});

/** Open a session, collect everything until the gateway closes it. */
function run(extra) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base, { headers: { origin: base.replace(/^ws/, 'http').replace('/terminal/ws', '') } });
    const msgs = [];
    // Connection events, shown in failure messages (a refused connect shows up here).
    const trace = [];
    ['upgrade', 'unexpected-response', 'error'].forEach((ev) => ws.on(ev, (x) => trace.push(`${ev}:${x?.message ?? x?.statusCode ?? ''}`)));
    ws.on('open', () =>
      ws.send(JSON.stringify({ type: 'open', omadacId: 'omadac0001', token: 'tok', siteId: 'site00001', mac: MAC, cols: 120, rows: 40, ...extra })),
    );
    ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
    ws.on('close', (code, reason) => {
      msgs.trace = [...trace, `close:${code}:${reason}`];
      resolve(msgs);
    });
  });
}
const text = (msgs) => msgs.map((m) => m.data ?? m.text ?? '').join('\n') + (msgs.trace ? ` [trace ${msgs.trace.join(' ')}]` : '');

describe('terminal gateway startup command', { timeout: 15_000 }, () => {
  it('opens the login shell when no command is given', async () => {
    seen.length = 0;
    const msgs = await run({});
    expect(seen, text(msgs)).toEqual([{ kind: 'shell', pty: { cols: 120, rows: 40, term: 'xterm-256color' } }]);
    expect(text(msgs)).toContain('EAP> ');
  });

  it('runs the command on a PTY, like ssh -t device sh', async () => {
    seen.length = 0;
    const msgs = await run({ command: '  sh ' });
    expect(seen, text(msgs)).toEqual([{ kind: 'exec', command: 'sh', pty: { cols: 120, rows: 40, term: 'xterm-256color' } }]);
    expect(text(msgs)).toContain('Running "sh"');
    expect(text(msgs)).toContain('~ # ');
  });

  it('refuses a multi-line command before connecting', async () => {
    seen.length = 0;
    const msgs = await run({ command: 'sh\nreboot' });
    expect(seen).toEqual([]);
    expect(msgs.find((m) => m.type === 'error')?.text).toMatch(/one line/);
  });

  it('validates the command', () => {
    expect(startupCommand(undefined)).toBeUndefined();
    expect(startupCommand('   ')).toBeUndefined();
    expect(startupCommand('sh')).toBe('sh');
    expect(startupCommand(42)).toBeNull();
    expect(startupCommand('a'.repeat(257))).toBeNull();
    expect(startupCommand('sh\x1b')).toBeNull();
  });
});

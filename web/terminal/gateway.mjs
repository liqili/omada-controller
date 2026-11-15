// Browser terminal for adopted devices: WebSocket ⇄ SSH.
//
// The Omada controller has no terminal of its own, and a browser cannot speak
// SSH, so this small gateway does it. It trusts nothing the browser says:
//
//   1. The page opens ws(s)://<same origin>/terminal/ws. The upgrade is
//      refused unless its Origin matches its Host (no cross-site use).
//   2. The first message names the device and carries the page's controller
//      session token: {type:"open", omadacId, token, siteId, mac, cols, rows,
//      command?}. `command` (optional) is run instead of the login shell, on a
//      PTY — the same as `ssh -t user@device <command>`. Some EAP builds (e.g.
//      F65) open TP-Link's "EAP>" CLI for a plain login, but their dropbear runs
//      a command given on the ssh command line in a real shell: command "sh".
//   3. With the browser's own session cookie + token, the gateway asks the
//      CONTROLLER for that device, the site's SSH setting and the site's
//      device account. Any failure (signed out, no access, unknown device)
//      ends the session — so a user can only reach devices the controller
//      shows them, and only at the address the controller has for them.
//   4. It connects to device-ip:sshServerPort with the device account and
//      relays the shell. Credentials never reach the browser.
//
// Messages: browser → {type:"data",data} | {type:"resize",cols,rows}
//           gateway → {type:"data",data} | {type:"status",text} | {type:"error",text} | {type:"exit"}
//
// Used by terminal/server.mjs (docker) and sim/omada-sim.mjs (simulated devices).

import { WebSocketServer } from 'ws';
import ssh2 from 'ssh2';
import crypto from 'node:crypto';

const { Client } = ssh2;
const IDLE_MS = 30 * 60_000;
const MAC = /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/;
const ID = /^[0-9a-zA-Z]{8,64}$/;
const MAX_COMMAND = 256;

/** The startup command from the open message: undefined for none, null when invalid. */
export function startupCommand(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return null;
  const cmd = raw.trim();
  if (!cmd) return undefined;
  // One line of printable text: no newlines or control bytes smuggling more input.
  if (cmd.length > MAX_COMMAND || /[\x00-\x1f\x7f]/.test(cmd)) return null;
  return cmd;
}

/**
 * @param {import('node:http').Server} server
 * @param {object} opts
 * @param {(path: string, auth: {cookie?: string, token: string}) => Promise<any>} opts.controllerGet
 *        GET a controller path (`/{omadacId}/api/v2/...`); resolves with the envelope's `result`, rejects otherwise.
 * @param {string} [opts.path] websocket path, default /terminal/ws
 * @param {(device: any) => {host: string, port: number} | undefined} [opts.overrideTarget]
 *        simulator hook: lets simulated devices point at a local SSH server.
 */
export function attachTerminal(server, { controllerGet, path = '/terminal/ws', overrideTarget, log = console.log } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) return; // someone else's upgrade
    const origin = req.headers.origin;
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(origin) && new URL(origin).host === req.headers.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => session(ws, req));
  });

  function session(ws, req) {
    const send = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    const status = (text) => send({ type: 'status', text });
    const fail = (text) => {
      send({ type: 'error', text });
      ws.close();
    };
    let ssh;
    let stream;
    let idle;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        status('Closed after 30 minutes without input.');
        ws.close();
      }, IDLE_MS);
    };
    ws.on('close', () => {
      clearTimeout(idle);
      ssh?.end();
    });

    ws.once('message', async (raw) => {
      let open;
      try {
        open = JSON.parse(raw.toString());
      } catch {
        return fail('Bad request.');
      }
      const { omadacId, token, siteId, mac } = open ?? {};
      if (open?.type !== 'open' || !ID.test(omadacId ?? '') || !ID.test(siteId ?? '') || !MAC.test(mac ?? '') || typeof token !== 'string') {
        return fail('Bad request.');
      }
      const command = startupCommand(open.command);
      if (command === null) return fail(`The startup command must be one line of at most ${MAX_COMMAND} characters.`);
      const auth = { cookie: req.headers.cookie, token };
      const api = (p) => controllerGet(`/${omadacId}/api/v2/${p}`, auth);
      // The controller has no devices/{mac}; detail lives under the device
      // type (eaps | switches | gateways), and the other two answer "does not
      // exist". Take whichever knows the MAC; pass on a session/HTTP failure.
      const findDevice = () =>
        Promise.any(['eaps', 'switches', 'gateways'].map((kind) => api(`sites/${siteId}/${kind}/${mac}`))).catch((all) => {
          const fatal = all.errors.find((e) => /not signed in|^HTTP /.test(e.message));
          if (fatal) throw fatal;
          return undefined;
        });

      let device, sshSetting, siteSetting;
      try {
        status('Checking your session with the controller…');
        [device, sshSetting, siteSetting] = await Promise.all([
          findDevice(),
          api(`sites/${siteId}/setting/ssh`),
          api(`sites/${siteId}/setting`),
        ]);
      } catch (e) {
        return fail(`The controller refused: ${e.message}`);
      }
      if (!device || (device.site && device.site !== siteId)) return fail('This device is not in the selected site.');
      if (device.statusCategory !== 1) return fail('The device is not connected.');
      if (!sshSetting?.sshEnable) {
        return fail('SSH is turned off for this site. Turn it on under Services → SSH, wait for the devices to pick it up, then try again.');
      }
      const account = siteSetting?.deviceAccount;
      if (!account?.username || !account?.password) return fail('The site has no device account to sign in with.');

      const target = overrideTarget?.(device) ?? { host: device.ip, port: sshSetting.sshServerPort || 22 };
      if (!target.host) return fail('The controller has no IP address for this device.');

      status(`Connecting to ${device.name ?? mac} at ${target.host}:${target.port} as ${account.username}…`);
      log(`terminal: ${mac} ${target.host}:${target.port} opened${command ? ` (command: ${command})` : ''}`);
      ssh = new Client();
      ssh
        .on('ready', () => {
          const pty = { term: 'xterm-256color', cols: open.cols || 80, rows: open.rows || 24 };
          const started = (err, s) => {
            if (err) return fail(command ? `Could not run "${command}": ${err.message}` : `Could not start a shell: ${err.message}`);
            stream = s;
            touch();
            s.on('data', (d) => send({ type: 'data', data: d.toString('utf8') }));
            s.stderr?.on('data', (d) => send({ type: 'data', data: d.toString('utf8') }));
            s.on('close', () => {
              send({ type: 'exit' });
              ws.close();
            });
          };
          if (command) {
            status(`Running "${command}" on a terminal (like ssh -t)…`);
            ssh.exec(command, { pty }, started);
          } else {
            ssh.shell(pty, started);
          }
        })
        .on('error', (e) => fail(`SSH: ${e.message}`))
        .on('close', () => ws.readyState === ws.OPEN && ws.close())
        .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => account.password)));
      ssh.connect({
          host: target.host,
          port: target.port,
          username: account.username,
          password: account.password,
          tryKeyboard: true,
          readyTimeout: 15_000,
          keepaliveInterval: 20_000,
          // Omada devices generate their own host keys; there is no CA to check
          // against. Show the fingerprint so the user can compare it.
          hostVerifier: (key) => {
            const fp = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
            status(`Host key SHA256:${fp}`);
            return true;
          },
        });

      ws.on('message', (raw2) => {
        let msg;
        try {
          msg = JSON.parse(raw2.toString());
        } catch {
          return;
        }
        if (msg.type === 'data' && typeof msg.data === 'string' && stream) {
          touch();
          stream.write(msg.data);
        } else if (msg.type === 'resize' && stream) {
          const cols = Math.max(10, Math.min(500, Number(msg.cols) || 80));
          const rows = Math.max(5, Math.min(200, Number(msg.rows) || 24));
          stream.setWindow(rows, cols, 0, 0);
        }
      });
    });
  }

  return wss;
}

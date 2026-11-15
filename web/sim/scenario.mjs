#!/usr/bin/env node
// End-to-end device scenario against the simulator (sim/omada-sim.mjs).
//
// Uses the same HTTP calls the dashboard makes, so it checks the whole path:
// simulated devices + the REAL controller's settings API. Everything it writes
// to the controller (test SSIDs, an LLDP toggle, SSH) is reverted in `finally`.
//
//   OMADA_USER=admin OMADA_PASS=… node sim/scenario.mjs
//   SIM_URL=http://localhost:8090 (default)
//
// Note: logging in here signs the browser out (one session per account).

import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The dashboard's SSID editor model (TypeScript) — compiled on the fly so the
// scenario saves exactly what the editor would.
const ssidFormJs = join(tmpdir(), `ssidForm-${process.pid}.mjs`);
await build({ entryPoints: [new URL('../src/api/domains/ssidForm.ts', import.meta.url).pathname], outfile: ssidFormJs, format: 'esm', platform: 'node', bundle: true, logLevel: 'warning' });
const { formFromSsid, serializeSsid, applyChange } = await import(pathToFileURL(ssidFormJs).href);

const BASE = process.env.SIM_URL ?? 'http://localhost:8090';
const USER = process.env.OMADA_USER ?? 'admin';
const PASS = process.env.OMADA_PASS;
if (!PASS) {
  console.error('Set OMADA_PASS (and OMADA_USER if not "admin").');
  process.exit(2);
}

const AP = '02-5A-00-00-A0-01';
const SW = '02-5A-00-00-B0-01';
const BAD = '02-5A-00-00-A0-02';
const SSID_NAME = 'SIM-Provision-Test';

const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${stamp()}  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const note = (msg) => console.log(`${stamp()}        ${msg}`);

let cookie = '';
let token = '';
let cid = '';
let sid = '';

async function call(method, apiPath, body, params = {}) {
  const qs = new URLSearchParams(params); // token goes in the Csrf-Token header only, as the app sends it
  const url = `${BASE}/controller-api${cid ? `/${cid}` : ''}/api/v2/${apiPath}?${qs}`;
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(token ? { 'Csrf-Token': token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const json = await res.json();
  if (json.errorCode !== 0) throw new Error(`${method} ${apiPath} → ${json.errorCode} ${json.msg}`);
  return json.result;
}
const sim = (method, p) => fetch(`${BASE}/sim/${p}`, { method }).then((r) => r.json());
// The dashboard's lookup: the device's row in the adopted or pending grid.
const device = async (mac) => {
  for (const grid of ['grid/devices/adopted', 'grid/devices/pending']) {
    const hit = (await call('GET', grid, undefined, { currentPage: 1, currentPageSize: 200 }))?.data?.find((d) => d.mac === mac);
    if (hit) return hit;
  }
  return { mac, status: undefined };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a device and record every status it passes through until `done`. */
async function watch(mac, done, timeoutMs = 30000) {
  const seen = [];
  const end = Date.now() + timeoutMs;
  let d;
  while (Date.now() < end) {
    d = await device(mac);
    if (seen.at(-1) !== d.status) seen.push(d.status);
    if (done(d)) return { d, seen };
    await sleep(400);
  }
  return { d, seen, timeout: true };
}

let ssidId;
const extraSsids = [];
let wlanId;
let lldpBefore;
let sshBefore;

/** Same two-step multipart upload the dashboard (and the vendor UI) sends for a manual firmware upgrade. */
async function uploadFirmware(name, bytes = 4096, { md5 = true } = {}) {
  const file = new Uint8Array(bytes);
  const data = JSON.stringify(md5 ? { md5: createHash('md5').update(file).digest('hex') } : {});
  const post = async (withFile) => {
    const form = new FormData();
    form.append('data', data);
    if (withFile) form.append('file', new Blob([file]), name);
    const res = await fetch(`${BASE}/controller-api/${cid}/api/v2/files/sites/${sid}/device/upgrade`, {
      method: 'POST',
      headers: { cookie, 'Csrf-Token': token },
      body: form,
    });
    return res.json();
  };
  const probe = await post(false);
  return probe.errorCode !== 0 || probe.result?.fileId ? probe : post(true);
}

/** Open a terminal session through the gateway, run commands, return the text. */
function terminal(mac, commands, { origin = BASE } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/terminal/ws`, { headers: { origin, cookie } });
    let text = '';
    let sent = false;
    const finish = (extra = '') => resolve(text + extra);
    ws.on('unexpected-response', (_req, res) => finish(`HTTP ${res.statusCode}`));
    ws.on('error', (e) => finish(`ERR ${e.message}`));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'open', omadacId: cid, token, siteId: sid, mac, cols: 100, rows: 30 })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      text += msg.type === 'data' ? msg.data : `\n[${msg.type}] ${msg.text ?? ''}\n`;
      if (msg.type === 'data' && !sent && text.includes('# ')) {
        sent = true;
        commands.forEach((c, i) => setTimeout(() => ws.send(JSON.stringify({ type: 'data', data: `${c}\r` })), 200 * (i + 1)));
      }
    });
    ws.on('close', () => finish());
    setTimeout(() => ws.close(), 8000);
  });
}

try {
  // ── 0. sign in ──
  const login = await call('POST', 'login', { username: USER, password: PASS });
  token = login.token;
  cid = login.omadacId;
  sid = (await call('GET', 'sites/default')).id;
  note(`signed in · omadacId ${cid} · site ${sid}`);
  const state = await sim('GET', 'state');
  note(`simulator step ${state.stepMs} ms`);

  // ── 1. discovery ──
  await sim('POST', 'reset');
  const pending = await call('GET', 'grid/devices/pending', undefined, { currentPage: 1, currentPageSize: 100 });
  const pendingMacs = (pending.data ?? []).map((d) => d.mac);
  check('Simulated devices show up as pending', [AP, SW, BAD].every((m) => pendingMacs.includes(m)), pendingMacs.join(', '));
  check('Pending tab counts include them', (pending.deviceStat?.allDevices ?? 0) >= 3, `allDevices ${pending.deviceStat?.allDevices}`);

  // ── 2. adoption ──
  const wrongBody = await call('POST', `sites/${sid}/cmd/devices/adopt`, { macList: [AP] }).then(() => 'accepted', (e) => e.message);
  check('Adopt with a {macList} body is refused', wrongBody !== 'accepted', wrongBody);
  await call('POST', `sites/${sid}/cmd/devices/batchAdopt`, { macs: [AP, SW, BAD], deviceSeriesType: 0 });
  const [ap, sw, bad] = await Promise.all([
    watch(AP, (d) => d.status === 14),
    watch(SW, (d) => d.status === 14),
    watch(BAD, (d) => d.status === 24),
  ]);
  check('AP adopted: pending → adopting → provisioning → connected', ap.seen.join('→').endsWith('22→10→14'), ap.seen.join(' → '));
  check('Switch adopted', sw.seen.join('→').endsWith('22→10→14'), sw.seen.join(' → '));
  check('Faulty AP ends in "adoption failed"', bad.d.status === 24, bad.seen.join(' → '));
  check('AP got its WLAN group on adoption', Boolean(ap.d.wlanGroup), `group "${ap.d.wlanGroup}"`);
  note(`AP broadcasts: ${(ap.d.simBroadcast ?? []).map((b) => `${b.ssid}@${b.band}`).join(', ') || 'nothing'}`);
  note(`Switch received: ${(sw.d.provision?.items ?? []).join(' · ')}`);
  const adopted = await call('GET', 'grid/devices/adopted', undefined, { currentPage: 1, currentPageSize: 200 });
  const adoptedMacs = (adopted.data ?? []).map((d) => d.mac);
  check('Adopted list has AP + switch, not the failed one', adoptedMacs.includes(AP) && adoptedMacs.includes(SW) && !adoptedMacs.includes(BAD));
  const alerts = await call('GET', `sites/${sid}/alerts/num`);
  check('Failed adoption raised an alert', (alerts.alertNum ?? 0) >= 1, `alertNum ${alerts.alertNum}`);
  const ov = await call('GET', 'dashboard/overview');
  check('Dashboard counts the new devices', (ov.connectedApNum ?? 0) >= 1 && (ov.connectedSwitchNum ?? 0) >= 1, `APs ${ov.connectedApNum}/${ov.totalApNum} · switches ${ov.connectedSwitchNum}/${ov.totalSwitchNum}`);

  // ── 3. wireless provisioning: create an SSID on the real controller ──
  wlanId = ap.d.wlanId ?? (await call('GET', `sites/${sid}/setting/wlans`)).data[0].id;
  const swProvisionedAt = sw.d.provision?.at;
  // The body the legacy (vendor) editor sends for "name + password, defaults
  // otherwise" — derived from its serializers; ssidForm.test.ts pins it too.
  const rateLimits = await call('GET', `sites/${sid}/setting/profiles/rateLimits`);
  const defaultRateLimitId = rateLimits.find((p) => p.isDefault)?.id;
  const legacyBody = (name) => ({
    name,
    band: 3,
    guestNetEnable: false,
    security: 3,
    broadcast: true,
    vlanSetting: { mode: 0 },
    pskSetting: { securityKey: 'sim-test-1234', encryptionPsk: 3, versionPsk: 2, gikRekeyPskEnable: false },
    rateLimit: { rateLimitId: defaultRateLimitId },
    ssidRateLimit: { rateLimitId: defaultRateLimitId },
    wlanScheduleEnable: false,
    rateAndBeaconCtrl: { rate2gCtrlEnable: false, rate5gCtrlEnable: false, rate6gCtrlEnable: false },
    macFilterEnable: false,
    wlanId,
    enable11r: false,
    pmfMode: 3,
    multiCastSetting: { multiCastEnable: true, arpCastEnable: true, filterEnable: false, ipv6CastEnable: true, channelUtil: 100 },
    deviceType: 1,
    mloEnable: false,
  });
  const created = await call('POST', `sites/${sid}/setting/wlans/${wlanId}/ssids`, legacyBody(SSID_NAME));
  ssidId = created?.ssidId;
  note(`created SSID "${SSID_NAME}" (${ssidId}) on the real controller`);
  let r = await watch(AP, (d) => d.status === 14 && d.provision?.request?.startsWith('POST setting/wlans'));
  check('AP went configuring → connected after the SSID was saved', r.seen.includes(11), r.seen.join(' → '));
  const bands = (r.d.simBroadcast ?? []).filter((b) => b.ssid === SSID_NAME).map((b) => b.band);
  check('AP now broadcasts the new SSID on both bands', bands.length === 2, bands.join(' + '));
  const swNow = await device(SW);
  check('Switch was not touched by a wireless change', swNow.status === 14 && swNow.provision?.at === swProvisionedAt);

  // ── 3b. Wi-Fi parity: the dashboard editor provisions what the legacy one does ──
  const listSsids = async () => (await call('GET', `sites/${sid}/setting/wlans/${wlanId}/ssids`, undefined, { currentPage: 1, currentPageSize: 100 })).data;
  const deep = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)));
  const comparable = (row) => {
    const { id, idInt, index, name, ...rest } = row;
    return JSON.stringify(deep(rest));
  };
  const wlanOf = (d, name) => {
    const w = (d.simWlans ?? []).find((x) => x.ssid === name);
    return w && deep({ ...w, ssid: undefined });
  };
  const addCtx = { mode: 'add', wlanId, defaultRateLimitId, has6g: false };
  const editorForm = formFromSsid(addCtx);
  editorForm.name = `${SSID_NAME}-editor`;
  editorForm.securityKey = 'sim-test-1234';
  const editorCreated = await call('POST', `sites/${sid}/setting/wlans/${wlanId}/ssids`, serializeSsid(editorForm, addCtx));
  extraSsids.push(editorCreated.ssidId);
  r = await watch(AP, (d) => d.status === 14 && (d.simWlans ?? []).some((w) => w.ssid === editorForm.name));
  const rows = await listSsids();
  const legacyRow = rows.find((x) => x.id === ssidId);
  const editorRow = rows.find((x) => x.id === editorCreated.ssidId);
  check('Editor stores the same SSID document as the legacy editor', comparable(legacyRow) === comparable(editorRow), comparable(editorRow).length + ' chars compared');
  check(
    'AP receives the same Wi-Fi config from both',
    JSON.stringify(wlanOf(r.d, SSID_NAME)) === JSON.stringify(wlanOf(r.d, editorForm.name)),
    (r.d.provision?.items ?? []).find((i) => i.startsWith(`SSID ${editorForm.name}:`)),
  );

  // An unchanged edit in the editor must not change anything on the AP.
  const editCtx = { mode: 'edit', wlanId, row: editorRow, defaultRateLimitId };
  await call('PATCH', `sites/${sid}/setting/wlans/${wlanId}/ssids/${editorRow.id}`, serializeSsid(formFromSsid(editCtx), editCtx));
  const after = (await listSsids()).find((x) => x.id === editorRow.id);
  check('Saving without changes leaves the stored SSID untouched', comparable(after) === comparable(editorRow));

  // A richer network: what the AP applies must follow every choice.
  let rich = formFromSsid(addCtx);
  rich.name = `${SSID_NAME}-rich`;
  rich.securityKey = 'sim-test-1234';
  rich = applyChange(rich, { wpaVersion: 4, wpaEncryption: 3 }, addCtx);
  rich = applyChange(rich, {
    enable11r: true, broadcast: false, guestNetEnable: true, vlanMode: 1, customMode: 1, vlanId: 30,
    clientRateLimitId: 'custom', clientDownLimitEnable: true, clientDownLimit: 20, clientDownLimitType: 1,
    rate2gCtrlEnable: true, lowerDensity2g: 12, cckRatesDisable: true, arpCastEnable: false,
  }, addCtx);
  const richCreated = await call('POST', `sites/${sid}/setting/wlans/${wlanId}/ssids`, serializeSsid(rich, addCtx));
  extraSsids.push(richCreated.ssidId);
  r = await watch(AP, (d) => d.status === 14 && (d.simWlans ?? []).some((w) => w.ssid === rich.name));
  const w = (r.d.simWlans ?? []).find((x) => x.ssid === rich.name) ?? {};
  check(
    'AP applies WPA2/WPA3 transition with PMF capable, 802.11r, hidden, guest',
    w.security === 'WPA2-PSK/WPA3-SAE AES' && w.pmf === 'capable' && w.fastRoaming && w.hidden && w.guest,
    `${w.security} · PMF ${w.pmf}`,
  );
  check(
    'AP applies VLAN 30, 20 Mbps client limit, 12 Mbps minimum rate without CCK, ARP conversion off',
    w.vlan === 30 && w.clientLimit?.down === '20 Mbps' && w.minRate?.['2.4 GHz'] === '12 Mbps, no CCK' && w.multicast?.arpToUnicast === false,
    (r.d.provision?.items ?? []).find((i) => i.startsWith(`SSID ${rich.name}:`)),
  );
  for (const id of extraSsids.splice(0)) await call('DELETE', `sites/${sid}/setting/wlans/${wlanId}/ssids/${id}`);
  await watch(AP, (d) => d.status === 14 && !(d.simWlans ?? []).some((x) => x.ssid.startsWith(`${SSID_NAME}-`)));

  // ── 4. a site-wide setting reaches the switch too ──
  const site = await call('GET', `sites/${sid}/setting`);
  lldpBefore = Boolean(site.lldp?.enable);
  await call('PATCH', `sites/${sid}/setting`, { lldp: { enable: !lldpBefore } });
  note(`LLDP ${lldpBefore ? 'on → off' : 'off → on'} on the real controller`);
  r = await watch(SW, (d) => d.status === 14 && d.provision?.request === 'PATCH setting');
  check('Switch re-provisioned for LLDP', r.seen.includes(11), r.seen.join(' → '));
  check('Switch config reflects the new LLDP value', r.d.provision?.items.includes(`LLDP ${!lldpBefore ? 'on' : 'off'}`), r.d.provision?.items.join(' · '));
  await call('PATCH', `sites/${sid}/setting`, { lldp: { enable: lldpBefore } });
  lldpBefore = undefined;
  note('LLDP reverted');
  await watch(SW, (d) => d.status === 14);

  // ── 5. delete the SSID ──
  await call('DELETE', `sites/${sid}/setting/wlans/${wlanId}/ssids/${ssidId}`);
  ssidId = undefined;
  r = await watch(AP, (d) => d.status === 14 && d.provision?.request?.startsWith('DELETE'));
  check('AP dropped the SSID after it was deleted', !(r.d.simBroadcast ?? []).some((b) => b.ssid === SSID_NAME), r.seen.join(' → '));

  // ── 6. device commands ──
  await call('POST', `sites/${sid}/cmd/devices/${SW}/forceProvision`, {});
  r = await watch(SW, (d) => d.status === 14 && d.provision?.reason === 'Force provision');
  check('Force provision: provisioning → connected', r.seen.includes(10), r.seen.join(' → '));
  await call('POST', `sites/${sid}/cmd/devices/${AP}/reboot`, { mac: AP });
  r = await watch(AP, (d) => d.status === 14 && d.provision?.reason?.includes('reboot'), 40000);
  check('Reboot: rebooting → disconnected → provisioning → connected', r.seen.join('→').endsWith('13→0→10→14'), r.seen.join(' → '));

  // ── 7. retry the failed adoption after fixing it ──
  const wrongLogin = await call('POST', `sites/${sid}/cmd/devices/adopt`, { mac: BAD, username: 'admin', password: 'nope' }).then(
    () => 'accepted',
    (e) => e.message,
  );
  check('Adopting with a wrong device login is refused (-39003)', /username or password is incorrect/.test(wrongLogin), wrongLogin);
  await call('POST', `sites/${sid}/cmd/devices/adopt`, { mac: BAD, username: 'admin', password: 'garden-pass' });
  r = await watch(BAD, (d) => d.status === 14);
  check('Retried adoption with the device login succeeds', r.d.status === 14, r.seen.join(' → '));

  // ── 8. per-AP configuration ──
  const apCfg = await call('GET', `sites/${sid}/eaps/${AP}`);
  check('AP configuration loads', apCfg.radioSetting5g && apCfg.ipSetting, `5 GHz width ${apCfg.radioSetting5g?.channelWidth}, IP ${apCfg.ipSetting?.mode}`);
  await call('PUT', `sites/${sid}/eaps/${AP}/config/general`, { name: 'SIM-EAP650-Hall', ledSetting: 0 });
  r = await watch(AP, (d) => d.status === 14 && d.provision?.request === 'PUT eaps/config/general');
  check('Rename + LED off: AP reconfigures and takes the new name', r.d.name === 'SIM-EAP650-Hall' && r.seen.includes(11) && r.d.provision.items.includes('LED off (device)'), `${r.seen.join(' → ')} · ${r.d.name}`);
  // radioSetting.channel takes the channel list entry's `value`, not the channel number.
  const list5 = (await call('GET', `sites/${sid}/eaps/${AP}/channelInfo`)).data.find((r) => r.radioId === 1).channelList;
  const ch44 = list5.find((c) => c.channelValue === 44);
  check('Channel list labels match the controller ("44 / 5220MHz", own value index)', ch44?.channelName === '44 / 5220MHz' && String(ch44.value) !== '44', JSON.stringify(ch44));
  await call('PUT', `sites/${sid}/eaps/${AP}/config/radios`, { radioSetting5g: { ...apCfg.radioSetting5g, channel: String(ch44.value), channelWidth: '5', txPowerLevel: 3, txPower: 18 } });
  r = await watch(AP, (d) => d.status === 14 && d.provision?.request === 'PUT eaps/config/radios');
  const radio5 = r.d.provision.items.find((i) => i.startsWith('5 GHz'));
  check('5 GHz radio set to channel 44, 80 MHz, 18 dBm', radio5 === '5 GHz ch 44 · 80 MHz · 18 dBm', radio5);
  const live = await call('GET', `sites/${sid}/eaps/${AP}`);
  check('AP detail reports the live channel, width and utilization', live.wp5g?.actualChannel === '44 / 5220MHz' && live.wp5g?.bandWidth === '80MHz' && typeof live.wp5g?.rxUtil === 'number', JSON.stringify(live.wp5g));
  const badRadio = await call('PUT', `sites/${sid}/eaps/${AP}/config/radios`, { radioSetting5g: { ...apCfg.radioSetting5g, channel: '99' } }).then(() => 'accepted', (e) => e.message);
  check('Invalid channel is rejected', badRadio.includes('-1001'), badRadio);
  await call('PUT', `sites/${sid}/eaps/${AP}/config/ip-settings`, { ipSetting: { mode: 'static', configIp: '192.168.0.50', configMask: '255.255.255.0', configGate: '192.168.0.1' } });
  r = await watch(AP, (d) => d.status === 14 && d.provision?.request === 'PUT eaps/config/ip-settings');
  check('Static IP applied', r.d.ip === '192.168.0.50', r.d.ip);

  // ── 9. firmware ──
  const fwInfo = await call('GET', `sites/${sid}/devices/${AP}/firmware`);
  check('Firmware check finds a newer version', fwInfo.lastFwVer && fwInfo.lastFwVer !== fwInfo.curFwVer, `${fwInfo.curFwVer} → ${fwInfo.lastFwVer}`);
  await call('POST', `sites/${sid}/cmd/devices/${AP}/onlineUpgrade`, { mac: AP });
  r = await watch(AP, (d) => d.status === 14 && d.firmwareVersion === fwInfo.lastFwVer, 40000);
  check('Online upgrade: upgrading → rebooting → connected on the new version', r.seen.join('→').endsWith('12→13→0→10→14'), `${r.seen.join(' → ')} · ${r.d.firmwareVersion}`);
  const again = await call('POST', `sites/${sid}/cmd/devices/${AP}/onlineUpgrade`, { mac: AP }).then(() => 'accepted', (e) => e.message);
  check('A second online upgrade is refused (already latest)', again.includes('latest'), again);
  await call('POST', `sites/${sid}/cmd/devices/checkFirmware`, { mac: [AP] });
  const noMd5 = await uploadFirmware('EAP650v1_1.2.0_20251001.bin', 4096, { md5: false });
  check('A firmware upload without md5 is refused', noMd5.errorCode === -1001, noMd5.msg);
  await call('POST', `sites/${sid}/cmd/devices/checkFirmware`, { mac: [AP] });
  const wrong = await uploadFirmware('EAP225v3_5.2.0_20251001.bin');
  check('Firmware for another model is rejected', wrong.errorCode === -39304, wrong.msg);
  await call('POST', `sites/${sid}/cmd/devices/checkFirmware`, { mac: [AP] });
  const good = await uploadFirmware('EAP650v1_1.2.0_20251001.bin');
  check('Matching firmware file uploads', good.errorCode === 0 && good.result?.fileId, good.result?.fileId ?? good.msg);
  await call('POST', `sites/${sid}/cmd/devices/upgrade`, { fileId: good.result?.fileId, macs: [AP], type: 'ap', isSingle: true });
  r = await watch(AP, (d) => d.status === 14 && d.firmwareVersion?.startsWith('1.2.0'), 40000);
  check('Manual upgrade installs the uploaded version', r.d.firmwareVersion?.startsWith('1.2.0'), r.d.firmwareVersion);

  // ── 10. terminal (WebSocket → gateway → SSH) ──
  const sshNow = await call('GET', `sites/${sid}/setting/ssh`);
  const off = await terminal(AP, []);
  check('Terminal explains when SSH is off for the site', sshNow.sshEnable || off.includes('SSH is turned off'), off.trim().split('\n').at(-1));
  const foreign = await terminal(AP, [], { origin: 'http://evil.example' });
  check('Terminal refuses another origin', foreign.includes('HTTP 403'), foreign.trim());
  if (!sshNow.sshEnable) {
    sshBefore = sshNow;
    await call('PUT', `sites/${sid}/setting/ssh`, { ...sshNow, sshEnable: true });
    note('SSH turned on for the site on the real controller');
    await watch(AP, (d) => d.status === 14 && d.provision?.items.includes('SSH on'));
  }
  const session = await terminal(AP, ['show version', 'show config', 'exit']);
  check('SSH session opens and runs commands', session.includes(`Firmware: ${r.d.firmwareVersion}`) && session.includes('5 GHz ch 44'), session.includes('Host key SHA256:') ? 'host key shown' : '');
  const swSession = await terminal(SW, ['ifconfig', 'exit']);
  check('Switch terminal works too', swSession.includes('inet addr:192.168.0.2'), '');
  if (sshBefore) {
    await call('PUT', `sites/${sid}/setting/ssh`, sshBefore);
    sshBefore = undefined;
    note('SSH setting reverted');
    await watch(AP, (d) => d.status === 14 && d.provision?.items.includes('SSH off'));
  }
  const closed = await terminal(AP, []);
  check('After SSH is turned off again, the terminal is refused', closed.includes('SSH is turned off'), '');

  // ── 11. forget ──
  await call('POST', `sites/${sid}/cmd/devices/${AP}/forget`, { mac: AP });
  r = await watch(AP, (d) => d.status === 20);
  check('Forgotten AP returns to pending with no config', r.d.status === 20 && !r.d.provision, r.seen.join(' → '));

  // ── 12. event log ──
  const events = await call('GET', `sites/${sid}/logs/events`, undefined, {
    currentPage: 1,
    currentPageSize: 100,
    'filters.timeStart': t0 - 1000,
    'filters.timeEnd': Date.now() + 1000,
  });
  const simEvents = (events.data ?? []).filter((e) => String(e.content).startsWith('[Simulated]'));
  check('Event log shows the device history', simEvents.length >= 10, `${simEvents.length} simulated events`);
} catch (e) {
  check('Scenario ran to the end', false, e.message);
} finally {
  // Leave the real controller as we found it.
  for (const id of wlanId ? extraSsids : []) {
    await call('DELETE', `sites/${sid}/setting/wlans/${wlanId}/ssids/${id}`).then(
      () => note('cleanup: test SSID deleted'),
      (e) => note(`cleanup FAILED — delete SSID ${id} by hand: ${e.message}`),
    );
  }
  if (ssidId && wlanId) {
    await call('DELETE', `sites/${sid}/setting/wlans/${wlanId}/ssids/${ssidId}`).then(
      () => note('cleanup: SSID deleted'),
      (e) => note(`cleanup FAILED — delete SSID ${SSID_NAME} by hand: ${e.message}`),
    );
  }
  if (sshBefore) {
    await call('PUT', `sites/${sid}/setting/ssh`, sshBefore).then(
      () => note('cleanup: SSH setting reverted'),
      (e) => note(`cleanup FAILED — turn SSH back off under Services: ${e.message}`),
    );
  }
  if (lldpBefore !== undefined) {
    await call('PATCH', `sites/${sid}/setting`, { lldp: { enable: lldpBefore } }).then(
      () => note('cleanup: LLDP reverted'),
      (e) => note(`cleanup FAILED — set LLDP back to ${lldpBefore}: ${e.message}`),
    );
  }
  await sim('POST', 'reset').catch(() => {});
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

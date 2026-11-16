#!/usr/bin/env node
// Omada device simulator — an API-layer stand-in for real hardware.
//
// Why at the API layer: real devices reach the controller over TP-Link's ECSP
// protocol on 29810-29816, and the controller only trusts devices whose TLS
// certificates chain to its built-in trust store (device-gateway-port-local/
// ssl/server.truststore). A fake AP cannot join for real, so instead this
// server sits between the dashboard and the controller:
//
//   browser ──▶ :8090 ──▶ web/dist (static, like nginx)
//                    └──▶ /controller-api/* ──▶ https://localhost:8043 (real)
//
// Every request is forwarded to the REAL controller. On top of that:
//   * device endpoints (pending/adopted grids, device detail, overview, logs)
//     get simulated devices merged in;
//   * device commands for simulated MACs (adopt, forget, reboot, locate,
//     forceProvision) are answered here and drive a state machine that uses
//     the vendor's real status codes (20 pending → 22 adopting → 10
//     provisioning → 14 connected; 11 configuring; 13 rebooting; 24 adopt
//     failed);
//   * every SUCCESSFUL settings write that passes through to the real
//     controller (sites/{sid}/setting…, rfPlanning…) makes the affected
//     simulated devices go 14 → 11 configuring → 14, and they re-read the real
//     controller's config (e.g. an AP re-reads its WLAN group's SSIDs), so the
//     "provisioned" state shown in the UI reflects what was really saved.
//
// Per-device features are simulated too: AP configuration
// (sites/{sid}/eaps/{mac}…), firmware (online upgrade and .bin upload), and
// SSH — each simulated device runs a real SSH server on 127.0.0.1:2221+n,
// reached through the real terminal gateway (../terminal/gateway.mjs) that
// this server mounts at /terminal/ws.
//
// Nothing here touches the controller's database except the settings writes
// the user (or scenario.mjs) makes on purpose.
//
//   node sim/omada-sim.mjs            # then open http://localhost:8090
//   SIM_PORT=8090 SIM_SPEED=1 OMADA_UPSTREAM=https://localhost:8043
//
// Control API (not part of Omada): GET /sim/state · POST /sim/reset ·
// POST /sim/devices/{mac}/fix (clear a simulated adoption fault).

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ssh2 from 'ssh2';
import { attachTerminal } from '../terminal/gateway.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIM_PORT ?? 8090);
const UPSTREAM = new URL(process.env.OMADA_UPSTREAM ?? 'https://localhost:8043');
const DIST = path.resolve(process.env.SIM_DIST ?? path.join(here, '..', 'dist'));
const SPEED = Number(process.env.SIM_SPEED ?? 1) || 1;
const STEP = Math.round(3000 / SPEED);
// Each simulated device runs a real SSH server on 127.0.0.1:(SSH_BASE + n).
const SSH_BASE = Number(process.env.SIM_SSH_BASE ?? 2221);

// ── vendor status codes (access_points/device_index bundle) ──────────────
const ST = {
  DISCONNECTED: 0,
  PROVISIONING: 10,
  CONFIGURING: 11,
  UPGRADING: 12,
  REBOOTING: 13,
  CONNECTED: 14,
  PENDING: 20,
  ADOPTING: 22,
  ADOPT_FAILED: 24,
};
const categoryOf = (s) => (s >= 10 && s < 20 ? 1 : s >= 20 && s < 30 ? 2 : s >= 30 && s < 40 ? 3 : s >= 40 ? 4 : 0);

// Locally administered MACs (02-…) so they can never collide with real gear.
const SEEDS = [
  {
    mac: '02-5A-00-00-A0-01',
    name: 'SIM-EAP650-Lobby',
    type: 'ap',
    model: 'EAP650',
    showModel: 'EAP650(EU) v1.0',
    firmwareVersion: '1.0.5 Build 20240613 Rel. 58301',
    hwVersion: '1.0',
    ip: '192.168.0.21',
    bands: ['2.4 GHz', '5 GHz'],
    latestFw: '1.1.2 Build 20250918 Rel. 61005',
    releaseLog: 'Improvements:\n1. Improved roaming stability with 802.11k/v.\n2. Added per-radio scheduling.\nBug fixes:\n1. Fixed 5 GHz clients dropping after DFS channel changes.',
  },
  {
    mac: '02-5A-00-00-B0-01',
    name: 'SIM-SG2210P-Rack',
    type: 'switch',
    model: 'TL-SG2210P',
    showModel: 'TL-SG2210P v5.20',
    firmwareVersion: '5.20.13 Build 20240527 Rel.55612',
    hwVersion: '5.20',
    ip: '192.168.0.2',
    ports: 10,
  },
  {
    mac: '02-5A-00-00-A0-02',
    name: 'SIM-EAP225-Garden',
    type: 'ap',
    model: 'EAP225-Outdoor',
    showModel: 'EAP225-Outdoor(EU) v3.0',
    firmwareVersion: '5.1.6 Build 20240402 Rel. 61221',
    hwVersion: '3.0',
    ip: '192.168.0.22',
    bands: ['2.4 GHz', '5 GHz'],
    latestFw: '5.1.9 Build 20250701 Rel. 40212',
    releaseLog: 'Bug fixes:\n1. Fixed LED schedule not applied after reboot.',
    // Simulates a device that still carries credentials from another
    // controller: adoption fails on its login until it is adopted with
    // `login` below (a single adopt then answers -39003, as a real controller
    // does), or POST /sim/devices/{mac}/fix clears the fault.
    fault: 'Device username/password do not match',
    login: { username: 'admin', password: 'garden-pass' },
  },
];

let devices;
let logs;
let logSeq = 0;
/** Simulated firmware uploads, fileId → {mac, name, size, version}. */
const uploads = new Map();
/** MAC named by the last checkFirmware call (the upload that follows is for it). */
let uploadFor;

function reset() {
  devices = new Map(
    SEEDS.map((s) => [
      s.mac,
      {
        ...s,
        status: ST.PENDING,
        siteId: undefined,
        gen: 0,
        provision: undefined,
        broadcast: [],
        connectedAt: 0,
        cfg: s.type === 'ap' ? defaultApCfg() : undefined,
        ssh: undefined, // {enable, port} as last provisioned
        account: undefined, // site device account as last provisioned
      },
    ]),
  );
  logs = [];
}
reset();

/** Per-AP settings, shaped like the controller's ApDetailVO. */
function defaultApCfg() {
  return {
    ledSetting: 2,
    lldpEnable: 2,
    loopbackDetectEnable: false,
    ipSetting: { mode: 'dhcp', fallback: true, fallbackIp: '192.168.0.254', fallbackMask: '255.255.255.0', fallbackGate: '192.168.0.1' },
    radioSetting2g: { radioEnable: true, channelWidth: '4', channel: '0', txPowerLevel: 4, txPower: 20, channelLimitEnable: false },
    radioSetting5g: { radioEnable: true, channelWidth: '6', channel: '0', txPowerLevel: 4, txPower: 23, channelLimitEnable: false },
    deviceMisc: { support2g: true, support5g: true, support5g2: false, support6g: false },
  };
}
const RADIO_OF_BAND = { '2.4 GHz': 'radioSetting2g', '5 GHz': 'radioSetting5g' };
// Same shape as the controller's channelInfo: radioSetting.channel stores
// `value` (an index), not the channel number `channelValue`; the label is
// channelName "36 / 5180MHz". Indexes deliberately differ from channel
// numbers so mixing the two up shows.
// widthFlag bits as the controller sends them: 20 MHz 65536, 40 MHz
// 131072|262144, and base 256 plus 80 MHz 8388608 / 160 MHz 16777216.
const W20 = 65536, W40 = 131072 | 262144, W80 = 256 | 8388608, W160 = 256 | 16777216;
const channelEntry = (c, i, freq, widthFlag) => ({ value: i + 1, channelValue: c, channelName: `${c} / ${freq}MHz`, freq, widthFlag });
const CHANNELS = {
  0: Array.from({ length: 13 }, (_, i) => channelEntry(i + 1, i + 100, 2412 + 5 * i, W20 | W40)),
  // 36–128 sit in 160 MHz blocks; 132–140 reach only 80 MHz.
  1: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140].map((c, i) =>
    channelEntry(c, i, 5000 + 5 * c, W20 | W40 | W80 | (c <= 128 ? W160 : 0)),
  ),
};
/** Channel number for a radioSetting.channel value; auto ("0") settles on the first channel. */
const channelNumber = (radioId, value) =>
  value === '0' || value === undefined ? CHANNELS[radioId][0].channelValue : CHANNELS[radioId].find((c) => String(c.value) === String(value))?.channelValue;
const WIDTHS = { radioSetting2g: ['2', '3', '4'], radioSetting5g: ['2', '3', '5', '6', '7'] };
const WIDTH_TEXT = { 2: '20 MHz', 3: '40 MHz', 4: '20/40 MHz', 5: '80 MHz', 6: '20/40/80 MHz', 7: '160 MHz' };
const POWER_TEXT = { 0: 'low', 1: 'medium', 2: 'high', 4: 'auto' };
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function log(d, kind, level, key, text) {
  logs.unshift({
    id: `sim-${++logSeq}`,
    kind, // 'events' | 'alerts'
    siteId: d?.siteId ?? d?.lastSiteId,
    module: 'Device',
    key,
    level,
    content: `[Simulated] ${text}`,
    time: Date.now(),
    archived: false,
  });
  console.log(`${new Date().toISOString().slice(11, 19)}  ${kind === 'alerts' ? 'ALERT' : 'event'}  ${text}`);
}

function setStatus(d, status) {
  d.status = status;
  console.log(`${new Date().toISOString().slice(11, 19)}  ${d.name.padEnd(20)} → ${status} ${Object.keys(ST).find((k) => ST[k] === status) ?? ''}`);
}

/** Run steps one after another, abandoning them if a newer transition starts. */
function sequence(d, steps) {
  const gen = ++d.gen;
  let chain = Promise.resolve();
  for (const step of steps) {
    chain = chain.then(async () => {
      if (d.gen !== gen) return;
      await step();
    });
  }
  return chain.catch((e) => console.error('sim step failed', e));
}
const wait = (ms = STEP) => new Promise((r) => setTimeout(r, ms));

// ── upstream access ───────────────────────────────────────────────────────

function forward(req, body, pathOverride) {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers };
    delete headers['content-length'];
    delete headers['accept-encoding']; // keep JSON readable for overlays
    headers.host = UPSTREAM.host;
    if (body?.length) headers['content-length'] = String(body.length);
    const up = https.request(
      {
        protocol: UPSTREAM.protocol,
        hostname: UPSTREAM.hostname,
        port: UPSTREAM.port,
        method: req.method,
        path: pathOverride,
        headers,
        rejectUnauthorized: false, // the controller's certificate is self-signed
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    up.on('error', reject);
    if (body?.length) up.write(body);
    up.end();
  });
}

/** GET a controller path with the auth the browser sent on the triggering request. */
async function upstreamJson(auth, apiPath, params = {}) {
  const qs = new URLSearchParams({ ...params, ...(auth.token ? { token: auth.token } : {}) });
  const res = await forward(
    { method: 'GET', headers: { cookie: auth.cookie ?? '', 'csrf-token': auth.token ?? '', accept: 'application/json' } },
    undefined,
    `/${auth.omadacId}/api/v2/${apiPath}?${qs}`,
  );
  const json = JSON.parse(res.body.toString('utf8'));
  if (json.errorCode !== 0) throw new Error(`${apiPath}: ${json.errorCode} ${json.msg}`);
  return json.result;
}

// ── what a device "receives" when it is provisioned ──────────────────────

const BAND_BITS = { 1: '2.4 GHz', 2: '5 GHz', 4: '6 GHz' };

/** The controller returns lists as [], {data:[]} or {table:{data:[]}}. */
const asList = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : Array.isArray(r?.table?.data) ? r.table.data : []);

// How an AP reads a stored SSID: the effective per-SSID wireless config it
// applies (security suite, PMF, 802.11r, VLAN, resolved rate limits, schedule,
// minimum rates, multicast handling, MAC filter). Built only from the stored
// document — so two editors that store the same SSID provision the same AP.
const PSK_SUITE = { 1: 'WPA-PSK', 2: 'WPA2-PSK', 3: 'WPA/WPA2-PSK', 4: 'WPA2-PSK/WPA3-SAE' };
const ENT_SUITE = { 1: 'WPA-Enterprise', 2: 'WPA2-Enterprise', 3: 'WPA/WPA2-Enterprise', 4: 'WPA3-Enterprise' };
const CIPHER = { 1: 'Auto', 3: 'AES', 4: 'AES-GCM 256', 5: 'AES-CNSA' };
const PMF_TEXT = { 1: 'mandatory', 2: 'capable', 3: 'off' };
const UNIT_TEXT = ['Kbps', 'Mbps'];

function resolveLimit(l, profiles) {
  const src = l?.rateLimitId ? profiles.find((p) => p.id === l.rateLimitId) ?? {} : l ?? {};
  return {
    profile: l?.rateLimitId ? (profiles.find((p) => p.id === l.rateLimitId)?.name ?? l.rateLimitId) : 'custom',
    down: src.downLimitEnable ? `${src.downLimit} ${UNIT_TEXT[src.downLimitType ?? 0]}` : null,
    up: src.upLimitEnable ? `${src.upLimit} ${UNIT_TEXT[src.upLimitType ?? 0]}` : null,
  };
}

function wlanConfigFor(s, apBands, profiles) {
  const bands = Object.entries(BAND_BITS).filter(([bit, label]) => s.band & Number(bit) && apBands.includes(label)).map(([, l]) => l);
  const only6 = s.band === 4;
  let security;
  if (s.security === 0) security = s.oweEnable ? 'OWE' : only6 ? 'Enhanced Open' : 'Open';
  else if (s.security === 2) security = `${ENT_SUITE[s.wpaSetting?.versionEnt]} ${CIPHER[s.wpaSetting?.encryptionEnt]}`;
  else {
    const v = s.pskSetting?.versionPsk;
    security = `${v === 4 && (only6 || s.mloEnable) ? 'WPA3-SAE' : PSK_SUITE[v]} ${CIPHER[s.pskSetting?.encryptionPsk]}`;
    if (s.security === 4) security += ' (PPSK)';
    if (s.security === 5) security += ' (PPSK + RADIUS)';
  }
  const rekey = s.pskSetting?.gikRekeyPskEnable ?? s.wpaSetting?.gikRekeyEnable;
  const vlan = s.vlanSetting?.mode === 1 ? (s.vlanSetting.customConfig?.vlanId ?? s.vlanSetting.currentVlanId ?? 'network') : null;
  const rc = s.rateAndBeaconCtrl ?? {};
  const mc = s.multiCastSetting ?? {};
  return {
    ssid: s.name,
    bands,
    hidden: !s.broadcast,
    guest: Boolean(s.guestNetEnable),
    security,
    pmf: s.security === 0 ? null : PMF_TEXT[s.pmfMode] ?? String(s.pmfMode),
    fastRoaming: Boolean(s.enable11r),
    mlo: Boolean(s.mloEnable),
    groupRekey: rekey ? `${(s.pskSetting ?? {}).rekeyPskInterval ?? s.wpaSetting?.rekeyInterval} ${['s', 'min', 'h'][(s.pskSetting ?? {}).intervalPskType ?? s.wpaSetting?.intervalType ?? 0]}` : null,
    vlan,
    clientLimit: resolveLimit(s.rateLimit, profiles),
    ssidLimit: resolveLimit(s.ssidRateLimit, profiles),
    schedule: s.wlanScheduleEnable ? { radio: s.action ? 'on' : 'off', timeRange: s.scheduleId } : null,
    minRate: {
      '2.4 GHz': rc.rate2gCtrlEnable ? `${rc.lowerDensity2g} Mbps${rc.cckRatesDisable ? ', no CCK' : ''}` : null,
      '5 GHz': rc.rate5gCtrlEnable ? `${rc.lowerDensity5g} Mbps` : null,
      '6 GHz': rc.rate6gCtrlEnable ? `${rc.lowerDensity6g} Mbps` : null,
    },
    multicast: {
      toUnicastV4: Boolean(mc.multiCastEnable),
      toUnicastV6: Boolean(mc.ipv6CastEnable),
      channelUtil: mc.channelUtil ?? null,
      arpToUnicast: Boolean(mc.arpCastEnable),
      filter: mc.filterEnable ? mc.filterMode ?? 0 : null,
    },
    macFilter: s.macFilterEnable ? { policy: s.policy === 1 ? 'allow' : 'deny', group: s.macFilterId ?? null } : null,
  };
}

function wlanSummary(w) {
  const lim = (l) => [l.down && `↓${l.down}`, l.up && `↑${l.up}`].filter(Boolean).join(' ') || 'no limit';
  return [
    `SSID ${w.ssid}: ${w.security}`,
    w.pmf && `PMF ${w.pmf}`,
    w.bands.join('+') || 'no band on this AP',
    w.hidden && 'hidden',
    w.guest && 'guest',
    w.fastRoaming && '802.11r',
    w.mlo && 'MLO',
    w.vlan && `VLAN ${w.vlan}`,
    `client ${lim(w.clientLimit)}`,
    w.schedule && `schedule radio ${w.schedule.radio}`,
    w.macFilter && `MAC ${w.macFilter.policy} list`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function bssidFor(mac, n) {
  const parts = mac.split('-');
  parts[0] = '06'; // locally administered, distinct from the device MAC
  parts[5] = ((parseInt(parts[5], 16) + n) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  return parts.join('-');
}

async function pullConfig(d, auth, reason, request) {
  const items = [];
  try {
    if (d.type === 'ap') {
      const groups = await upstreamJson(auth, `sites/${d.siteId}/setting/wlans`);
      const all = asList(groups);
      const group = all.find((g) => g.id === d.wlanId) ?? all.find((g) => g.primary) ?? all[0];
      d.wlanGroup = group?.name;
      d.wlanId = group?.id;
      const stored = group
        ? asList(await upstreamJson(auth, `sites/${d.siteId}/setting/wlans/${group.id}/ssids`, { currentPage: 1, currentPageSize: 100 }))
        : [];
      // deviceType bit 1 = access points (missing → both). Gateway-only SSIDs never reach an AP.
      const ssids = stored.filter((s) => s.deviceType === undefined || s.deviceType & 1);
      const profiles = asList(await upstreamJson(auth, `sites/${d.siteId}/setting/profiles/rateLimits`).catch(() => []));
      d.wlans = ssids.map((s) => wlanConfigFor(s, d.bands, profiles));
      let n = 0;
      d.broadcast = [];
      const radioOn = (label) => d.cfg?.[RADIO_OF_BAND[label]]?.radioEnable !== false;
      for (const s of ssids) {
        for (const [bit, label] of Object.entries(BAND_BITS)) {
          if (s.band & Number(bit) && d.bands.includes(label) && radioOn(label)) {
            d.broadcast.push({ ssid: s.name, band: label, bssid: bssidFor(d.mac, ++n) });
          }
        }
      }
      items.push(`WLAN group ${d.wlanGroup ?? '—'}`, ...d.wlans.map(wlanSummary));
      for (const label of d.bands) {
        const r = d.cfg[RADIO_OF_BAND[label]];
        items.push(
          r.radioEnable === false
            ? `${label} off`
            : `${label} ch ${r.channel === '0' ? 'auto' : channelNumber(label === '2.4 GHz' ? 0 : 1, r.channel)} ·${WIDTH_TEXT[r.channelWidth] ?? r.channelWidth} · ${r.txPowerLevel === 3 ? `${r.txPower} dBm` : POWER_TEXT[r.txPowerLevel]}`,
        );
      }
      items.push(d.cfg.ipSetting.mode === 'static' ? `Static IP ${d.cfg.ipSetting.configIp}` : 'IP by DHCP');
      const rf = await upstreamJson(auth, `sites/${d.siteId}/rfPlanning`).catch(() => undefined);
      if (rf) items.push(`Auto channel ${rf.channelDeployEnable ? 'on' : 'off'}`);
    } else {
      const lan = await upstreamJson(auth, `sites/${d.siteId}/setting/lan/networks`, { currentPage: 1, currentPageSize: 100 });
      items.push(...asList(lan).map((nw) => `Network ${nw.name} (VLAN ${nw.vlan ?? 1})`));
      const profiles = await upstreamJson(auth, `sites/${d.siteId}/setting/lan/profiles`, { currentPage: 1, currentPageSize: 100 });
      items.push(`${asList(profiles).length} port profiles`);
    }
    const site = await upstreamJson(auth, `sites/${d.siteId}/setting`).catch(() => undefined);
    // A device-level LED/LLDP choice (0 off · 1 on) overrides the site's (2).
    const own = (v) => (v === 0 ? false : v === 1 ? true : undefined);
    const led = own(d.cfg?.ledSetting) ?? site?.led?.enable;
    const lldp = own(d.cfg?.lldpEnable) ?? site?.lldp?.enable;
    if (led !== undefined) items.push(`LED ${led ? 'on' : 'off'}${own(d.cfg?.ledSetting) === undefined ? '' : ' (device)'}`);
    if (lldp !== undefined) items.push(`LLDP ${lldp ? 'on' : 'off'}${own(d.cfg?.lldpEnable) === undefined ? '' : ' (device)'}`);
    d.account = site?.deviceAccount ? { username: site.deviceAccount.username, password: site.deviceAccount.password } : d.account;
    const ssh = await upstreamJson(auth, `sites/${d.siteId}/setting/ssh`).catch(() => undefined);
    if (ssh) {
      d.ssh = { enable: Boolean(ssh.sshEnable), port: ssh.sshServerPort };
      items.push(`SSH ${ssh.sshEnable ? 'on' : 'off'}`);
    }
    d.lastAuth = auth;
  } catch (e) {
    items.push(`(could not read config: ${e.message})`);
  }
  d.provision = { at: Date.now(), reason, request, items };
}

// ── device life cycle ─────────────────────────────────────────────────────

function adopt(d, siteId, auth) {
  if (![ST.PENDING, ST.ADOPT_FAILED].includes(d.status)) return;
  d.lastSiteId = siteId;
  sequence(d, [
    () => {
      setStatus(d, ST.ADOPTING);
      log(d, 'events', 'Information', 'SIM_ADOPTING', `${d.name} (${d.mac}) is being adopted.`);
    },
    () => wait(),
    async () => {
      if (d.fault) {
        setStatus(d, ST.ADOPT_FAILED);
        // A login failure: not -1, so the UI asks for the device's username and
        // password on retry (vendor isAdoptFactoryAp: -1 means no login needed).
        d.adoptFailType = 1;
        log(d, 'alerts', 'Warning', 'SIM_ADOPT_FAILED', `${d.name} (${d.mac}) failed to be adopted: ${d.fault}.`);
        d.gen++; // stop here
        return;
      }
      d.siteId = siteId;
      setStatus(d, ST.PROVISIONING);
      await pullConfig(d, auth, 'Adoption');
      log(d, 'events', 'Information', 'SIM_PROVISIONING', `${d.name} was adopted and is being provisioned.`);
    },
    () => wait(),
    () => {
      d.connectedAt = Date.now();
      setStatus(d, ST.CONNECTED);
      log(d, 'events', 'Information', 'SIM_CONNECTED', `${d.name} is connected (${d.provision?.items.length ?? 0} settings applied).`);
    },
  ]);
}

function reconfigure(d, auth, reason, request) {
  sequence(d, [
    async () => {
      setStatus(d, ST.CONFIGURING);
      log(d, 'events', 'Information', 'SIM_CONFIGURING', `${d.name} is being configured: ${reason}.`);
      await pullConfig(d, auth, reason, request);
    },
    () => wait(),
    () => {
      setStatus(d, ST.CONNECTED);
      log(d, 'events', 'Information', 'SIM_CONFIGURED', `${d.name} applied the new configuration.`);
    },
  ]);
}

function forceProvision(d, auth) {
  sequence(d, [
    async () => {
      setStatus(d, ST.PROVISIONING);
      await pullConfig(d, auth, 'Force provision');
      log(d, 'events', 'Information', 'SIM_FORCE_PROVISION', `${d.name} is being force-provisioned.`);
    },
    () => wait(),
    () => {
      setStatus(d, ST.CONNECTED);
      log(d, 'events', 'Information', 'SIM_CONNECTED', `${d.name} finished provisioning.`);
    },
  ]);
}

// ── configuration results (Devices → Configuration Results) ──
// Status values of the vendor page: 2 failed, 3 incompatible ("alert"),
// 4 configuring, 5 preconfigure. Every adopted simulated AP has two settings
// its firmware can't run; the switch failed to apply a VLAN until "Apply
// again" (config/fullSync); a disconnected device has a pending
// (preconfigure) change. Answered here alone: real devices' results aren't merged.
const CFG = { FAIL: 2, ALERT: 3, CONFIGURING: 4, PRECONFIG: 5 };
const CFG_SINCE = Date.now();

function configFeatures(d) {
  const out = [];
  if (d.type === 'ap') {
    out.push(
      {
        status: CFG.ALERT,
        feature: 'ap_ssid',
        languageKey: 'MENU.WLAN',
        uiPosition: 'WLAN',
        expandable: true,
        featureItemSum: 1,
        components: [{ component: 'ap_ssid_5G', name: 'SIM-PPSK-Guests', subEntryLimit: 16 }],
      },
      {
        status: CFG.ALERT,
        feature: 'ap_ledSchedule',
        languageKey: 'SITE_SETTINGS.LED_SCHEDULE',
        uiPosition: 'SITE_SETTINGS-LED',
        unsupportCaps: ['LED schedule'],
      },
    );
  }
  if (d.type === 'switch' && !d.configSynced) {
    out.push({
      status: CFG.FAIL,
      feature: 'osw_vlan',
      languageKey: 'SWITCH_SETTINGS.VLAN_INTERFACE',
      uiPosition: 'WIRED_NETWORKS-LAN',
      expandable: true,
      featureItemSum: 1,
      operationList: [3],
      timeList: [CFG_SINCE],
      uiErrorCodeList: ['osw_-6'],
      components: [{ component: 'osw_vlan', name: 'VLAN 20', operation: 3, time: CFG_SINCE, uiErrorCode: 'osw_-6' }],
    });
  }
  if (categoryOf(d.status) !== 1) {
    out.push({
      status: CFG.PRECONFIG,
      feature: `${d.type}_general`,
      languageKey: 'DEVICE.GENERAL_CONFIG',
      operationList: [3],
      timeList: [CFG_SINCE],
    });
  }
  return out;
}

const cfgInt = (q, k) => (/^\d+$/.test(q.get(k) ?? '') ? Number(q.get(k)) : undefined);
const cfgStatus = (q) => {
  const v = cfgInt(q, 'status');
  return Object.values(CFG).includes(v) ? v : undefined;
};
const configRow = (d) => ({
  mac: d.mac,
  name: d.name,
  type: d.type,
  model: d.model,
  modelVersion: d.hwVersion,
  needFullSync: d.type === 'switch' && !d.configSynced,
  supportConfigSync: true,
  supportRunningConfig: d.type === 'switch',
});

/** GET config-result handlers; undefined when the path isn't one of them. */
function configResult(api, q) {
  const bad = { errorCode: -1001, msg: '[Simulated] Invalid request parameters.' };
  const grid = api.match(/^sites\/([^/]+)\/config-result\/devices$/);
  if (grid) {
    // The vendor page sends currentPage/currentPageSize/status (+ filters.deviceType, name, mac).
    const page = cfgInt(q, 'currentPage');
    const size = cfgInt(q, 'currentPageSize');
    const status = cfgStatus(q);
    const type = q.get('filters.deviceType');
    if (!page || !size || !status || q.has('pageSize') || (type !== null && !['1,2', '3'].includes(type))) return bad;
    const ofType = (d) => (type === '3' ? d.type === 'ap' : type === '1,2' ? d.type !== 'ap' : true);
    const has = (d, st) => configFeatures(d).some((f) => f.status === st);
    const name = q.get('name')?.toLowerCase();
    const mac = q.get('mac')?.toUpperCase();
    const all = adoptedIn(grid[1]);
    const rows = all
      .filter((d) => ofType(d) && has(d, status))
      .filter((d) => (!name || d.name.toLowerCase().includes(name)) && (!mac || d.mac.includes(mac)));
    const inType = all.filter(ofType);
    const inStatus = all.filter((d) => has(d, status));
    return ok({
      currentPage: page,
      currentSize: size,
      totalRows: rows.length,
      onlyNotificationData: false,
      statistic: {
        all: inStatus.length,
        osgAndOsw: inStatus.filter((d) => d.type !== 'ap').length,
        ap: inStatus.filter((d) => d.type === 'ap').length,
        fail: inType.filter((d) => has(d, CFG.FAIL)).length,
        alert: inType.filter((d) => has(d, CFG.ALERT)).length,
        configuring: 0,
        preConfig: inType.filter((d) => has(d, CFG.PRECONFIG)).length,
      },
      data: rows.slice((page - 1) * size, page * size).map(configRow),
    });
  }
  const feat = api.match(/^sites\/([^/]+)\/config-result\/device\/([0-9A-F-]{17})\/feature$/);
  if (feat && devices.has(feat[2])) {
    const status = cfgStatus(q);
    if (!status) return bad;
    const list = configFeatures(devices.get(feat[2]))
      .filter((f) => f.status === status)
      .map(({ status: _s, components: _c, ...f }) => f);
    return ok({ deviceFunctionList: list });
  }
  const comp = api.match(/^sites\/([^/]+)\/config-result\/devices\/([0-9A-F-]{17})\/feature\/grid$/);
  if (comp && devices.has(comp[2])) {
    const page = cfgInt(q, 'currentPage');
    const size = cfgInt(q, 'currentPageSize');
    const status = cfgStatus(q);
    const feature = q.get('feature');
    if (!page || !size || !status || !feature) return bad;
    const f = configFeatures(devices.get(comp[2])).find((x) => x.status === status && x.feature === feature);
    const rows = f?.components ?? [];
    return ok({ currentPage: page, currentSize: size, totalRows: rows.length, data: rows.slice((page - 1) * size, page * size) });
  }
  return undefined;
}

function reboot(d, auth) {
  sequence(d, [
    () => {
      setStatus(d, ST.REBOOTING);
      log(d, 'events', 'Information', 'SIM_REBOOT', `${d.name} is rebooting.`);
    },
    () => wait(),
    () => {
      setStatus(d, ST.DISCONNECTED);
      d.connectedAt = 0;
    },
    () => wait(),
    async () => {
      setStatus(d, ST.PROVISIONING);
      await pullConfig(d, auth, 'Reconnected after reboot');
    },
    () => wait(),
    () => {
      d.connectedAt = Date.now();
      setStatus(d, ST.CONNECTED);
      log(d, 'events', 'Information', 'SIM_CONNECTED', `${d.name} reconnected after reboot.`);
    },
  ]);
}

function forget(d) {
  sequence(d, [
    () => {
      log(d, 'events', 'Information', 'SIM_FORGET', `${d.name} was forgotten and is resetting to factory defaults.`);
      d.siteId = undefined;
      d.provision = undefined;
      d.broadcast = [];
      d.wlanGroup = undefined;
      d.connectedAt = 0;
      setStatus(d, ST.DISCONNECTED);
    },
    () => wait(),
    () => setStatus(d, ST.PENDING),
  ]);
}

function upgrade(d, auth, version, source) {
  sequence(d, [
    () => {
      setStatus(d, ST.UPGRADING);
      log(d, 'events', 'Information', 'SIM_UPGRADING', `${d.name} is upgrading to firmware ${version} (${source}).`);
    },
    () => wait(STEP * 2),
    () => {
      d.firmwareVersion = version;
      setStatus(d, ST.REBOOTING);
    },
    () => wait(),
    () => {
      setStatus(d, ST.DISCONNECTED);
      d.connectedAt = 0;
    },
    () => wait(),
    async () => {
      setStatus(d, ST.PROVISIONING);
      await pullConfig(d, auth, `Reconnected after upgrading to ${version}`);
    },
    () => wait(),
    () => {
      d.connectedAt = Date.now();
      setStatus(d, ST.CONNECTED);
      log(d, 'events', 'Information', 'SIM_UPGRADED', `${d.name} was upgraded to firmware ${version}.`);
    },
  ]);
}

// Which simulated device types a settings write reaches. Gateway-only
// features (UPnP, mDNS, portals, firewall, VPN…) reach none — there is no
// simulated gateway.
const AP_KEYS = ['roaming', 'mesh', 'bandSteeringForMultiBand', 'bandSteering', 'airtimeFairness', 'beaconControl', 'channelLimit', 'advancedFeature'];
function affectedTypes(resource, body) {
  if (/^(setting\/(wlans|ssids|macAuth)|rfPlanning)/.test(resource)) return ['ap'];
  if (/^setting\/(dot1x|lan\/)/.test(resource)) return ['switch'];
  if (/^setting\/(snmp|ssh)$/.test(resource)) return ['ap', 'switch'];
  if (resource === 'setting') {
    const keys = Object.keys(body ?? {});
    const types = new Set();
    for (const k of keys) {
      if (AP_KEYS.includes(k)) types.add('ap');
      else if (k === 'lldp') ['ap', 'switch'].forEach((t) => types.add(t));
      else ['ap', 'switch'].forEach((t) => types.add(t)); // led, remoteLog, site, …
    }
    return [...types];
  }
  return [];
}

/** Plain-language reason shown on the device page and in the event log. */
function describeWrite(method, resource, body) {
  const verb = { POST: 'added', DELETE: 'removed' }[method] ?? 'changed';
  if (/^setting\/wlans\/[^/]+\/ssids/.test(resource)) return `Wireless network ${body?.name ? `"${body.name}" ` : ''}${verb}`;
  if (/^setting\/wlans/.test(resource)) return `WLAN group ${verb}`;
  if (/^rfPlanning/.test(resource)) return 'RF planning changed';
  if (resource === 'setting') return `Site settings changed (${Object.keys(body ?? {}).join(', ') || 'general'})`;
  return `${resource.replace(/^setting\//, '')} ${verb}`;
}

// ── JSON views ────────────────────────────────────────────────────────────

function uptimeFields(s) {
  const d = Math.floor(s / 86400);
  const text = `${d ? `${d}day(s) ` : ''}${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  return { uptime: text, uptimeLong: s };
}

/**
 * Live fields the controller's detail VOs carry for a connected device
 * (ApDetailVO wp2g/wp5g, radioTraffic2g/5g, lanTraffic, wiredUplink, cpu/mem), so the
 * dashboard's Details tab has the same data to show as on real hardware.
 */
function liveDetail(d) {
  const secs = d.connectedAt ? Math.round((Date.now() - d.connectedAt) / 1000) : 0;
  const traffic = (k) => ({
    rxPkts: 1200 * k + secs, rx: 1_500_000 * k + secs * 900, rxDropPkts: k, rxErrPkts: 0,
    txPkts: 900 * k + secs, tx: 2_100_000 * k + secs * 1200, txDropPkts: 0, txErrPkts: 0,
  });
  const out = { cpuUtil: 3, memUtil: 41, publicIp: d.ip, ipv6List: [] };
  const uplink = [...devices.values()].find((x) => x.type === 'switch' && x.siteId === d.siteId && x !== d);
  if (d.type !== 'switch') {
    out.wiredUplink = {
      uplinkMac: uplink?.mac, name: uplink?.name ?? 'Upstream switch', type: 'switch', duplex: 2, rate: '1000', // a string on real controllers
      upPackets: 900 + secs, upBytes: 2_000_000 + secs * 1200, downPackets: 1200 + secs, downBytes: 1_400_000 + secs * 900, activity: 1450,
    };
  }
  if (d.type === 'ap') {
    out.lanTraffic = traffic(3);
    for (const label of d.bands) {
      const b = label === '2.4 GHz' ? '2g' : '5g';
      const r = d.cfg[RADIO_OF_BAND[label]];
      if (r.radioEnable === false) continue;
      const radioId = b === '2g' ? 0 : 1;
      const num = channelNumber(radioId, r.channel);
      const freq = CHANNELS[radioId].find((c) => c.channelValue === num)?.freq;
      out[`wp${b}`] = {
        actualChannel: `${num} / ${freq}MHz`,
        rdMode: b === '2g' ? 'b/g/n/ax mixed' : 'a/n/ac/ax mixed',
        bandWidth: { 2: '20MHz', 3: '40MHz', 4: '20MHz', 5: '80MHz', 6: '80MHz' }[r.channelWidth] ?? '20MHz',
        txPower: r.txPowerLevel === 3 ? r.txPower : b === '2g' ? 20 : 23,
        rxUtil: b === '2g' ? 9 : 2, txUtil: b === '2g' ? 4 : 1, interUtil: b === '2g' ? 14 : 0,
      };
      out[`radioTraffic${b}`] = traffic(b === '2g' ? 1 : 2);
    }
  }
  return out;
}

function row(d) {
  const connected = categoryOf(d.status) === 1;
  return {
    type: d.type,
    mac: d.mac,
    name: d.name,
    model: d.model,
    showModel: d.showModel,
    compoundModel: d.showModel,
    firmwareVersion: d.firmwareVersion,
    version: d.firmwareVersion,
    hwVersion: d.hwVersion,
    ip: d.ip,
    status: d.status,
    statusCategory: categoryOf(d.status),
    locateEnable: connected && Boolean(d.locateEnable),
    adoptFailType: d.status === ST.ADOPT_FAILED ? d.adoptFailType : undefined,
    site: d.siteId,
    // Same shape as the controller: display string + seconds in uptimeLong.
    ...(connected && d.connectedAt ? uptimeFields(Math.round((Date.now() - d.connectedAt) / 1000)) : {}),
    lastSeen: Date.now(),
    clientNum: 0,
    wlanGroup: d.type === 'ap' ? d.wlanGroup : undefined,
    bssids: d.type === 'ap' ? d.broadcast.map((b) => b.bssid) : undefined,
    simBroadcast: d.type === 'ap' ? d.broadcast : undefined,
    simWlans: d.type === 'ap' ? d.wlans : undefined,
    provision: d.provision,
    needUpgrade: Boolean(d.latestFw && d.latestFw !== d.firmwareVersion),
    latestVersion: d.latestFw,
    ...(connected ? liveDetail(d) : {}),
    simulated: true,
  };
}

const isPendingSide = (d) => categoryOf(d.status) === 2;
const adoptedIn = (siteId) => [...devices.values()].filter((d) => d.siteId && (!siteId || d.siteId === siteId) && !isPendingSide(d));

// ── HTTP plumbing ─────────────────────────────────────────────────────────

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json;charset=UTF-8', 'content-length': body.length });
  res.end(body);
}

function relay(res, up, bodyOverride) {
  const headers = { ...up.headers };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  delete headers['content-encoding'];
  if (headers['set-cookie']) {
    // Same as nginx.conf: the controller marks its session cookie Secure, but
    // this origin is plain http.
    headers['set-cookie'] = [].concat(headers['set-cookie']).map((c) => c.replace(/;\s*Secure/gi, ''));
  }
  const body = bodyOverride ?? up.body;
  headers['content-length'] = String(body.length);
  res.writeHead(up.status, headers);
  res.end(body);
}

/** Minimal multipart/form-data parser: [{name, filename?, data: Buffer}]. */
function multipartParts(body, contentType = '') {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundary) return [];
  const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = [];
  let at = body.indexOf(sep);
  while (at !== -1) {
    const start = at + sep.length;
    const next = body.indexOf(sep, start);
    if (next === -1) break;
    const chunk = body.subarray(start + 2, next - 2); // drop CRLF after the boundary and before the next
    const split = chunk.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = chunk.subarray(0, split).toString('latin1');
      parts.push({
        name: head.match(/name="([^"]*)"/)?.[1],
        filename: head.match(/filename="([^"]*)"/)?.[1],
        data: chunk.subarray(split + 4),
      });
    }
    at = next;
  }
  return parts;
}

const ok = (result) => ({ errorCode: 0, msg: 'Success.', ...(result === undefined ? {} : { result }) });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end(`No build found in ${DIST} — run "npm run build" first.`);
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

function inWindow(entry, q, kind) {
  if (entry.kind !== kind) return false;
  const start = Number(q.get('filters.timeStart') ?? 0);
  const end = Number(q.get('filters.timeEnd') ?? Infinity);
  if (entry.time < start || entry.time > end) return false;
  if (q.get('filters.level') && q.get('filters.level') !== entry.level) return false;
  if (q.get('filters.module') && q.get('filters.module') !== entry.module) return false;
  if (q.get('filters.archived') === 'true' && !entry.archived) return false;
  // logs/alerts filters on resolved (the simulator never resolves alerts).
  if (q.get('filters.resolved') === 'true') return false;
  const key = q.get('searchKey');
  if (key && !entry.content.toLowerCase().includes(key.toLowerCase())) return false;
  return true;
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const upstreamPath = url.pathname.replace(/^\/controller-api/, '') + url.search;
  const m = url.pathname.match(/^\/controller-api\/([0-9a-f]{32})\/api\/v2\/(.*)$/);
  const body = await readBody(req);
  const auth = {
    omadacId: m?.[1],
    cookie: req.headers.cookie,
    token: req.headers['csrf-token'] ?? url.searchParams.get('token') ?? undefined,
  };
  const api = m?.[2] ?? '';
  const method = req.method ?? 'GET';
  let json;
  try {
    json = body.length ? JSON.parse(body.toString('utf8')) : undefined;
  } catch {
    json = undefined;
  }

  // ── commands answered by the simulator ──
  const cmd = api.match(/^sites\/([^/]+)\/cmd\/devices\/([0-9A-F-]{17})\/(forget|reboot|locate|forceProvision)$/);
  if (method === 'POST' && cmd && devices.has(cmd[2])) {
    const d = devices.get(cmd[2]);
    if (cmd[3] === 'forget') {
      // Vendor body is {mac}.
      if (json?.mac !== d.mac) return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] Invalid request parameters.' });
      forget(d);
    }
    else if (categoryOf(d.status) !== 1) return sendJson(res, 200, { errorCode: -39002, msg: '[Simulated] The device is not connected.' });
    else if (cmd[3] === 'reboot') reboot(d, auth);
    else if (cmd[3] === 'forceProvision') forceProvision(d, auth);
    else {
      // The real controller needs {locateEnable: boolean} (found 2026-11-15: an
      // empty body fails); it answers with the updated device.
      if (typeof json?.locateEnable !== 'boolean') return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] Invalid request parameters.' });
      d.locateEnable = json.locateEnable;
      log(d, 'events', 'Information', 'SIM_LOCATE', `${d.name} ${d.locateEnable ? 'is flashing' : 'stopped flashing'} its LED.`);
      return sendJson(res, 200, ok(row(d)));
    }
    return sendJson(res, 200, ok());
  }

  // Adoption, with the vendor UI's bodies (found 2026-11-15; {macList} was
  // never accepted by a real controller):
  //   cmd/devices/adopt      {mac, username?, password?}
  //   cmd/devices/batchAdopt {macs, deviceSeriesType, username?, password?}
  // A device that is not on factory settings (managed by others, or failed on
  // its login) needs username + password, as the vendor UI asks for them.
  const adoptCmd = api.match(/^sites\/([^/]+)\/cmd\/devices\/(adopt|batchAdopt)$/);
  if (method === 'POST' && adoptCmd) {
    const macs = adoptCmd[2] === 'adopt' ? (typeof json?.mac === 'string' ? [json.mac] : null) : Array.isArray(json?.macs) ? json.macs : null;
    if (!macs) return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] Invalid request parameters.' });
    const sim = macs.filter((mac) => devices.has(mac));
    if (sim.length) {
      // The right device login clears a login fault.
      for (const mac of sim) {
        const d = devices.get(mac);
        if (d.fault && d.login && json.username === d.login.username && json.password === d.login.password) d.fault = undefined;
      }
      // One device with a wrong or missing login: refused at once, the way the
      // user's NAS controller answered (2026-11-15). A batch fails per device later.
      const one = adoptCmd[2] === 'adopt' && devices.get(sim[0]);
      if (one && one.fault && one.login && [ST.PENDING, ST.ADOPT_FAILED].includes(one.status)) {
        setStatus(one, ST.ADOPT_FAILED);
        one.adoptFailType = 1;
        log(one, 'alerts', 'Warning', 'SIM_ADOPT_FAILED', `${one.name} (${one.mac}) failed to be adopted: ${one.fault}.`);
        return sendJson(res, 200, {
          errorCode: -39003,
          msg: '[Simulated] Failed to adopt the device because the username or password is incorrect.',
          result: { mac: one.mac, status: one.status, statusCategory: categoryOf(one.status) },
        });
      }
      sim.forEach((mac) => adopt(devices.get(mac), adoptCmd[1], auth));
      const real = macs.filter((mac) => !devices.has(mac));
      if (!real.length) return sendJson(res, 200, ok());
      const rest = adoptCmd[2] === 'adopt' ? { ...json, mac: real[0] } : { ...json, macs: real };
      return relay(res, await forward(req, Buffer.from(JSON.stringify(rest)), upstreamPath));
    }
  }

  // ── configuration results ──
  if (method === 'GET' && api.includes('/config-result/')) {
    const r = configResult(api, url.searchParams);
    if (r) return sendJson(res, 200, r);
  }
  const fullSync = api.match(/^sites\/([^/]+)\/devices\/([0-9A-F-]{17})\/config\/fullSync$/);
  if (method === 'POST' && fullSync && devices.has(fullSync[2])) {
    const d = devices.get(fullSync[2]);
    if (categoryOf(d.status) !== 1) return sendJson(res, 200, { errorCode: -39002, msg: '[Simulated] The device is not connected.' });
    d.configSynced = true;
    forceProvision(d, auth);
    log(d, 'events', 'Information', 'SIM_FULL_SYNC', `${d.name} had its full configuration applied again.`);
    return sendJson(res, 200, ok());
  }

  // ── per-AP configuration (sites/{sid}/eaps/{mac}…) ──
  const eap = api.match(/^sites\/([^/]+)\/eaps\/([0-9A-F-]{17})(\/.*)?$/);
  if (eap && devices.has(eap[2])) {
    const d = devices.get(eap[2]);
    if (d.type !== 'ap' || !d.siteId) return sendJson(res, 200, { errorCode: -39001, msg: '[Simulated] This device is not an adopted access point.' });
    const rest = eap[3] ?? '';
    if (method === 'GET' && rest === '') return sendJson(res, 200, ok({ ...row(d), ...structuredClone(d.cfg), wlanId: d.wlanId }));
    if (method === 'GET' && rest === '/channelInfo') {
      return sendJson(res, 200, ok({ data: d.bands.map((b) => ({ radioId: b === '2.4 GHz' ? 0 : 1, channelList: CHANNELS[b === '2.4 GHz' ? 0 : 1] })) }));
    }
    const section = rest.match(/^\/config\/(general|radios|ip-settings|wlans|services)$/)?.[1];
    if (method === 'PUT' && section) {
      const bad = (msg) => sendJson(res, 200, { errorCode: -1001, msg: `[Simulated] ${msg}` });
      const body = json ?? {};
      let what;
      if (section === 'general') {
        const name = String(body.name ?? d.name).trim();
        if (!name || name.length > 128) return bad('Device name must be 1–128 characters.');
        if (![0, 1, 2].includes(body.ledSetting ?? d.cfg.ledSetting)) return bad('ledSetting must be 0, 1 or 2.');
        d.name = name;
        d.cfg.ledSetting = body.ledSetting ?? d.cfg.ledSetting;
        what = 'name/LED';
      } else if (section === 'radios') {
        const keys = Object.keys(body).filter((k) => k.startsWith('radioSetting'));
        if (keys.length !== 1 || !d.cfg[keys[0]]) return bad('Send exactly one supported radioSetting block.');
        const key = keys[0];
        const next = { ...d.cfg[key], ...body[key] };
        const radioId = key === 'radioSetting2g' ? 0 : 1;
        if (!WIDTHS[key].includes(String(next.channelWidth))) return bad(`channelWidth ${next.channelWidth} is not valid for this radio.`);
        if (next.channel !== '0' && !CHANNELS[radioId].some((c) => String(c.value) === String(next.channel))) return bad(`Channel ${next.channel} is not available.`);
        if (![0, 1, 2, 3, 4].includes(next.txPowerLevel)) return bad('txPowerLevel must be 0–4.');
        if (next.txPowerLevel === 3 && !(next.txPower >= 1 && next.txPower <= 30)) return bad('Custom power must be 1–30 dBm.');
        d.cfg[key] = next;
        what = `${key === 'radioSetting2g' ? '2.4 GHz' : '5 GHz'} radio`;
      } else if (section === 'ip-settings') {
        const ip = body.ipSetting ?? {};
        if (ip.mode === 'static') {
          for (const f of ['configIp', 'configMask', 'configGate']) if (!IPV4.test(ip[f] ?? '')) return bad(`${f} is not a valid IPv4 address.`);
          d.ip = ip.configIp;
        } else if (ip.mode !== 'dhcp') return bad('ipSetting.mode must be dhcp or static.');
        else d.ip = d.dhcpIp ?? SEEDS.find((x) => x.mac === d.mac).ip;
        d.cfg.ipSetting = ip;
        what = 'IP address';
      } else if (section === 'wlans') {
        if (!body.wlanId) return bad('wlanId is required.');
        d.wlanId = body.wlanId; // pullConfig checks it against the real controller
        what = 'WLAN group';
      } else {
        if (body.lldpEnable !== undefined && ![0, 1, 2].includes(body.lldpEnable)) return bad('lldpEnable must be 0, 1 or 2.');
        Object.assign(d.cfg, { lldpEnable: body.lldpEnable ?? d.cfg.lldpEnable, loopbackDetectEnable: body.loopbackDetectEnable ?? d.cfg.loopbackDetectEnable });
        what = 'services';
      }
      if (categoryOf(d.status) === 1) reconfigure(d, auth, `Device settings changed (${what})`, `PUT eaps/config/${section}`);
      else log(d, 'events', 'Information', 'SIM_CONFIG_QUEUED', `${d.name}: ${what} saved; it is applied when the device reconnects.`);
      return sendJson(res, 200, ok());
    }
  }

  // ── firmware ──
  const fw = api.match(/^sites\/([^/]+)\/devices\/([0-9A-F-]{17})\/(firmware|onlineUpgrade\/status|upgrade\/status)$/);
  if (method === 'GET' && fw && devices.has(fw[2])) {
    const d = devices.get(fw[2]);
    if (fw[3] === 'firmware') {
      const newer = d.latestFw && d.latestFw !== d.firmwareVersion;
      return sendJson(res, 200, ok({ curFwVer: d.firmwareVersion, lastFwVer: d.latestFw ?? d.firmwareVersion, fwReleaseLog: newer ? d.releaseLog : '' }));
    }
    return sendJson(res, 200, ok({ status: d.status === ST.UPGRADING ? 1 : 0 }));
  }
  const online = api.match(/^sites\/([^/]+)\/cmd\/devices\/([0-9A-F-]{17})\/onlineUpgrade$/);
  if (method === 'POST' && online && devices.has(online[2])) {
    const d = devices.get(online[2]);
    if (categoryOf(d.status) !== 1 || d.status === ST.UPGRADING) return sendJson(res, 200, { errorCode: -39002, msg: '[Simulated] The device is not connected.' });
    if (!d.latestFw || d.latestFw === d.firmwareVersion) return sendJson(res, 200, { errorCode: -39300, msg: '[Simulated] The device already runs the latest firmware.' });
    upgrade(d, auth, d.latestFw, 'online');
    return sendJson(res, 200, ok());
  }
  const check = api.match(/^sites\/([^/]+)\/cmd\/devices\/checkFirmware$/);
  if (method === 'POST' && check && Array.isArray(json?.mac) && json.mac.length && json.mac.every((m) => devices.has(m))) {
    uploadFor = json.mac[0];
    return sendJson(res, 200, ok());
  }
  // The upload has no MAC in it; the vendor UI always calls checkFirmware
  // first, so the simulator takes the upload if that call named one of its devices.
  // Vendor protocol (two POSTs, both multipart): data={"md5"} alone first —
  // answered without a fileId unless that file is already held — then
  // data={"md5"} + file. A request without md5 fails, as on a real controller.
  const upload = api.match(/^files\/sites\/([^/]+)\/device\/upgrade$/);
  if (method === 'POST' && upload && uploadFor) {
    const d = devices.get(uploadFor);
    const parts = multipartParts(body, req.headers['content-type']);
    let md5;
    try {
      md5 = JSON.parse(parts.find((p) => p.name === 'data')?.data.toString('utf8') ?? '{}').md5;
    } catch {}
    if (!/^[0-9a-f]{32}$/.test(md5 ?? '')) {
      uploadFor = undefined;
      return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] Invalid request parameters (no md5).' });
    }
    const filePart = parts.find((p) => p.name === 'file' && p.filename !== undefined);
    if (!filePart) return sendJson(res, 200, ok({})); // step 1: not held, send the file
    uploadFor = undefined;
    const name = filePart.filename;
    if (createHash('md5').update(filePart.data).digest('hex') !== md5) {
      return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] The file does not match its md5.' });
    }
    if (!/\.bin$/i.test(name)) return sendJson(res, 200, { errorCode: -39301, msg: '[Simulated] Upload a .bin firmware file.' });
    // Real controllers read the model from inside the image; the simulator uses the file name.
    if (!name.toUpperCase().replace(/[-_]/g, '').includes(d.model.toUpperCase().replace(/[-_]/g, ''))) {
      return sendJson(res, 200, { errorCode: -39304, msg: `[Simulated] ${name} is not firmware for ${d.model}.` });
    }
    const version = name.match(/(\d+\.\d+\.\d+)/)?.[1];
    const fileId = `simfw-${++logSeq}`;
    uploads.set(fileId, { mac: d.mac, name, size: filePart.data.length, version: version ? `${version} (from ${name})` : `custom (${name})` });
    return sendJson(res, 200, ok({ fileId }));
  }
  const dropFile = api.match(/^files\/sites\/([^/]+)\/device\/upgrade\/(simfw-\d+)$/);
  if (method === 'DELETE' && dropFile) {
    uploads.delete(dropFile[2]);
    return sendJson(res, 200, ok());
  }
  const manual = api.match(/^sites\/([^/]+)\/cmd\/devices\/upgrade$/);
  if (method === 'POST' && manual && uploads.has(json?.fileId)) {
    const file = uploads.get(json.fileId);
    const d = devices.get(file.mac);
    if (!json.macs?.includes(d.mac)) return sendJson(res, 200, { errorCode: -1001, msg: '[Simulated] The file was uploaded for another device.' });
    if (categoryOf(d.status) !== 1) return sendJson(res, 200, { errorCode: -39002, msg: '[Simulated] The device is not connected.' });
    uploads.delete(json.fileId);
    upgrade(d, auth, file.version, `file ${file.name}`);
    return sendJson(res, 200, ok({ upgradeId: `simup-${++logSeq}` }));
  }

  // Switch / gateway detail, like eaps/{mac} above. (The controller has no
  // controller-level devices/{mac}; the simulator must not invent one.)
  const wired = api.match(/^sites\/([^/]+)\/(switches|gateways)\/([0-9A-F-]{17})$/);
  if (method === 'GET' && wired && devices.has(wired[3])) {
    const d = devices.get(wired[3]);
    if (d.type !== (wired[2] === 'switches' ? 'switch' : 'gateway') || !d.siteId) {
      return sendJson(res, 200, { errorCode: wired[2] === 'switches' ? -39700 : -39501, msg: '[Simulated] Device does not exist.' });
    }
    return sendJson(res, 200, ok(row(d)));
  }

  // ── everything else goes to the real controller ──
  const up = await forward(req, body, upstreamPath);
  let out;
  try {
    out = JSON.parse(up.body.toString('utf8'));
  } catch {
    return relay(res, up);
  }
  if (typeof out?.errorCode !== 'number' || out.errorCode !== 0) return relay(res, up);

  // Settings write accepted by the real controller → push to devices.
  const write = api.match(/^sites\/([^/]+)\/((?:setting|rfPlanning)(?:\/.*)?)$/);
  if (method !== 'GET' && write) {
    const types = affectedTypes(write[2], json);
    const request = `${method} ${write[2]}`;
    const reason = describeWrite(method, write[2], json);
    for (const d of adoptedIn(write[1])) {
      if (types.includes(d.type) && [ST.CONNECTED, ST.CONFIGURING].includes(d.status)) reconfigure(d, auth, reason, request);
    }
    return relay(res, up);
  }

  if (method !== 'GET') return relay(res, up);
  const result = out.result;
  const q = url.searchParams;
  const siteOf = (s) => s.match(/^sites\/([^/]+)\//)?.[1];

  if (api === 'grid/devices/pending') {
    const sim = [...devices.values()].filter(isPendingSide).map(row);
    result.data = [...(result.data ?? []), ...sim];
    result.totalRows = (result.totalRows ?? 0) + sim.length;
    const stat = (result.deviceStat ??= {});
    stat.allDevices = (stat.allDevices ?? 0) + sim.length;
    stat.allAps = (stat.allAps ?? 0) + sim.filter((d) => d.type === 'ap').length;
    stat.allSwitchsAndGateway = (stat.allSwitchsAndGateway ?? 0) + sim.filter((d) => d.type !== 'ap').length;
  } else if (api === 'grid/devices/adopted') {
    const sim = adoptedIn().map(row);
    result.data = [...(result.data ?? []), ...sim];
    result.totalRows = (result.totalRows ?? 0) + sim.length;
  } else if (/^sites\/[^/]+\/devices$/.test(api) && Array.isArray(result)) {
    out.result = [...result, ...adoptedIn(siteOf(api)).map(row)];
  } else if (api === 'dashboard/overview') {
    const all = adoptedIn();
    const add = (k, n) => (result[k] = (result[k] ?? 0) + n);
    for (const [type, prefix] of [
      ['ap', 'Ap'],
      ['switch', 'Switch'],
    ]) {
      const list = all.filter((d) => d.type === type);
      const up1 = list.filter((d) => categoryOf(d.status) === 1).length;
      add(`total${prefix}Num`, list.length);
      add(`connected${prefix}Num`, up1);
      add(`disconnected${prefix}Num`, list.length - up1);
    }
    const sw = all.filter((d) => d.type === 'switch');
    add('totalPorts', sw.reduce((n, d) => n + d.ports, 0));
    add('availablePorts', sw.reduce((n, d) => n + d.ports - 1, 0));
  } else if (/^sites\/[^/]+\/alerts\/num$/.test(api)) {
    result.alertNum = (result.alertNum ?? 0) + logs.filter((l) => l.kind === 'alerts' && !l.archived && l.siteId === siteOf(api)).length;
  } else if (/^(sites\/[^/]+\/)?(logs\/)?(events|alerts)$/.test(api) && result) {
    const kind = api.endsWith('events') ? 'events' : 'alerts';
    const site = siteOf(api);
    const sim = logs.filter((l) => (!site || l.siteId === site) && inWindow(l, q, kind));
    if (Number(q.get('currentPage') ?? 1) <= 1) {
      result.data = [...sim, ...(result.data ?? [])].slice(0, Number(q.get('currentPageSize') ?? 50));
    }
    result.totalRows = (result.totalRows ?? 0) + sim.length;
  } else {
    return relay(res, up);
  }
  return relay(res, up, Buffer.from(JSON.stringify(out)));
}

function handleControl(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/sim/state') {
    return sendJson(res, 200, {
      speed: SPEED,
      stepMs: STEP,
      devices: [...devices.values()].map((d) => ({ ...row(d), fault: d.fault })),
      logs,
    });
  }
  if (req.method === 'POST' && url.pathname === '/sim/reset') {
    for (const d of devices.values()) d.gen++;
    reset();
    console.log('— simulator reset —');
    return sendJson(res, 200, { ok: true });
  }
  const fix = url.pathname.match(/^\/sim\/devices\/([0-9A-F-]{17})\/fix$/);
  if (req.method === 'POST' && fix && devices.has(fix[1])) {
    const d = devices.get(fix[1]);
    d.fault = undefined;
    log(d, 'events', 'Information', 'SIM_FIXED', `${d.name} was reset to factory defaults on site (simulated fix).`);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'unknown sim endpoint' });
}

// ── SSH: each simulated device runs a real SSH server ─────────────────────
//
// Only reachable on 127.0.0.1. It accepts the site's device account that the
// device received at its last provisioning, and only while the site's SSH
// setting was on at that time — like real hardware.

const hostKey = ssh2.utils.generateKeyPairSync('ed25519').private;

function shellFor(d, stream, { banner, quiet = false } = {}) {
  const prompt = () => !quiet && stream.write(`\r\n${d.name}# `);
  const out = (text) => stream.write(text.replace(/\n/g, '\r\n'));
  const uptime = () => {
    const sec = d.connectedAt ? Math.round((Date.now() - d.connectedAt) / 1000) : 0;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  };
  const commands = {
    help: () =>
      out(
        '\nCommands (simulated device shell):\n' +
          '  show version    firmware and hardware\n' +
          '  show config     what the controller last pushed\n' +
          '  show wlan       SSIDs being broadcast (APs)\n' +
          '  ifconfig        IP address\n' +
          '  uptime          time since connecting\n' +
          '  ping <host>     send 3 pings\n' +
          '  reboot          restart the device\n' +
          '  exit            close the session',
      ),
    'show version': () =>
      out(`\nModel:    ${d.showModel}\nFirmware: ${d.firmwareVersion}\nHardware: ${d.hwVersion}\nMAC:      ${d.mac}`),
    'uname -a': () => out(`\nLinux ${d.name} 4.4.60 #1 SMP PREEMPT ${d.model} armv7l GNU/Linux (simulated)`),
    'show config': () => out(`\n${(d.provision?.items ?? ['(nothing provisioned)']).map((i) => `  ${i}`).join('\n')}`),
    'show wlan': () =>
      out(
        d.type !== 'ap'
          ? '\nThis device has no radios.'
          : d.broadcast.length
            ? `\n${d.broadcast.map((b) => `  ${b.ssid.padEnd(24)} ${b.band.padEnd(8)} ${b.bssid}`).join('\n')}`
            : '\n  (not broadcasting)',
      ),
    ifconfig: () => out(`\nbr-lan    inet addr:${d.ip}  Mask:255.255.255.0\n          HWaddr ${d.mac.replace(/-/g, ':')}`),
    uptime: () => out(`\nup ${uptime()}`),
  };
  let line = '';
  if (!quiet) out(`\nWelcome to ${d.showModel} (${d.name}) — simulated by omada-sim.${banner ? ` ${banner}` : ''} Type "help".\n`);
  prompt();
  stream.on('data', (chunk) => {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\r' || ch === '\n') {
        const cmd = line.trim().replace(/\s+/g, ' ');
        line = '';
        if (cmd === 'exit' || cmd === 'logout') {
          out('\nbye\n');
          return stream.close();
        }
        if (cmd === 'reboot') {
          out('\nThe system is going down NOW!\n');
          reboot(d, d.lastAuth);
          return stream.close();
        }
        const ping = cmd.match(/^ping (\S+)$/);
        if (ping) {
          out(`\nPING ${ping[1]}: 56 data bytes`);
          for (let i = 0; i < 3; i++) out(`\n64 bytes from ${ping[1]}: seq=${i} ttl=64 time=${(1 + Math.random() * 3).toFixed(1)} ms`);
          out(`\n--- ${ping[1]} ping statistics ---\n3 packets transmitted, 3 received, 0% packet loss`);
        } else if (commands[cmd]) commands[cmd]();
        else if (cmd) out(`\n-sh: ${cmd.split(' ')[0]}: not found (type "help")`);
        prompt();
      } else if (ch === '\x7f' || ch === '\b') {
        if (line) {
          line = line.slice(0, -1);
          stream.write('\b \b');
        }
      } else if (ch === '\x03') {
        line = '';
        stream.write('^C');
        prompt();
      } else if (ch === '\x04') {
        out('\nbye\n');
        return stream.close();
      } else if (ch >= ' ') {
        line += ch;
        stream.write(ch);
      }
    }
  });
}

const sshPortOf = (mac) => SSH_BASE + SEEDS.findIndex((x) => x.mac === mac);

for (const seed of SEEDS) {
  const srv = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    const d = devices.get(seed.mac);
    client
      .on('authentication', (ctx) => {
        const okToTry = categoryOf(d.status) === 1 && d.ssh?.enable && d.account;
        if (okToTry && ctx.method === 'password' && ctx.username === d.account.username && ctx.password === d.account.password) {
          return ctx.accept();
        }
        ctx.reject(okToTry ? ['password'] : []);
      })
      .on('ready', () => {
        log(d, 'events', 'Information', 'SIM_SSH_LOGIN', `${d.account.username} signed in to ${d.name} over SSH.`);
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (acc) => acc?.());
          session.on('window-change', (acc) => acc?.());
          session.on('shell', (acc) => shellFor(d, acc()));
          // `ssh -t device sh` (the gateway's startup command): "sh" opens the
          // shell; any other command runs once and the channel closes.
          session.on('exec', (acc, _rej, info) => {
            const stream = acc();
            const cmd = info.command.trim();
            log(d, 'events', 'Information', 'SIM_SSH_EXEC', `${d.account.username} ran "${cmd}" on ${d.name} over SSH.`);
            shellFor(d, stream, { banner: cmd === 'sh' ? `Started by "${cmd}".` : undefined, quiet: cmd !== 'sh' });
            if (cmd !== 'sh') stream.emit('data', Buffer.from(`${cmd}\rexit\r`));
          });
        });
      })
      .on('error', () => {});
  });
  srv.listen(sshPortOf(seed.mac), '127.0.0.1');
}

const server = http.createServer((req, res) => {
  const p = req.url ?? '/';
  const done = (e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 502, { errorCode: -1, msg: `[Simulator] ${e.message}` });
  };
  if (p.startsWith('/controller-api/')) handleApi(req, res).catch(done);
  else if (p.startsWith('/sim/')) handleControl(req, res);
  else serveStatic(req, res);
});

// The real terminal gateway, pointed at this simulator: it asks the
// simulator (and through it the real controller) about the device, exactly as
// in docker, but simulated devices are reached on their local SSH ports.
attachTerminal(server, {
  controllerGet: async (apiPath, { cookie, token }) => {
    const url = new URL(`http://127.0.0.1:${PORT}/controller-api${apiPath}`);
    const res = await fetch(url, { headers: { accept: 'application/json', 'csrf-token': token, ...(cookie ? { cookie } : {}) }, redirect: 'manual' });
    if (res.status !== 200) throw new Error(res.status === 302 ? 'not signed in' : `HTTP ${res.status}`);
    const json = await res.json();
    if (json.errorCode !== 0) throw new Error(json.msg || `error ${json.errorCode}`);
    return json.result;
  },
  overrideTarget: (device) => (device.simulated && devices.has(device.mac) ? { host: '127.0.0.1', port: sshPortOf(device.mac) } : undefined),
  log: (m) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`),
});

server.listen(PORT, () => {
  console.log(`Omada simulator on http://localhost:${PORT}  (upstream ${UPSTREAM.origin}, step ${STEP} ms)`);
  console.log(`Simulated devices: ${SEEDS.map((s) => `${s.name} ${s.mac} (ssh 127.0.0.1:${sshPortOf(s.mac)})`).join(', ')}`);
});

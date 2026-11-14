import { useState } from 'react';
import { Alert, Box, CircularProgress, IconButton, MenuItem, Stack, TextField, Tooltip } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useSite } from '../hooks/useSiteContextBridge';
import { usePatchSiteSetting, useScenarios, useSiteSetting } from '../hooks/queries';
import {
  Fact,
  NumberField,
  PageTitle,
  SaveBar,
  SectionCard,
  Toast,
  ToggleRow,
  apiErrorText,
  useDraft,
} from '../components/SettingsKit';

// Site settings — GET/PATCH sites/{sid}/setting on controller v5.15.6.7.
// The object is a set of sections; a save sends only the edited ones, each
// whole. Live-verified 2026-11-13 (change → confirm → revert):
//   led, mesh, roaming, airtimeFairness, beaconControl, remoteLog, speedTest,
//   autoUpgrade, lldp, channelLimit, advancedFeature, bandSteeringForMultiBand
// Rules the controller enforces:
//   - `alert` must travel WITH `remoteLog` — alone it dies with errorCode -1
//     (NullPointerException in RemoteLogSetting.checkIsModify, server.log).
//   - `remoteLog.host` must be an IP address and cannot be cleared once set.
//   - `site` needs `scenario` (-1001 "Parameter [scenario] is null"), and a
//     site created by the setup wizard has none. The body mirrors the vendor
//     serializer {name, region, timeZone, scenario, dst}. NOT live-verified:
//     a scenario cannot be unset again, so the test was left to the user.

type Section = Record<string, unknown>;

interface SiteSetting {
  site?: Section & {
    name?: string;
    region?: string;
    timeZone?: string;
    scenario?: string;
    dst?: { enable?: boolean; offset?: number; start?: unknown; end?: unknown };
  };
  led?: { enable?: boolean };
  autoUpgrade?: { enable?: boolean };
  lldp?: { enable?: boolean };
  advancedFeature?: { enable?: boolean };
  channelLimit?: { enable?: boolean };
  mesh?: { meshEnable?: boolean; autoFailoverEnable?: boolean; defGatewayEnable?: boolean; fullSector?: boolean };
  roaming?: {
    fastRoamingEnable?: boolean;
    aiRoamingEnable?: boolean;
    dualBand11kReportEnable?: boolean;
    forceDisassociationEnable?: boolean;
    nonStickRoamingEnable?: boolean;
  };
  /** 0 = off, 1 = prefer the higher band, 2 = balance */
  bandSteeringForMultiBand?: { mode?: number };
  airtimeFairness?: { enable2g?: boolean; enable5g?: boolean; enable6g?: boolean };
  remoteLog?: { enable?: boolean; host?: string; port?: number; moreClientLog?: boolean };
  alert?: { enable?: boolean; delayEnable?: boolean; delay?: number };
  speedTest?: { enable?: boolean; interval?: number };
  beaconControl?: Record<string, number>;
  deviceAccount?: { username?: string; password?: string };
}

type SectionKey = keyof SiteSetting;

const isIpv4 = (v: string) =>
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v) && v.split('.').every((n) => Number(n) <= 255);

const RADIOS = [
  { suffix: '2g', label: '2.4 GHz' },
  { suffix: '5g', label: '5 GHz' },
  { suffix: '6g', label: '6 GHz' },
];

export default function SiteSettingsPage() {
  const { siteId } = useSite();
  const query = useSiteSetting<SiteSetting>(siteId);
  const save = usePatchSiteSetting(siteId);
  const { draft, dirty, set, reset, markSaved } = useDraft<SiteSetting>(query.data);
  const [touched, setTouched] = useState<Set<SectionKey>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const scenarios = useScenarios().data ?? [];

  if (query.isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (query.error) return <Alert severity="error">{apiErrorText(query.error)}</Alert>;
  if (!draft) return <Alert severity="info">Select a site first.</Alert>;

  /** Patch one section and remember it needs saving. */
  function edit<K extends SectionKey>(key: K, patch: Partial<NonNullable<SiteSetting[K]>>) {
    set({ [key]: { ...(draft![key] as object), ...patch } } as Partial<SiteSetting>);
    setTouched((prev) => new Set(prev).add(key));
  }

  const siteNeedsScenario = touched.has('site') && !draft.site?.scenario;
  const remoteLogBad =
    touched.has('remoteLog') && Boolean(draft.remoteLog?.enable) && !isIpv4(draft.remoteLog?.host ?? '');

  const onSave = () => {
    const keys = new Set(touched);
    if (keys.has('alert')) keys.add('remoteLog'); // the controller rejects alert on its own
    const body: Record<string, unknown> = Object.fromEntries([...keys].map((k) => [k, draft[k]]));
    if (keys.has('site') && draft.site) {
      const { name, region, timeZone, scenario, dst } = draft.site;
      body.site = {
        name: name?.trim(),
        region,
        timeZone,
        scenario,
        dst: dst?.enable ? { enable: true, offset: dst.offset, start: dst.start, end: dst.end } : { enable: false },
      };
    }
    save.mutate(body, {
      onSuccess: () => {
        markSaved();
        setTouched(new Set());
        setToast('Site settings saved');
      },
    });
  };

  const bar = (
    <SaveBar
      dirty={dirty}
      saving={save.isPending}
      disabled={siteNeedsScenario || remoteLogBad || !draft.site?.name?.trim()}
      onSave={onSave}
      onReset={() => {
        reset();
        setTouched(new Set());
        save.reset();
      }}
    />
  );

  const { site, mesh, roaming, airtimeFairness, remoteLog, alert, speedTest, beaconControl } = draft;
  const steering = draft.bandSteeringForMultiBand?.mode ?? 0;

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Site settings" subtitle="Applies to every device adopted into this site." action={bar} />
      {save.isError && <Alert severity="error">{apiErrorText(save.error)}</Alert>}

      <SectionCard title="Site">
        <TextField
          size="small"
          label="Site name"
          value={site?.name ?? ''}
          onChange={(e) => edit('site', { name: e.target.value })}
        />
        <TextField
          size="small"
          label="Time zone"
          value={site?.timeZone ?? ''}
          onChange={(e) => edit('site', { timeZone: e.target.value })}
          helperText="IANA zone id, e.g. Pacific/Auckland"
        />
        <TextField
          select
          size="small"
          label="Scenario"
          value={scenarios.includes(site?.scenario ?? '') ? site?.scenario : ''}
          onChange={(e) => edit('site', { scenario: e.target.value })}
          error={siteNeedsScenario}
          helperText={
            site?.scenario
              ? undefined
              : 'The controller needs a scenario before it accepts changes to the name or time zone. Once set it cannot be cleared.'
          }
        >
          {scenarios.map((sc) => (
            <MenuItem key={sc} value={sc}>
              {sc}
            </MenuItem>
          ))}
        </TextField>
        <Fact label="Country / region">{site?.region ?? '—'}</Fact>
      </SectionCard>

      <SectionCard title="Devices">
        <ToggleRow
          label="Status LEDs"
          checked={Boolean(draft.led?.enable)}
          onChange={(v) => edit('led', { enable: v })}
        />
        <ToggleRow
          label="Automatic firmware upgrades"
          checked={Boolean(draft.autoUpgrade?.enable)}
          onChange={(v) => edit('autoUpgrade', { enable: v })}
        />
        <ToggleRow label="LLDP" checked={Boolean(draft.lldp?.enable)} onChange={(v) => edit('lldp', { enable: v })} />
        <ToggleRow
          label="Channel limit"
          hint="Restricts outdoor APs to the 5 GHz channels local regulations allow."
          checked={Boolean(draft.channelLimit?.enable)}
          onChange={(v) => edit('channelLimit', { enable: v })}
        />
        <ToggleRow
          label="Advanced features"
          hint="Unlocks the roaming, band steering and beacon options below."
          checked={Boolean(draft.advancedFeature?.enable)}
          onChange={(v) => edit('advancedFeature', { enable: v })}
        />
      </SectionCard>

      <SectionCard title="Mesh">
        <ToggleRow label="Mesh" checked={Boolean(mesh?.meshEnable)} onChange={(v) => edit('mesh', { meshEnable: v })} />
        <ToggleRow
          label="Auto failover"
          hint="Mesh APs find a new uplink when theirs drops."
          checked={Boolean(mesh?.autoFailoverEnable)}
          disabled={!mesh?.meshEnable}
          onChange={(v) => edit('mesh', { autoFailoverEnable: v })}
        />
        <ToggleRow
          label="Connectivity detection via default gateway"
          checked={Boolean(mesh?.defGatewayEnable)}
          disabled={!mesh?.meshEnable}
          onChange={(v) => edit('mesh', { defGatewayEnable: v })}
        />
        <ToggleRow
          label="Full-sector DFS"
          checked={Boolean(mesh?.fullSector)}
          disabled={!mesh?.meshEnable}
          onChange={(v) => edit('mesh', { fullSector: v })}
        />
      </SectionCard>

      <SectionCard title="Roaming">
        <ToggleRow
          label="Fast roaming"
          checked={Boolean(roaming?.fastRoamingEnable)}
          onChange={(v) => edit('roaming', { fastRoamingEnable: v })}
        />
        <ToggleRow
          label="AI roaming"
          checked={Boolean(roaming?.aiRoamingEnable)}
          disabled={!roaming?.fastRoamingEnable}
          onChange={(v) => edit('roaming', { aiRoamingEnable: v })}
        />
        <ToggleRow
          label="Dual-band 802.11k reports"
          checked={Boolean(roaming?.dualBand11kReportEnable)}
          disabled={!roaming?.fastRoamingEnable}
          onChange={(v) => edit('roaming', { dualBand11kReportEnable: v })}
        />
        <ToggleRow
          label="Force disassociation"
          hint="Disconnect clients that ignore a roaming suggestion."
          checked={Boolean(roaming?.forceDisassociationEnable)}
          disabled={!roaming?.fastRoamingEnable}
          onChange={(v) => edit('roaming', { forceDisassociationEnable: v })}
        />
        <ToggleRow
          label="Non-stick roaming"
          checked={Boolean(roaming?.nonStickRoamingEnable)}
          onChange={(v) => edit('roaming', { nonStickRoamingEnable: v })}
        />
      </SectionCard>

      <SectionCard title="Band steering" subtitle="How dual-band clients are spread across the radios.">
        <TextField
          select
          size="small"
          label="Mode"
          value={steering}
          onChange={(e) => edit('bandSteeringForMultiBand', { mode: Number(e.target.value) })}
        >
          <MenuItem value={0}>Off</MenuItem>
          <MenuItem value={1}>Prefer 5 GHz / 6 GHz</MenuItem>
          <MenuItem value={2}>Balance</MenuItem>
        </TextField>
      </SectionCard>

      <SectionCard title="Airtime fairness" subtitle="Stops slow clients from hogging a radio.">
        {RADIOS.map((r) => {
          const key = `enable${r.suffix}` as 'enable2g' | 'enable5g' | 'enable6g';
          return (
            <ToggleRow
              key={r.suffix}
              label={r.label}
              checked={Boolean(airtimeFairness?.[key])}
              onChange={(v) => edit('airtimeFairness', { [key]: v })}
            />
          );
        })}
      </SectionCard>

      {beaconControl && (
        <SectionCard title="Beacon control" subtitle="Leave at the defaults unless you are tuning for a dense deployment.">
          {RADIOS.map((r) => (
            <Box key={r.suffix} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Box sx={{ width: 64, typography: 'body2', color: 'text.secondary' }}>{r.label}</Box>
              <NumberField
                label="DTIM period"
                value={beaconControl[`dtimPeriod${r.suffix}`]}
                min={1}
                max={255}
                onChange={(v) => v !== undefined && edit('beaconControl', { [`dtimPeriod${r.suffix}`]: v })}
                sx={{ width: 130 }}
              />
              <NumberField
                label="RTS threshold"
                value={beaconControl[`rtsThreshold${r.suffix}`]}
                min={1}
                max={2347}
                onChange={(v) => v !== undefined && edit('beaconControl', { [`rtsThreshold${r.suffix}`]: v })}
                sx={{ width: 130 }}
              />
              <NumberField
                label="Fragmentation"
                value={beaconControl[`fragmentationThreshold${r.suffix}`]}
                min={256}
                max={2346}
                onChange={(v) =>
                  v !== undefined && edit('beaconControl', { [`fragmentationThreshold${r.suffix}`]: v })
                }
                sx={{ width: 130 }}
              />
            </Box>
          ))}
        </SectionCard>
      )}

      <SectionCard title="Logging and alerts">
        <ToggleRow
          label="Remote logging (syslog)"
          checked={Boolean(remoteLog?.enable)}
          onChange={(v) => edit('remoteLog', { enable: v })}
        />
        {remoteLog?.enable && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Syslog server IP"
              value={remoteLog.host ?? ''}
              onChange={(e) => edit('remoteLog', { host: e.target.value.trim() })}
              error={remoteLogBad}
              helperText={remoteLogBad ? 'Enter an IPv4 address.' : undefined}
              sx={{ flexGrow: 1 }}
            />
            <NumberField
              label="Port"
              value={remoteLog.port}
              min={1}
              max={65535}
              onChange={(v) => edit('remoteLog', { port: v })}
              sx={{ width: 120 }}
            />
          </Box>
        )}
        {remoteLog?.enable && (
          <ToggleRow
            label="Include client detail logs"
            checked={Boolean(remoteLog.moreClientLog)}
            onChange={(v) => edit('remoteLog', { moreClientLog: v })}
          />
        )}
        <ToggleRow
          label="Alert emails"
          hint="Needs the mail server set up in Controller settings."
          checked={Boolean(alert?.enable)}
          onChange={(v) => edit('alert', { enable: v })}
        />
        {alert?.enable && (
          <>
            <ToggleRow
              label="Batch alerts"
              hint="Collect alerts and send them together."
              checked={Boolean(alert.delayEnable)}
              onChange={(v) => edit('alert', { delayEnable: v })}
            />
            {alert.delayEnable && (
              <NumberField
                label="Delay (seconds)"
                value={alert.delay}
                onChange={(v) => edit('alert', { delay: v })}
                sx={{ width: 180 }}
              />
            )}
          </>
        )}
        <ToggleRow
          label="Periodic speed test"
          hint="Needs an adopted gateway."
          checked={Boolean(speedTest?.enable)}
          onChange={(v) => edit('speedTest', { enable: v })}
        />
        {speedTest?.enable && (
          <NumberField
            label="Interval (minutes)"
            value={speedTest.interval}
            onChange={(v) => edit('speedTest', { interval: v })}
            sx={{ width: 180 }}
          />
        )}
      </SectionCard>

      {draft.deviceAccount && (
        <SectionCard
          title="Device account"
          subtitle="The login the controller sets on adopted devices. Change it in the vendor UI."
        >
          <Fact label="Username">{draft.deviceAccount.username ?? '—'}</Fact>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ typography: 'body2', color: 'text.secondary' }}>Password</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, typography: 'body2' }}>
              <span>{showPassword ? draft.deviceAccount.password : '••••••••'}</span>
              <Tooltip title={showPassword ? 'Hide' : 'Show'}>
                <IconButton
                  size="small"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </SectionCard>
      )}

      {dirty && bar}
      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

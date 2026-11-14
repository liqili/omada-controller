import { useMemo, useState } from 'react';
import { Alert, CircularProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useApDetail, useChannelInfo, useSaveApConfig, useWlanGroups } from '../../hooks/queries';
import { NumberField, SaveBar, SectionCard, Toast, ToggleRow, apiErrorText, useDraft } from '../../components/SettingsKit';
import {
  FOLLOW_SITE,
  POWER_CUSTOM,
  POWER_LABEL,
  RADIO_ID,
  RADIO_LABEL,
  WIDTH_LABEL,
  supportedRadios,
  widthOptions,
  type ApConfigSection,
  type ApDetail,
  type ApRadioSetting,
  type IpSetting,
  type RadioKey,
} from '../../api/domains/ap';

// Settings that apply to this one access point and override the site-wide
// ones. Each card saves its own section, like the vendor UI does.

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function TriState({ value, onChange, label }: { value?: number; onChange: (v: number) => void; label: string }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
      <Typography variant="body2">{label}</Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={value ?? FOLLOW_SITE}
        onChange={(_e, v) => v !== null && onChange(v)}
        aria-label={label}
      >
        <ToggleButton value={FOLLOW_SITE}>Site setting</ToggleButton>
        <ToggleButton value={1}>On</ToggleButton>
        <ToggleButton value={0}>Off</ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

/** One section draft + its save call. */
function useSection<T extends object>(data: T | undefined, section: ApConfigSection, siteId?: string, mac?: string) {
  const d = useDraft<T>(data);
  const save = useSaveApConfig(siteId, mac);
  return {
    ...d,
    save,
    submit: (body: object, done: (msg: string) => void) =>
      save.mutate({ section, body }, { onSuccess: () => (d.markSaved(), done('Saved — the access point is being reconfigured')) }),
  };
}

function GeneralCard({ ap, siteId, toast }: { ap: ApDetail; siteId: string; toast: (m: string) => void }) {
  const init = useMemo(() => ({ name: ap.name ?? '', ledSetting: ap.ledSetting ?? FOLLOW_SITE }), [ap]);
  const s = useSection(init, 'general', siteId, ap.mac);
  const d = s.draft;
  if (!d) return null;
  const nameOk = d.name.trim().length > 0 && d.name.trim().length <= 128;
  return (
    <SectionCard title="General">
      <TextField
        label="Device name"
        size="small"
        value={d.name}
        onChange={(e) => s.set({ name: e.target.value })}
        error={!nameOk}
        helperText={nameOk ? ' ' : 'Enter 1–128 characters'}
      />
      <TriState label="LEDs" value={d.ledSetting} onChange={(v) => s.set({ ledSetting: v })} />
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar
        dirty={s.dirty}
        saving={s.save.isPending}
        disabled={!nameOk}
        onReset={s.reset}
        onSave={() => s.submit({ name: d.name.trim(), ledSetting: d.ledSetting }, toast)}
      />
    </SectionCard>
  );
}

function RadioCard({ ap, radio, siteId, toast }: { ap: ApDetail; radio: RadioKey; siteId: string; toast: (m: string) => void }) {
  const current = useMemo<ApRadioSetting>(() => ap[radio] ?? {}, [ap, radio]);
  const s = useSection<ApRadioSetting>(current, 'radios', siteId, ap.mac);
  const channels = useChannelInfo(siteId, ap.mac);
  const d = s.draft;
  if (!d) return null;
  const list = channels.data?.[RADIO_ID[radio]] ?? [];
  const custom = d.txPowerLevel === POWER_CUSTOM;
  const widths = widthOptions(radio);
  return (
    <SectionCard title={`Radio ${RADIO_LABEL[radio]}`}>
      <ToggleRow label="Radio on" checked={d.radioEnable !== false} onChange={(v) => s.set({ radioEnable: v })} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          select
          size="small"
          label="Channel width"
          value={d.channelWidth ?? widths[0]}
          onChange={(e) => s.set({ channelWidth: e.target.value })}
          disabled={d.radioEnable === false}
          sx={{ minWidth: 180 }}
        >
          {[...new Set([...widths, d.channelWidth ?? widths[0]])].map((w) => (
            <MenuItem key={w} value={w}>
              {WIDTH_LABEL[w] ?? `Code ${w}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Channel"
          value={d.channel ?? '0'}
          onChange={(e) => s.set({ channel: e.target.value })}
          disabled={d.radioEnable === false}
          sx={{ minWidth: 160 }}
          helperText={channels.isLoading ? 'Loading channels…' : list.length ? ' ' : 'This AP reported no channel list'}
        >
          <MenuItem value="0">Auto</MenuItem>
          {list
            .filter((c) => c.channelValue !== 0)
            .map((c) => (
              <MenuItem key={c.channelValue} value={String(c.channelValue)}>
                {c.channelName ?? c.channelValue}
                {c.freq ? ` · ${c.freq} MHz` : ''}
              </MenuItem>
            ))}
          {d.channel && d.channel !== '0' && !list.some((c) => String(c.channelValue) === d.channel) && (
            <MenuItem value={d.channel}>{d.channel}</MenuItem>
          )}
        </TextField>
        <TextField
          select
          size="small"
          label="Transmit power"
          value={d.txPowerLevel ?? 4}
          onChange={(e) => s.set({ txPowerLevel: Number(e.target.value) })}
          disabled={d.radioEnable === false}
          sx={{ minWidth: 140 }}
        >
          {[4, 0, 1, 2, 3].map((p) => (
            <MenuItem key={p} value={p}>
              {POWER_LABEL[p]}
            </MenuItem>
          ))}
        </TextField>
        {custom && (
          <NumberField
            size="small"
            label="Power (dBm)"
            value={d.txPower}
            min={1}
            max={30}
            onChange={(v) => s.set({ txPower: v })}
            sx={{ width: 130 }}
          />
        )}
      </Stack>
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar
        dirty={s.dirty}
        saving={s.save.isPending}
        disabled={custom && !d.txPower}
        onReset={s.reset}
        onSave={() => {
          const body: ApRadioSetting = { ...d };
          // channelRange must not be sent empty (vendor serializer drops it too).
          if (!body.channelRange?.length) delete body.channelRange;
          if (!custom) delete body.txPower;
          // freq belongs to the old channel; the controller derives it.
          if (body.channel !== current.channel) delete body.freq;
          s.submit({ [radio]: body }, toast);
        }}
      />
    </SectionCard>
  );
}

function WlanCard({ ap, siteId, toast }: { ap: ApDetail; siteId: string; toast: (m: string) => void }) {
  const groups = useWlanGroups(siteId);
  const init = useMemo(() => ({ wlanId: ap.wlanId ?? '' }), [ap]);
  const s = useSection(init, 'wlans', siteId, ap.mac);
  const d = s.draft;
  if (!d) return null;
  return (
    <SectionCard title="Wireless networks" subtitle="The WLAN group decides which SSIDs this access point broadcasts.">
      <TextField
        select
        size="small"
        label="WLAN group"
        value={d.wlanId}
        onChange={(e) => s.set({ wlanId: e.target.value })}
        sx={{ maxWidth: 320 }}
      >
        {(groups.data?.groups ?? []).map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
            {g.primary ? ' (default)' : ''}
          </MenuItem>
        ))}
      </TextField>
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar
        dirty={s.dirty}
        saving={s.save.isPending}
        disabled={!d.wlanId}
        onReset={s.reset}
        onSave={() => s.submit({ wlanId: d.wlanId, ssidOverrides: [] }, toast)}
      />
    </SectionCard>
  );
}

function IpCard({ ap, siteId, toast }: { ap: ApDetail; siteId: string; toast: (m: string) => void }) {
  const init = useMemo<IpSetting>(() => ap.ipSetting ?? { mode: 'dhcp' }, [ap]);
  const s = useSection<IpSetting>(init, 'ip-settings', siteId, ap.mac);
  const d = s.draft;
  if (!d) return null;
  const isStatic = d.mode === 'static';
  const bad = (v?: string, optional = false) => (optional && !v ? false : !IPV4.test(v ?? ''));
  const invalid = isStatic && (bad(d.configIp) || bad(d.configMask) || bad(d.configGate) || bad(d.preferredDNS, true));
  const field = (key: keyof IpSetting, label: string, optional = false) => (
    <TextField
      size="small"
      label={label}
      value={(d[key] as string | undefined) ?? ''}
      onChange={(e) => s.set({ [key]: e.target.value.trim() })}
      error={bad(d[key] as string | undefined, optional) && Boolean(d[key])}
    />
  );
  return (
    <SectionCard title="IP address" subtitle="A wrong static address makes the AP unreachable until it is reset.">
      <ToggleButtonGroup
        size="small"
        exclusive
        value={d.mode ?? 'dhcp'}
        onChange={(_e, v) => v && s.set({ mode: v })}
        aria-label="IP mode"
      >
        <ToggleButton value="dhcp">DHCP</ToggleButton>
        <ToggleButton value="static">Static</ToggleButton>
      </ToggleButtonGroup>
      {isStatic && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          {field('configIp', 'IP address')}
          {field('configMask', 'Subnet mask')}
          {field('configGate', 'Gateway')}
          {field('preferredDNS', 'DNS (optional)', true)}
        </Stack>
      )}
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar
        dirty={s.dirty}
        saving={s.save.isPending}
        disabled={invalid}
        onReset={s.reset}
        onSave={() => {
          // Mirror the vendor serializer: send only the fields of the chosen mode.
          const body: IpSetting = isStatic
            ? { mode: 'static', configIp: d.configIp, configMask: d.configMask, configGate: d.configGate, preferredDNS: d.preferredDNS || undefined, alternateDNS: d.alternateDNS || undefined }
            : { mode: 'dhcp', fallback: d.fallback ?? true, fallbackIp: d.fallbackIp, fallbackMask: d.fallbackMask, fallbackGate: d.fallbackGate, useFixedAddr: d.useFixedAddr, netId: d.netId, dhcpIp: d.dhcpIp };
          s.submit({ ipSetting: body }, toast);
        }}
      />
    </SectionCard>
  );
}

function ServicesCard({ ap, siteId, toast }: { ap: ApDetail; siteId: string; toast: (m: string) => void }) {
  const init = useMemo(
    () => ({ lldpEnable: ap.lldpEnable ?? FOLLOW_SITE, loopbackDetectEnable: Boolean(ap.loopbackDetectEnable) }),
    [ap],
  );
  const s = useSection(
    init,
    'services',
    siteId,
    ap.mac,
  );
  const d = s.draft;
  if (!d) return null;
  return (
    <SectionCard title="Services">
      <TriState label="LLDP" value={d.lldpEnable} onChange={(v) => s.set({ lldpEnable: v })} />
      <ToggleRow
        label="Loopback detection"
        hint="Shut the uplink if this AP sees its own traffic come back."
        checked={d.loopbackDetectEnable}
        onChange={(v) => s.set({ loopbackDetectEnable: v })}
      />
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar dirty={s.dirty} saving={s.save.isPending} onReset={s.reset} onSave={() => s.submit(d, toast)} />
    </SectionCard>
  );
}

export default function ApConfigPanel({ siteId, mac }: { siteId: string; mac: string }) {
  const { data: ap, isLoading, error } = useApDetail(siteId, mac);
  const [toast, setToast] = useState<string | null>(null);

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', my: 3 }} />;
  if (error) return <Alert severity="error">{apiErrorText(error)}</Alert>;
  if (!ap) return <Alert severity="info">The controller returned no configuration for this access point.</Alert>;

  // Each card keeps its own draft; useDraft re-syncs a card from the server
  // copy only while it has no unsaved edits, so saving one card never wipes
  // edits in another.
  return (
    <Stack spacing={2}>
      <GeneralCard ap={ap} siteId={siteId} toast={setToast} />
      {supportedRadios(ap).map((r) => (
        <RadioCard key={r} ap={ap} radio={r} siteId={siteId} toast={setToast} />
      ))}
      <WlanCard ap={ap} siteId={siteId} toast={setToast} />
      <IpCard ap={ap} siteId={siteId} toast={setToast} />
      <ServicesCard ap={ap} siteId={siteId} toast={setToast} />
      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

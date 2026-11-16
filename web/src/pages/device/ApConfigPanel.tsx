import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useApDetail, useChannelInfo, useSaveApConfig, useWlanGroups, useWlanSsids } from '../../hooks/queries';
import { NumberField, SaveBar, SectionCard, Toast, ToggleRow, apiErrorText, useDraft } from '../../components/SettingsKit';
import {
  FOLLOW_SITE,
  POWER_CUSTOM,
  POWER_LABEL,
  RADIO_ID,
  RADIO_LABEL,
  WIDTH_LABEL,
  channelOptionValue,
  channelsForWidth,
  overrideProblems,
  overridesForGroup,
  serializeOverride,
  supportedRadios,
  widthOptions,
  type SsidOverride,
  type ApConfigSection,
  type ApDetail,
  type ApRadioSetting,
  type IpSetting,
  type RadioKey,
} from '../../api/domains/ap';
import type { RadioBand, WirelessParam } from '../../api/types';
import { actualChannelNumber } from './detailFormat';

const BAND_OF: Record<RadioKey, RadioBand> = { radioSetting2g: '2g', radioSetting5g: '5g', radioSetting5g2: '5g2', radioSetting6g: '6g' };

/** "Auto (now 36)" while the saved setting is Auto and the radio is up, like legacy "Auto(36)". */
function autoLabel(saved: string | undefined, draft: string | undefined, wp: WirelessParam | undefined, connected: boolean) {
  const now = connected && saved === '0' && draft === '0' ? actualChannelNumber(wp) : undefined;
  return now ? `Auto (now ${now})` : 'Auto';
}

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
  const allChannels = channels.data?.[RADIO_ID[radio]] ?? [];
  const custom = d.txPowerLevel === POWER_CUSTOM;
  const widths = widthOptions(radio, allChannels, {
    wirelessMode: d.wirelessMode,
    support11ac: ap.deviceMisc?.support11ac as boolean | undefined,
  });
  const list = channelsForWidth(radio, allChannels, d.channelWidth ?? widths[0]);
  // A channel that can't run at the new width falls back to Auto, as in the vendor form.
  const setWidth = (w: string) => {
    const fits = channelsForWidth(radio, allChannels, w).some((c) => channelOptionValue(c) === d.channel);
    s.set(d.channel && d.channel !== '0' && allChannels.length && !fits ? { channelWidth: w, channel: '0' } : { channelWidth: w });
  };
  return (
    <SectionCard title={`Radio ${RADIO_LABEL[radio]}`}>
      <ToggleRow label="Radio on" checked={d.radioEnable !== false} onChange={(v) => s.set({ radioEnable: v })} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          select
          size="small"
          label="Channel width"
          value={d.channelWidth ?? widths[0]}
          onChange={(e) => setWidth(e.target.value)}
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
          <MenuItem value="0">{autoLabel(current.channel, d.channel, ap[`wp${BAND_OF[radio]}`] as WirelessParam | undefined, ap.statusCategory === 1)}</MenuItem>
          {list
            .filter((c) => channelOptionValue(c) !== '0')
            .map((c) => (
              // Option value = item.value (what radioSetting.channel stores);
              // label = channelName ("36 / 5180MHz"), as in the legacy form.
              <MenuItem key={channelOptionValue(c)} value={channelOptionValue(c)}>
                {c.channelName ?? (c.freq ? `${c.channelValue} / ${c.freq}MHz` : c.channelValue)}
              </MenuItem>
            ))}
          {d.channel && d.channel !== '0' && !list.some((c) => channelOptionValue(c) === d.channel) && (
            <MenuItem value={d.channel}>{channels.isLoading ? 'Loading…' : `Unlisted channel (${d.channel})`}</MenuItem>
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

const BAND_NAMES = ['2.4 GHz', '5 GHz', '6 GHz'];

function OverrideDialog({
  row,
  all,
  onClose,
  onDone,
}: {
  row: SsidOverride;
  all: SsidOverride[];
  onClose: () => void;
  onDone: (o: SsidOverride) => void;
}) {
  const [o, setO] = useState<SsidOverride>(() => ({
    ...row,
    psk: row.hidePwd && !row.psk ? '012345678912' : row.psk,
  }));
  const [touched, setTouched] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const errors = overrideProblems(o, all);
  const shown = touched ? errors : {};
  const set = (p: Partial<SsidOverride>) => setO((x) => ({ ...x, ...p }));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Override {row.globalSsid}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <ToggleRow
            label="Override on this access point"
            hint="Turn off to use the SSID's own settings."
            checked={o.enable}
            onChange={(v) => set({ enable: v })}
          />
          <TextField
            size="small"
            label="SSID"
            value={o.ssid}
            disabled={!o.enable}
            onChange={(e) => set({ ssid: e.target.value })}
            error={Boolean(shown.ssid)}
            helperText={shown.ssid ?? 'Up to 32 bytes'}
          />
          {o.security === 3 && (
            <TextField
              size="small"
              label="Password"
              type={showKey ? 'text' : 'password'}
              value={o.psk ?? ''}
              disabled={!o.enable || o.hidePwd}
              onChange={(e) => set({ psk: e.target.value })}
              autoComplete="new-password"
              error={Boolean(shown.psk)}
              helperText={shown.psk ?? (o.hidePwd ? 'The password is hidden and is kept as it is.' : '8–63 characters')}
              InputProps={{
                endAdornment:
                  o.hidePwd || !o.enable ? undefined : (
                    <InputAdornment position="end">
                      <IconButton edge="end" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide password' : 'Show password'}>
                        {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
              }}
            />
          )}
          <ToggleRow label="VLAN" checked={o.vlanEnable} disabled={!o.enable} onChange={(v) => set({ vlanEnable: v })} />
          <NumberField
            label="VLAN ID"
            value={o.vlanId}
            disabled={!o.enable || !o.vlanEnable}
            onChange={(v) => set({ vlanId: v })}
            error={Boolean(shown.vlanId)}
            helperText={shown.vlanId ?? '1–4094'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            setTouched(true);
            if (!Object.keys(errors).length) onDone(o);
          }}
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function WlanCard({ ap, siteId, toast }: { ap: ApDetail; siteId: string; toast: (m: string) => void }) {
  const groups = useWlanGroups(siteId);
  const wlanSsids = useWlanSsids(siteId, Boolean(ap.wirelessRouter));
  const init = useMemo(
    () => ({ wlanId: ap.wlanId ?? '', ssidOverrides: overridesForGroup(ap, ap.wlanId ?? '', []) }),
    [ap],
  );
  const s = useSection(init, 'wlans', siteId, ap.mac);
  const [editing, setEditing] = useState<SsidOverride | null>(null);
  const d = s.draft;
  if (!d) return null;
  const rows = d.ssidOverrides;
  const setRow = (o: SsidOverride) => s.set({ ssidOverrides: rows.map((r) => (r.index === o.index ? o : r)) });
  const pickGroup = (wlanId: string) => s.set({ wlanId, ssidOverrides: overridesForGroup(ap, wlanId, wlanSsids.data ?? []) });
  // Vendor: an AP without OUI MAC filtering is warned before it broadcasts an SSID that uses one.
  const ouiSsids = new Set(
    (wlanSsids.data?.find((g) => g.wlanId === d.wlanId)?.ssids ?? []).filter((x) => x.ouiMacFilterEnable).map((x) => x.idInt),
  );
  const ouiWarn =
    !ap.addedInAdvanced && !ap.deviceMisc?.supportOuiMacFilter && rows.some((r) => r.ssidEnable && ouiSsids.has(r.index));
  const invalid = rows.some((r) => Object.keys(overrideProblems(r, rows)).length > 0);
  return (
    <SectionCard title="Wireless networks" subtitle="The WLAN group decides which SSIDs this access point broadcasts.">
      <TextField
        select
        size="small"
        label="WLAN group"
        value={d.wlanId}
        onChange={(e) => pickGroup(e.target.value)}
        sx={{ maxWidth: 320 }}
        disabled={wlanSsids.isLoading}
        helperText={wlanSsids.error ? `Couldn't load the groups' SSIDs: ${apiErrorText(wlanSsids.error)}` : undefined}
      >
        {(groups.data?.groups ?? []).map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
            {g.primary ? ' (default)' : ''}
          </MenuItem>
        ))}
      </TextField>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No SSIDs in this group that this access point can broadcast.
        </Typography>
      ) : (
        <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {rows.map((r, i) => (
            <ListItem
              key={r.index}
              divider={i < rows.length - 1}
              secondaryAction={
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <IconButton size="small" aria-label={`Override ${r.globalSsid}`} onClick={() => setEditing(r)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Switch
                    checked={r.ssidEnable}
                    onChange={(e) => setRow({ ...r, ssidEnable: e.target.checked })}
                    inputProps={{ 'aria-label': `Broadcast ${r.globalSsid} on this access point` }}
                  />
                </Stack>
              }
              sx={{ pr: 12 }}
            >
              <ListItemText
                primary={r.globalSsid}
                secondary={[
                  (r.supportBands ?? []).map((b) => BAND_NAMES[b]).join(', '),
                  r.enable ? `Overridden${r.ssid.trim() !== r.globalSsid ? ` as “${r.ssid.trim()}”` : ''}${r.vlanEnable ? ` · VLAN ${r.vlanId}` : ''}` : null,
                  r.ssidEnable ? null : 'Off on this access point',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      )}
      {ouiWarn && (
        <Alert severity="warning">
          This access point does not support OUI-based MAC filtering, so an enabled SSID that uses it won't filter clients here.
        </Alert>
      )}
      {s.save.isError && <Alert severity="error">{apiErrorText(s.save.error)}</Alert>}
      <SaveBar
        dirty={s.dirty}
        saving={s.save.isPending}
        disabled={!d.wlanId || invalid}
        onReset={s.reset}
        onSave={() => s.submit({ wlanId: d.wlanId, ssidOverrides: rows.map(serializeOverride) }, toast)}
      />
      {editing && (
        <OverrideDialog
          row={editing}
          all={rows}
          onClose={() => setEditing(null)}
          onDone={(o) => {
            setRow(o);
            setEditing(null);
          }}
        />
      )}
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

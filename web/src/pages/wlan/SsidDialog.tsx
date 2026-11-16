import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  IconButton,
  InputAdornment,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useSsidLookups } from '../../hooks/queries';
import { TimeRangeDialog } from './TimeRangeDialog';
import type { RateLimitProfile, Ssid, SsidList, WlanGroupList } from '../../api/domains/wlan';
import {
  ALL_BANDS,
  CUSTOM,
  MAC_FORMATS,
  MCAST_FILTERS,
  NAS_MODE,
  PMF,
  PPSK_AUTH,
  RATES_2G,
  RATES_OFDM,
  REKEY_UNIT,
  SEC,
  UNIT,
  VLAN_BY,
  VLAN_MODE,
  applyChange,
  formFromSsid,
  maskToBands,
  mloBlocker,
  oweLimited,
  pmfRule,
  radiusProfileDisabled,
  securityOptions,
  serializeSsid,
  show11r,
  validateSsidForm,
  wpaOptions,
  type Band,
  type SsidForm,
  type SsidFormContext,
} from '../../api/domains/ssidForm';
import { NumberField, ToggleRow, apiErrorText } from '../../components/SettingsKit';

// The SSID editor. Field set, defaults, dependencies and the saved body all
// follow the vendor editor via api/domains/ssidForm.ts — this file only lays
// the form out.

const BAND_LABEL: Record<Band, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** Which accordion each validation key lives in. */
const SECTION_OF: Record<string, string> = {
  lanNetworkId: 'advanced',
  vlanId: 'advanced',
  rekeyInterval: 'advanced',
  mloEnable: 'advanced',
  clientDownLimit: 'advanced',
  clientUpLimit: 'advanced',
  ssidDownLimit: 'advanced',
  ssidUpLimit: 'advanced',
  scheduleId: 'schedule',
  macFilterId: 'macFilter',
  channelUtil: 'multicast',
};

function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Accordion
      disableGutters
      expanded={open}
      onChange={() => onToggle(id)}
      variant="outlined"
      sx={{ '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">{title}</Typography>
          {summary && !open && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {summary}
            </Typography>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
  error,
  helperText,
  disabled,
}: {
  label: string;
  value: T | '' | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  error?: string;
  helperText?: string;
  disabled?: boolean;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        const hit = options.find((o) => String(o.value) === String(raw));
        if (hit) onChange(hit.value);
      }}
      error={Boolean(error)}
      helperText={error ?? helperText}
      disabled={disabled}
      fullWidth
    >
      {options.map((o) => (
        <MenuItem key={String(o.value)} value={o.value} disabled={o.disabled}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

function LimitRow({
  label,
  on,
  value,
  unit,
  error,
  onChange,
}: {
  label: string;
  on: boolean;
  value: number;
  unit: number;
  error?: string;
  onChange: (p: { on?: boolean; value?: number; unit?: number }) => void;
}) {
  return (
    <Box>
      <FormControlLabel
        label={label}
        control={<Checkbox checked={on} onChange={(e) => onChange({ on: e.target.checked })} />}
      />
      {on && (
        <Box sx={{ display: 'flex', gap: 1, pl: 4 }}>
          <NumberField
            label="Limit"
            value={value}
            onChange={(v) => onChange({ value: v ?? 0 })}
            error={Boolean(error)}
            helperText={error ?? (unit === UNIT.MBPS ? '1–10240' : '1–10485760')}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Unit"
            value={unit}
            onChange={(e) => onChange({ unit: Number(e.target.value) })}
            sx={{ width: 104 }}
          >
            <MenuItem value={UNIT.KBPS}>Kbps</MenuItem>
            <MenuItem value={UNIT.MBPS}>Mbps</MenuItem>
          </TextField>
        </Box>
      )}
    </Box>
  );
}

const fmtLimit = (on?: boolean, v?: number, t?: number) => (on ? `${v} ${t === UNIT.MBPS ? 'Mbps' : 'Kbps'}` : 'unlimited');
const profileSummary = (p?: RateLimitProfile) =>
  p ? `Down ${fmtLimit(p.downLimitEnable, p.downLimit, p.downLimitType)} · Up ${fmtLimit(p.upLimitEnable, p.upLimit, p.upLimitType)}` : '';

export default function SsidDialog({
  siteId,
  wlanId,
  row,
  list,
  limits,
  saving,
  error,
  onClose,
  onSave,
}: {
  siteId: string;
  wlanId: string;
  row?: Ssid;
  list?: SsidList;
  limits?: WlanGroupList;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: Ssid) => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const lookups = useSsidLookups(siteId, true);
  const L = lookups.data;

  const ctx: SsidFormContext | null = useMemo(() => {
    if (!L) return null;
    const max = { '2g': limits?.maxSsids2G ?? 8, '5g': limits?.maxSsids5G ?? 8, '6g': limits?.maxSsids6G ?? 8 };
    const used = { '2g': list?.ssidNum2g ?? 0, '5g': list?.ssidNum5g ?? 0, '6g': list?.ssidNum6g ?? 0 };
    return {
      mode: row ? 'edit' : 'add',
      wlanId,
      row,
      has6g: L.has6g,
      bandFull: { '2g': used['2g'] >= max['2g'], '5g': used['5g'] >= max['5g'], '6g': used['6g'] >= max['6g'] },
      mloFull: (Number(list?.ssidNumMlo) || 0) >= (limits?.maxSsidsMlo ?? 8),
      defaultRateLimitId: L.rateLimits.find((p) => p.isDefault)?.id,
    };
  }, [L, row, wlanId, list, limits]);

  const [form, setForm] = useState<SsidForm | null>(null);
  const [touched, setTouched] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [newRange, setNewRange] = useState(false);
  /** Name of a just-created time range to select once the list has it. */
  const [pendingRange, setPendingRange] = useState<string | null>(null);

  // Load once the lookups are in (the default rate-limit profile and 6 GHz
  // presence decide the new-SSID defaults, as in the vendor form).
  useEffect(() => {
    if (!ctx || form) return;
    const f = formFromSsid(ctx);
    const profile = L?.radiusProfiles.find((p) => p.radiusProfileId === f.radiusProfileId);
    f.builtInRadius = Boolean(profile?.builtInServer) && f.security === SEC.PPSK_RADIUS;
    setForm(f);
  }, [ctx, form, L]);

  const errors = form && ctx ? validateSsidForm(form, ctx) : {};
  const shown = touched ? errors : {};
  const errorSections = new Set(Object.keys(shown).map((k) => SECTION_OF[k]).filter(Boolean));
  const isOpen = (id: string) => Boolean(open[id]) || errorSections.has(id);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !isOpen(id) }));

  const set = (patch: Partial<SsidForm>) => setForm((f) => (f && ctx ? applyChange(f, patch, ctx) : f));

  // A new time range whose id the controller didn't return: select it by name once listed.
  useEffect(() => {
    const t = pendingRange && L?.timeRanges.find((r) => r.name === pendingRange);
    if (!t) return;
    setPendingRange(null);
    set({ scheduleId: t.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRange, L]);

  const title = row ? `Edit ${row.name}` : 'Create SSID';
  if (!form || !ctx || !L) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          {lookups.error ? <Alert severity="error">{apiErrorText(lookups.error)}</Alert> : <CircularProgress />}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
        </DialogActions>
      </Dialog>
    );
  }

  const f = form;
  const edit = ctx.mode === 'edit';
  const origBands = row ? maskToBands(row.band) : [];
  const sixOnly = f.bands.length === 1 && f.bands[0] === '6g';
  const secOpts = securityOptions(f.bands);
  const wpaOpts = wpaOptions(f.bands, f.security, f.mloEnable);
  const wpaChoices = wpaOpts.flatMap((o) =>
    o.encryptions.map((e) => ({
      value: `${o.version}-${e.value}`,
      label: o.encryptions.length > 1 || o.label.includes('Enterprise') ? `${o.label} / ${e.label}` : o.label,
      disabled: o.disabled,
    })),
  );
  const pmf = pmfRule(f.wpaVersion, f.bands);
  const mloWhy = mloBlocker(f, ctx);
  const can11r = show11r(f);
  const oweBlocked =
    f.security === SEC.NONE &&
    oweLimited(
      f,
      { n2g: list?.ssidNum2g ?? 0, n5g: list?.ssidNum5g ?? 0 },
      { max2g: limits?.maxSsids2G ?? 8, max5g: limits?.maxSsids5G ?? 8 },
      row,
    );
  const radiusOpts = L.radiusProfiles.map((p) => ({
    value: p.radiusProfileId,
    label: p.name,
    disabled: radiusProfileDisabled(p, f.security),
  }));
  // Vendor: a selected RADIUS profile the new security mode can't use is cleared.
  const setSecurity = (security: number) => {
    const p = L.radiusProfiles.find((x) => x.radiusProfileId === f.radiusProfileId);
    set(p && radiusProfileDisabled(p, security) ? { security, radiusProfileId: '', builtInRadius: false } : { security });
  };
  // Vendor: OWE is switched off once the SSID entries it needs are not there.
  const oweOn = f.oweEnable && !oweBlocked;
  const ppskType = f.security === SEC.PPSK ? 0 : 1;
  const ppskOpts = L.ppskProfiles.filter((p) => p.type === ppskType).map((p) => ({ value: p.id, label: p.profileName }));
  const showPpskProfile = f.security === SEC.PPSK || (f.security === SEC.PPSK_RADIUS && f.builtInRadius);
  const rateOpts = [{ value: CUSTOM, label: 'Custom' }, ...L.rateLimits.map((p) => ({ value: p.id, label: p.name }))];
  const groupOpts = L.macGroups.map((g) => ({ value: g.groupId, label: g.name }));

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    onSave(serializeSsid({ ...f, oweEnable: oweOn, builtInRadius: f.builtInRadius && f.security === SEC.PPSK_RADIUS }, ctx));
  };

  const rateSummary = (id: string) => (id === CUSTOM ? 'Custom' : (L.rateLimits.find((p) => p.id === id)?.name ?? 'Profile'));

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {/* ───────────── Basic ───────────── */}
          <TextField
            size="small"
            label="Network name (SSID)"
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            autoFocus={!edit}
            fullWidth
            error={Boolean(shown.name)}
            helperText={shown.name ?? `${utf8Len(f.name.trim())}/32 bytes`}
            inputProps={{ autoComplete: 'off' }}
          />

          <Box>
            <Typography variant="body2" color="text.secondary">
              Device type
            </Typography>
            <FormGroup row>
              {(['eap', 'gateway'] as const).map((t) => (
                <FormControlLabel
                  key={t}
                  label={t === 'eap' ? 'Access points' : 'Gateway'}
                  control={
                    <Checkbox
                      checked={f.deviceType.includes(t)}
                      disabled={edit}
                      onChange={(e) =>
                        set({ deviceType: e.target.checked ? [...f.deviceType, t] : f.deviceType.filter((x) => x !== t) })
                      }
                    />
                  }
                />
              ))}
            </FormGroup>
            <FormHelperText error={Boolean(shown.deviceType)}>
              {shown.deviceType ?? 'After an SSID is created, its device type cannot be changed.'}
            </FormHelperText>
            {f.deviceType.includes('gateway') && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Gateways only apply the settings they support; check the device’s configuration result after saving.
              </Alert>
            )}
          </Box>

          <Box>
            <Typography variant="body2" color="text.secondary">
              Band
            </Typography>
            <FormGroup row>
              {ALL_BANDS.map((b) => {
                const full = Boolean(ctx.bandFull?.[b]) && !origBands.includes(b);
                return (
                  <FormControlLabel
                    key={b}
                    label={BAND_LABEL[b]}
                    control={
                      <Checkbox
                        checked={f.bands.includes(b)}
                        disabled={full && !f.bands.includes(b)}
                        onChange={(e) =>
                          set({
                            bands: e.target.checked
                              ? ALL_BANDS.filter((x) => x === b || f.bands.includes(x))
                              : f.bands.filter((x) => x !== b),
                          })
                        }
                      />
                    }
                  />
                );
              })}
            </FormGroup>
            {(shown.bands || ALL_BANDS.some((b) => ctx.bandFull?.[b] && !origBands.includes(b))) && (
              <FormHelperText error={Boolean(shown.bands)}>
                {shown.bands ??
                  `The number of SSIDs on ${ALL_BANDS.filter((b) => ctx.bandFull?.[b] && !origBands.includes(b))
                    .map((b) => BAND_LABEL[b])
                    .join(', ')} is at its limit.`}
              </FormHelperText>
            )}
          </Box>

          <ToggleRow
            label="Guest network"
            hint="Blocks clients on this network from reaching any private IP subnet."
            checked={f.guestNetEnable}
            onChange={(v) => set({ guestNetEnable: v })}
          />

          <Select
            label="Security"
            value={f.security}
            onChange={setSecurity}
            options={secOpts}
          />

          {f.security === SEC.NONE && !sixOnly && (
            <ToggleRow
              label="OWE"
              hint={
                oweBlocked
                  ? 'Not enough SSID entries left: an OWE SSID counts twice on 2.4 GHz and 5 GHz.'
                  : 'Encrypts traffic with Opportunistic Wireless Encryption; older firmware falls back to open.'
              }
              checked={oweOn}
              disabled={oweBlocked}
              onChange={(v) => set({ oweEnable: v })}
            />
          )}

          {f.security === SEC.PERSONAL && (
            <TextField
              size="small"
              label="Security key"
              type={showKey ? 'text' : 'password'}
              value={f.securityKey}
              disabled={f.hidePwd}
              onChange={(e) => set({ securityKey: e.target.value })}
              fullWidth
              autoComplete="new-password"
              error={Boolean(shown.securityKey)}
              helperText={shown.securityKey ?? (f.hidePwd ? 'The password is hidden and is kept as it is.' : '8–63 characters')}
              InputProps={{
                endAdornment: f.hidePwd ? undefined : (
                  <InputAdornment position="end">
                    <IconButton edge="end" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide password' : 'Show password'}>
                      {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}

          {(f.security === SEC.ENTERPRISE || f.security === SEC.PPSK_RADIUS) && (
            <Select
              label="RADIUS profile"
              value={f.radiusProfileId}
              onChange={(v) => {
                const p = L.radiusProfiles.find((x) => x.radiusProfileId === v);
                set({ radiusProfileId: v, builtInRadius: Boolean(p?.builtInServer) });
              }}
              options={radiusOpts}
              error={shown.radiusProfileId}
              helperText={radiusOpts.length ? undefined : 'No RADIUS profiles yet — add one under Authentication.'}
            />
          )}

          {f.security === SEC.ENTERPRISE && (
            <Box>
              <Select
                label="NAS ID"
                value={f.wpaNasMode}
                onChange={(v) => set({ wpaNasMode: v })}
                options={[
                  { value: NAS_MODE.DEFAULT, label: 'Default (MAC address)' },
                  { value: NAS_MODE.DEVICE_NAME, label: 'Follow device name' },
                  { value: NAS_MODE.CUSTOM, label: 'Custom' },
                ]}
                helperText={f.wpaNasMode === NAS_MODE.DEVICE_NAME ? 'Device names longer than 64 bytes are truncated.' : undefined}
              />
              {f.wpaNasMode === NAS_MODE.CUSTOM && (
                <TextField
                  size="small"
                  label="Custom NAS ID"
                  value={f.wpaNasId}
                  onChange={(e) => set({ wpaNasId: e.target.value })}
                  fullWidth
                  sx={{ mt: 1.5 }}
                  error={Boolean(shown.wpaNasId)}
                  helperText={shown.wpaNasId ?? 'Up to 64 bytes'}
                />
              )}
            </Box>
          )}

          {showPpskProfile && (
            <Select
              label="PPSK profile"
              value={f.ppskId}
              onChange={(v) => set({ ppskId: v })}
              options={ppskOpts}
              error={shown.ppskId}
              helperText={ppskOpts.length ? undefined : 'No PPSK profiles of this kind yet — add one under Profiles in the controller.'}
            />
          )}

          {f.security === SEC.PPSK_RADIUS && (
            <>
              <Select
                label="Authentication type"
                value={f.ppskType}
                onChange={(v) => set({ ppskType: v })}
                options={[
                  { value: PPSK_AUTH.DEFAULT, label: 'Default' },
                  { value: PPSK_AUTH.EKMS, label: 'EKMS' },
                  { value: PPSK_AUTH.UNBOUND, label: 'Generic RADIUS with unbound MAC' },
                ]}
                helperText="Only EKMS supports a RADIUS profile that uses a domain name."
              />
              <TextField
                size="small"
                label={f.ppskType === PPSK_AUTH.EKMS ? 'NAS ID' : 'NAS ID (optional)'}
                value={f.ppskNasId}
                onChange={(e) => set({ ppskNasId: e.target.value })}
                fullWidth
                error={Boolean(shown.ppskNasId)}
                helperText={shown.ppskNasId ?? 'Up to 64 bytes'}
              />
              <Select
                label="MAC address format"
                value={f.macFormat}
                onChange={(v) => set({ macFormat: v })}
                options={MAC_FORMATS.map((label, value) => ({ value, label }))}
              />
            </>
          )}

          {/* ───────────── Advanced ───────────── */}
          <Box>
            <Section
              id="advanced"
              title="Advanced settings"
              summary={[
                f.broadcast ? 'Broadcast' : 'Hidden',
                f.vlanMode === VLAN_MODE.CUSTOM ? 'Custom VLAN' : 'Default VLAN',
                f.security !== SEC.NONE ? wpaChoices.find((c) => c.value === `${f.wpaVersion}-${f.wpaEncryption}`)?.label : null,
                `Client limit: ${rateSummary(f.clientRateLimitId)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              open={isOpen('advanced')}
              onToggle={toggle}
            >
              <ToggleRow label="SSID broadcast" checked={f.broadcast} onChange={(v) => set({ broadcast: v })} />

              <Box>
                <Typography variant="body2" color="text.secondary">
                  VLAN
                </Typography>
                <RadioGroup row value={f.vlanMode} onChange={(e) => set({ vlanMode: Number(e.target.value) })}>
                  <FormControlLabel value={VLAN_MODE.DEFAULT} control={<Radio />} label="Default" />
                  <FormControlLabel value={VLAN_MODE.CUSTOM} control={<Radio />} label="Custom" />
                </RadioGroup>
                {f.vlanMode === VLAN_MODE.CUSTOM && (
                  <Stack spacing={1.5} sx={{ pl: { xs: 0, sm: 2 } }}>
                    <RadioGroup value={f.customMode} onChange={(e) => set({ customMode: Number(e.target.value) })}>
                      <FormControlLabel value={VLAN_BY.NETWORK} control={<Radio />} label="By network" />
                      <FormControlLabel value={VLAN_BY.VLAN_ID} control={<Radio />} label="By VLAN ID" />
                    </RadioGroup>
                    {f.customMode === VLAN_BY.NETWORK ? (
                      <Select
                        label="Network"
                        value={f.lanNetworkId}
                        onChange={(v) => set({ lanNetworkId: v })}
                        options={L.lanNetworks}
                        error={shown.lanNetworkId}
                        helperText={L.lanNetworks.length ? undefined : 'No networks to pick — add one under Network.'}
                      />
                    ) : (
                      <NumberField
                        label="VLAN ID"
                        value={f.vlanId}
                        onChange={(v) => set({ vlanId: v })}
                        error={Boolean(shown.vlanId)}
                        helperText={shown.vlanId ?? '1–4094. Keep it different from the gateway’s default VLAN, or mesh APs may disconnect.'}
                        fullWidth
                      />
                    )}
                  </Stack>
                )}
              </Box>

              {f.security !== SEC.NONE && (
                <Select
                  label="WPA mode"
                  value={`${f.wpaVersion}-${f.wpaEncryption}`}
                  onChange={(v) => {
                    const [wpaVersion, wpaEncryption] = v.split('-').map(Number);
                    set({ wpaVersion, wpaEncryption });
                  }}
                  options={wpaChoices}
                  helperText={f.bands.includes('6g') && !f.bands.includes('2g') && !f.bands.includes('5g') ? '6 GHz only supports WPA3.' : undefined}
                />
              )}

              <ToggleRow
                label="MLO (Multi-Link Operation)"
                hint={
                  mloWhy && !f.mloEnable
                    ? mloWhy.trim() || 'Not available for this band selection.'
                    : f.mloEnable
                      ? 'Wi-Fi 7 clients use several bands at once. 802.11r is turned off.'
                      : 'Lets Wi-Fi 7 clients send and receive on several bands at once.'
                }
                checked={f.mloEnable}
                disabled={Boolean(mloWhy) && !f.mloEnable}
                onChange={(v) => set({ mloEnable: v })}
              />
              {shown.mloEnable && <FormHelperText error>{shown.mloEnable}</FormHelperText>}

              {f.security !== SEC.NONE && (
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    PMF (protected management frames)
                  </Typography>
                  <RadioGroup row value={f.pmfMode} onChange={(e) => set({ pmfMode: Number(e.target.value) })}>
                    {[
                      { v: PMF.MANDATORY, l: 'Mandatory' },
                      { v: PMF.CAPABLE, l: 'Capable' },
                      { v: PMF.DISABLED, l: 'Disabled' },
                    ].map((o) => (
                      <FormControlLabel key={o.v} value={o.v} control={<Radio />} label={o.l} disabled={!pmf.allowed.includes(o.v)} />
                    ))}
                  </RadioGroup>
                  {f.pmfMode === PMF.MANDATORY && (
                    <FormHelperText>Clients without PMF support may fail to connect.</FormHelperText>
                  )}
                </Box>
              )}

              {f.security !== SEC.NONE && (
                <Box>
                  <ToggleRow label="Group key update period" checked={f.gikRekeyEnable} onChange={(v) => set({ gikRekeyEnable: v })} />
                  {f.gikRekeyEnable && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <NumberField
                        label="Every"
                        value={f.rekeyInterval}
                        onChange={(v) => set({ rekeyInterval: v ?? 0 })}
                        error={Boolean(shown.rekeyInterval)}
                        helperText={
                          shown.rekeyInterval ??
                          (f.rekeyUnit === REKEY_UNIT.SECONDS ? '30–86400' : f.rekeyUnit === REKEY_UNIT.MINUTES ? '1–1440' : '1–24')
                        }
                        sx={{ flexGrow: 1 }}
                      />
                      <TextField
                        select
                        size="small"
                        label="Unit"
                        value={f.rekeyUnit}
                        onChange={(e) => set({ rekeyUnit: Number(e.target.value) })}
                        sx={{ width: 120 }}
                      >
                        <MenuItem value={REKEY_UNIT.HOURS}>Hours</MenuItem>
                        <MenuItem value={REKEY_UNIT.MINUTES}>Minutes</MenuItem>
                        <MenuItem value={REKEY_UNIT.SECONDS}>Seconds</MenuItem>
                      </TextField>
                    </Box>
                  )}
                </Box>
              )}

              {can11r && (
                <ToggleRow
                  label="802.11r fast roaming"
                  hint="Faster roaming for clients that support it; some older devices are incompatible."
                  checked={f.enable11r}
                  disabled={f.mloEnable}
                  onChange={(v) => set({ enable11r: v })}
                />
              )}

              {(['client', 'ssid'] as const).map((k) => {
                const id = k === 'client' ? f.clientRateLimitId : f.ssidRateLimitId;
                const p = L.rateLimits.find((x) => x.id === id);
                const field = (s: string) => `${k}${s}` as keyof SsidForm;
                return (
                  <Box key={k}>
                    <Select
                      label={k === 'client' ? 'Client rate limit' : 'SSID rate limit'}
                      value={id}
                      onChange={(v) => set({ [field('RateLimitId')]: v } as Partial<SsidForm>)}
                      options={rateOpts}
                      helperText={
                        id === CUSTOM
                          ? k === 'client'
                            ? 'Limits each client on this SSID.'
                            : 'Limits the SSID as a whole on each band (802.11ac and newer APs).'
                          : profileSummary(p)
                      }
                    />
                    {id === CUSTOM && (
                      <Box sx={{ pl: 1 }}>
                        {(['Down', 'Up'] as const).map((dir) => (
                          <LimitRow
                            key={dir}
                            label={dir === 'Down' ? 'Download limit' : 'Upload limit'}
                            on={f[field(`${dir}LimitEnable`)] as boolean}
                            value={f[field(`${dir}Limit`)] as number}
                            unit={f[field(`${dir}LimitType`)] as number}
                            error={shown[`${k}${dir}Limit`]}
                            onChange={(c) =>
                              set({
                                ...(c.on !== undefined && { [field(`${dir}LimitEnable`)]: c.on }),
                                ...(c.value !== undefined && { [field(`${dir}Limit`)]: c.value }),
                                ...(c.unit !== undefined && { [field(`${dir}LimitType`)]: c.unit }),
                              } as Partial<SsidForm>)
                            }
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Section>

            {/* ───────────── WLAN schedule ───────────── */}
            <Section
              id="schedule"
              title="WLAN schedule"
              summary={f.wlanScheduleEnable ? `Radio ${f.scheduleAction ? 'on' : 'off'} during ${L.timeRanges.find((t) => t.id === f.scheduleId)?.name ?? 'schedule'}` : 'Off'}
              open={isOpen('schedule')}
              onToggle={toggle}
            >
              <ToggleRow label="WLAN schedule" checked={f.wlanScheduleEnable} onChange={(v) => set({ wlanScheduleEnable: v })} />
              {f.wlanScheduleEnable && (
                <>
                  <RadioGroup value={f.scheduleAction} onChange={(e) => set({ scheduleAction: Number(e.target.value) })}>
                    <FormControlLabel value={1} control={<Radio />} label="Radio on — available only within the time range" />
                    <FormControlLabel value={0} control={<Radio />} label="Radio off — unavailable within the time range" />
                  </RadioGroup>
                  <Select
                    label="Time range"
                    value={f.scheduleId}
                    onChange={(v) => set({ scheduleId: v })}
                    options={L.timeRanges.map((t) => ({ value: t.id, label: t.name }))}
                    error={shown.scheduleId}
                    helperText={L.timeRanges.length ? undefined : 'No time ranges yet — create one below.'}
                  />
                  <Box>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => setNewRange(true)}>
                      New time range
                    </Button>
                  </Box>
                </>
              )}
              <TimeRangeDialog
                open={newRange}
                siteId={siteId}
                onClose={() => setNewRange(false)}
                onCreated={(id, name) => {
                  setNewRange(false);
                  if (id) set({ scheduleId: id });
                  else setPendingRange(name);
                }}
              />
            </Section>

            {/* ───────────── 802.11 rate control ───────────── */}
            <Section
              id="rates"
              title="802.11 rate control"
              summary={
                [f.rate2gCtrlEnable && `2.4 GHz ≥ ${f.lowerDensity2g} Mbps`, f.rate5gCtrlEnable && `5 GHz ≥ ${f.lowerDensity5g} Mbps`, f.rate6gCtrlEnable && `6 GHz ≥ ${f.lowerDensity6g} Mbps`]
                  .filter(Boolean)
                  .join(' · ') || 'Off'
              }
              open={isOpen('rates')}
              onToggle={toggle}
            >
              {(['2g', '5g', '6g'] as const)
                .filter((b) => f.bands.includes(b) || f[`rate${b}CtrlEnable`])
                .map((b) => {
                  const rates = b === '2g' && !f.cckRatesDisable ? RATES_2G : RATES_OFDM;
                  return (
                    <Box key={b}>
                      <ToggleRow
                        label={`${BAND_LABEL[b]} minimum data rate`}
                        checked={f[`rate${b}CtrlEnable`]}
                        onChange={(v) => set({ [`rate${b}CtrlEnable`]: v } as Partial<SsidForm>)}
                      />
                      {f[`rate${b}CtrlEnable`] && (
                        <Stack spacing={1} sx={{ pl: 1 }}>
                          <Select
                            label="Minimum rate"
                            value={f[`lowerDensity${b}`]}
                            onChange={(v) => set({ [`lowerDensity${b}`]: v } as Partial<SsidForm>)}
                            options={rates.map((r) => ({ value: r, label: `${r} Mbps` }))}
                            helperText={
                              b === '2g'
                                ? f.cckRatesDisable || f.lowerDensity2g >= 12
                                  ? 'Limited range and no connectivity for 802.11b devices.'
                                  : f.lowerDensity2g > 1
                                    ? 'Limited range and limited connectivity for 802.11b devices.'
                                    : 'Full device compatibility and range.'
                                : f[`lowerDensity${b}`] === 6
                                  ? 'Full device compatibility and range.'
                                  : 'Limited range and connectivity.'
                            }
                          />
                          {b === '2g' && (
                            <FormControlLabel
                              label="Disable CCK rates (1/2/5.5/11 Mbps)"
                              control={
                                <Checkbox
                                  checked={f.cckRatesDisable}
                                  onChange={(e) =>
                                    set({ cckRatesDisable: e.target.checked, lowerDensity2g: e.target.checked ? Math.max(6, f.lowerDensity2g === 11 ? 12 : f.lowerDensity2g) : f.lowerDensity2g })
                                  }
                                />
                              }
                            />
                          )}
                          <FormControlLabel
                            label="Require clients to use rates at or above this value"
                            control={
                              <Checkbox
                                checked={f[`clientRatesRequire${b}`]}
                                onChange={(e) => set({ [`clientRatesRequire${b}`]: e.target.checked } as Partial<SsidForm>)}
                              />
                            }
                          />
                          <FormControlLabel
                            label={`Send beacons at ${b === '2g' ? 1 : 6} Mbps`}
                            control={
                              <Checkbox
                                checked={f[`sendBeacons${b}`]}
                                onChange={(e) => set({ [`sendBeacons${b}`]: e.target.checked } as Partial<SsidForm>)}
                              />
                            }
                          />
                        </Stack>
                      )}
                    </Box>
                  );
                })}
            </Section>

            {/* ───────────── MAC filter ───────────── */}
            <Section
              id="macFilter"
              title="MAC filter"
              summary={f.macFilterEnable ? `${f.policy === 1 ? 'Allow' : 'Deny'} list: ${L.macGroups.find((g) => g.groupId === f.macFilterId)?.name ?? '—'}` : 'Off'}
              open={isOpen('macFilter')}
              onToggle={toggle}
            >
              <ToggleRow label="MAC filter" checked={f.macFilterEnable} onChange={(v) => set({ macFilterEnable: v })} />
              {f.macFilterEnable && (
                <>
                  <RadioGroup value={f.policy} onChange={(e) => set({ policy: Number(e.target.value) })}>
                    <FormControlLabel value={1} control={<Radio />} label="Allow list — only these MAC addresses may connect" />
                    <FormControlLabel value={0} control={<Radio />} label="Deny list — block these MAC addresses" />
                  </RadioGroup>
                  <Select
                    label="MAC group"
                    value={f.macFilterId}
                    onChange={(v) => set({ macFilterId: v })}
                    options={groupOpts}
                    error={shown.macFilterId}
                    helperText={groupOpts.length ? undefined : 'No MAC groups yet — add one under Profiles → Groups in the controller.'}
                  />
                </>
              )}
            </Section>

            {/* ───────────── Multicast / broadcast ───────────── */}
            <Section
              id="multicast"
              title="Multicast & broadcast management"
              summary={[
                `Multicast→unicast ${f.multiCastEnable || f.ipv6CastEnable ? 'on' : 'off'}`,
                `ARP→unicast ${f.arpCastEnable ? 'on' : 'off'}`,
                f.filterEnable ? 'Filtering on' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              open={isOpen('multicast')}
              onToggle={toggle}
            >
              <Box>
                <Typography variant="body2">Multicast-to-unicast conversion</Typography>
                <FormGroup row>
                  <FormControlLabel
                    label="IPv4"
                    control={<Checkbox checked={f.multiCastEnable} onChange={(e) => set({ multiCastEnable: e.target.checked })} />}
                  />
                  <FormControlLabel
                    label="IPv6"
                    control={<Checkbox checked={f.ipv6CastEnable} onChange={(e) => set({ ipv6CastEnable: e.target.checked })} />}
                  />
                </FormGroup>
                {(f.multiCastEnable || f.ipv6CastEnable) && (
                  <NumberField
                    label="Channel utilization (%)"
                    value={f.channelUtil}
                    onChange={(v) => set({ channelUtil: v ?? 0 })}
                    error={Boolean(shown.channelUtil)}
                    helperText={shown.channelUtil ?? 'Convert multicast to unicast while channel utilization is below this value (1–100).'}
                    fullWidth
                  />
                )}
              </Box>
              <ToggleRow label="ARP-to-unicast conversion" checked={f.arpCastEnable} onChange={(v) => set({ arpCastEnable: v })} />
              <ToggleRow
                label="Multicast filtering"
                hint="Drops multicast packets of the chosen protocols. Wrong settings can break discovery."
                checked={f.filterEnable}
                onChange={(v) => set({ filterEnable: v })}
              />
              {f.filterEnable && (
                <>
                  <FormGroup row>
                    {MCAST_FILTERS.map((m) => (
                      <FormControlLabel
                        key={m.value}
                        label={m.label}
                        control={
                          <Checkbox
                            checked={f.filterMode.includes(m.value)}
                            onChange={(e) =>
                              set({ filterMode: e.target.checked ? [...f.filterMode, m.value] : f.filterMode.filter((x) => x !== m.value) })
                            }
                          />
                        }
                      />
                    ))}
                  </FormGroup>
                  <Select
                    label="Exception MAC group (optional)"
                    value={f.macGroupId ?? ''}
                    onChange={(v) => set({ macGroupId: v })}
                    options={groupOpts}
                    helperText="Multicast from these source MAC addresses is still delivered."
                  />
                </>
              )}
            </Section>
          </Box>

          {touched && Object.keys(errors).length > 0 && (
            <Alert severity="warning">Fix the highlighted fields{errorSections.size ? ' (sections with problems are opened)' : ''}.</Alert>
          )}
          {Boolean(error) && <Alert severity="error">{apiErrorText(error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" disabled={saving} onClick={submit}>
          {saving ? 'Saving…' : edit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

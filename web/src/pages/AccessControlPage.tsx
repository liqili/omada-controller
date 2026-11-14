import { Alert, MenuItem, Stack, TextField } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useSetting, useSettingList } from '../hooks/queries';
import { ListSection, PageTitle, ResourceCard, ToggleRow, onOff } from '../components/SettingsKit';

// Network authentication. Save verbs (controller v5.15.6.7, live-verified):
//   setting/dot1x   — PATCH (PUT → -1600)
//   setting/macAuth — PATCH; turning it on needs ssids:[{ssidName, ssidId}]
//                     (empty → -1001). Candidates: GET setting/macAuthSsids
//                     → {ssids:[{wlanId, wlanName, ssidList:[{ssidId, ssidName}]}]}
//   setting/radiusProfiles — GET (array); create/edit not wired yet.
// Both features authenticate against a RADIUS profile. With the built-in
// profile the controller answers -34032 "Built-in radius server not started"
// until that server is enabled under Controller settings → RADIUS; both
// request bodies were verified up to that check (2026-11-13). The MAC format
// (0–5) is kept as stored.

interface Dot1x {
  enable?: boolean;
  radiusProfileId?: string;
  vlanAssign?: boolean;
  mab?: boolean;
}

interface MacAuth {
  enable?: boolean;
  radiusProfileId?: string;
  ssids?: { ssidName?: string; ssidId?: string }[];
  mabEnable?: boolean;
  emptyPwdEable?: boolean;
  macFormat?: number;
}

interface MacAuthCandidates {
  ssids?: { wlanId: string; wlanName?: string; ssidList?: { ssidId: string; ssidName: string }[] }[];
}

interface RadiusProfile {
  radiusProfileId: string;
  name: string;
  authServer?: { radiusServerIp?: string; radiusPort?: number }[];
  radiusAccountingEnable?: boolean;
  builtInServer?: boolean;
  serverEnable?: boolean;
}

function RadiusSelect({
  profiles,
  value,
  onChange,
}: {
  profiles: RadiusProfile[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label="RADIUS profile"
      value={profiles.some((p) => p.radiusProfileId === value) ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      helperText={profiles.length ? undefined : 'No RADIUS profile exists yet.'}
    >
      {profiles.map((p) => (
        <MenuItem key={p.radiusProfileId} value={p.radiusProfileId}>
          {p.name}
        </MenuItem>
      ))}
    </TextField>
  );
}

export default function AccessControlPage() {
  const { siteId } = useSite();
  const profiles = useSettingList<RadiusProfile>(siteId, 'radiusProfiles').data?.rows ?? [];
  const candidates = (useSetting<MacAuthCandidates>(siteId, 'macAuthSsids').data?.ssids ?? []).flatMap((w) =>
    (w.ssidList ?? []).map((s) => ({ ...s, wlanName: w.wlanName })),
  );

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Authentication" subtitle="Who may join your wired and wireless networks." />

      <ResourceCard<Dot1x>
        siteId={siteId}
        resource="dot1x"
        verb="PATCH"
        title="802.1X"
        subtitle="Port-based authentication on switch ports."
        valid={(d) => !d.enable || Boolean(d.radiusProfileId)}
      >
        {(d, set) => (
          <>
            <ToggleRow label="802.1X" checked={Boolean(d.enable)} onChange={(v) => set({ enable: v })} />
            <RadiusSelect profiles={profiles} value={d.radiusProfileId} onChange={(id) => set({ radiusProfileId: id })} />
            <ToggleRow
              label="VLAN assignment"
              hint="Put clients in the VLAN the RADIUS server returns."
              checked={Boolean(d.vlanAssign)}
              onChange={(v) => set({ vlanAssign: v })}
            />
            <ToggleRow
              label="MAB"
              hint="Fall back to MAC authentication for devices without 802.1X."
              checked={Boolean(d.mab)}
              onChange={(v) => set({ mab: v })}
            />
            {d.enable && !d.radiusProfileId && <Alert severity="warning">Pick a RADIUS profile to turn 802.1X on.</Alert>}
          </>
        )}
      </ResourceCard>

      <ResourceCard<MacAuth>
        siteId={siteId}
        resource="macAuth"
        verb="PATCH"
        title="MAC-based authentication"
        subtitle="Wireless clients are checked against RADIUS by their MAC address."
        valid={(d) => !d.enable || Boolean(d.radiusProfileId && d.ssids?.length)}
        toBody={(d) => (d.enable ? { macFormat: 0, mabEnable: false, emptyPwdEable: false, ...d } : d)}
      >
        {(d, set) => (
          <>
            <ToggleRow label="MAC-based authentication" checked={Boolean(d.enable)} onChange={(v) => set({ enable: v })} />
            <RadiusSelect profiles={profiles} value={d.radiusProfileId} onChange={(id) => set({ radiusProfileId: id })} />
            <TextField
              select
              size="small"
              label="Wireless networks"
              SelectProps={{ multiple: true }}
              value={(d.ssids ?? []).map((x) => x.ssidId ?? '')}
              onChange={(e) => {
                const ids = e.target.value as unknown as string[];
                set({
                  ssids: candidates
                    .filter((c) => ids.includes(c.ssidId))
                    .map((c) => ({ ssidName: c.ssidName, ssidId: c.ssidId })),
                });
              }}
              error={Boolean(d.enable) && !d.ssids?.length}
              helperText={
                candidates.length
                  ? 'The SSIDs whose clients are checked.'
                  : 'No wireless networks exist yet — add one under Wireless first.'
              }
            >
              {candidates.map((c) => (
                <MenuItem key={c.ssidId} value={c.ssidId}>
                  {c.ssidName}
                  {c.wlanName ? ` (${c.wlanName})` : ''}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
      </ResourceCard>

      <ListSection<RadiusProfile>
        siteId={siteId}
        resource="radiusProfiles"
        title="RADIUS profiles"
        keyOf={(p) => p.radiusProfileId}
        emptyText="No RADIUS profiles."
        columns={[
          { header: 'Name', render: (p) => p.name },
          {
            header: 'Auth server',
            render: (p) => p.authServer?.map((s) => `${s.radiusServerIp}:${s.radiusPort}`).join(', ') || '—',
          },
          { header: 'Accounting', render: (p) => onOff(p.radiusAccountingEnable) },
          { header: 'Type', render: (p) => (p.builtInServer ? 'Built-in' : 'External'), hideOnMobile: true },
        ]}
      />
    </Stack>
  );
}

import { MenuItem, Stack, TextField } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useSettingList } from '../hooks/queries';
import { ListSection, NumberField, PageTitle, ResourceCard, ToggleRow, onOff } from '../components/SettingsKit';

// Site services. Save verbs, all live-verified on controller v5.15.6.7:
//   setting/snmp, setting/ssh, setting/upnp — PUT (SNMP on/off with
//     communityString verified 2026-11-13)
//   setting/mdns — PUT; turning it on needs networkIds[] (LAN network ids),
//     a bare {enable:true} → -1001
// The schedule/DDNS/reservation lists are read-only for now.

interface Snmp {
  snmpV1V2CEnable?: boolean;
  communityString?: string;
  snmpV3Enable?: boolean;
  username?: string;
  password?: string;
}

interface Ssh {
  sshEnable?: boolean;
  sshServerPort?: number;
  layer3Access?: boolean;
}

interface Enable {
  enable?: boolean;
}

interface Mdns extends Enable {
  networkIds?: string[];
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

// The vendor UI allows 22 or an unprivileged port.
const sshPortOk = (p: number | undefined) => p === 22 || (p !== undefined && p >= 1025 && p <= 65535);

export default function ServicesPage() {
  const { siteId } = useSite();
  const networks = useSettingList<{ id: string; name?: string }>(siteId, 'lan/networks').data?.rows ?? [];

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Services" subtitle="Management services the controller pushes to this site's devices." />

      <ResourceCard<Snmp>
        siteId={siteId}
        resource="snmp"
        verb="PUT"
        title="SNMP"
        subtitle="Lets monitoring systems poll your devices."
        valid={(d) =>
          (!d.snmpV1V2CEnable || Boolean(d.communityString?.trim())) &&
          (!d.snmpV3Enable || Boolean(d.username?.trim() && d.password))
        }
      >
        {(d, set) => (
          <>
            <ToggleRow
              label="SNMP v1 / v2c"
              checked={Boolean(d.snmpV1V2CEnable)}
              onChange={(v) => set({ snmpV1V2CEnable: v })}
            />
            {d.snmpV1V2CEnable && (
              <TextField
                size="small"
                label="Community string"
                value={d.communityString ?? ''}
                onChange={(e) => set({ communityString: e.target.value })}
              />
            )}
            <ToggleRow label="SNMP v3" checked={Boolean(d.snmpV3Enable)} onChange={(v) => set({ snmpV3Enable: v })} />
            {d.snmpV3Enable && (
              <>
                <TextField
                  size="small"
                  label="Username"
                  value={d.username ?? ''}
                  onChange={(e) => set({ username: e.target.value })}
                  autoComplete="off"
                />
                <TextField
                  size="small"
                  label="Password"
                  type="password"
                  value={d.password ?? ''}
                  onChange={(e) => set({ password: e.target.value })}
                  autoComplete="new-password"
                />
              </>
            )}
          </>
        )}
      </ResourceCard>

      <ResourceCard<Ssh>
        siteId={siteId}
        resource="ssh"
        verb="PUT"
        title="SSH"
        subtitle="Shell access to adopted devices, using the site's device account."
        valid={(d) => sshPortOk(d.sshServerPort)}
      >
        {(d, set) => (
          <>
            <ToggleRow label="SSH login" checked={Boolean(d.sshEnable)} onChange={(v) => set({ sshEnable: v })} />
            <NumberField
              label="SSH port"
              value={d.sshServerPort}
              onChange={(v) => set({ sshServerPort: v })}
              error={!sshPortOk(d.sshServerPort)}
              helperText="22, or 1025–65535"
            />
            <ToggleRow
              label="Layer 3 accessibility"
              hint="Allow SSH from other subnets."
              checked={Boolean(d.layer3Access)}
              onChange={(v) => set({ layer3Access: v })}
            />
          </>
        )}
      </ResourceCard>

      <ResourceCard<Enable>
        siteId={siteId}
        resource="upnp"
        verb="PUT"
        title="UPnP"
        subtitle="Lets LAN devices open gateway ports automatically. Needs an adopted gateway to take effect."
      >
        {(d, set) => <ToggleRow label="UPnP" checked={Boolean(d.enable)} onChange={(v) => set({ enable: v })} />}
      </ResourceCard>

      <ResourceCard<Mdns>
        siteId={siteId}
        resource="mdns"
        verb="PUT"
        title="mDNS"
        subtitle="Forwards service discovery (AirPlay, Chromecast, printers) between networks."
        valid={(d) => !d.enable || Boolean(d.networkIds?.length)}
        toBody={(d) => (d.enable ? { enable: true, networkIds: d.networkIds } : { enable: false })}
      >
        {(d, set) => (
          <>
            <ToggleRow label="mDNS" checked={Boolean(d.enable)} onChange={(v) => set({ enable: v })} />
            {d.enable && (
              <TextField
                select
                size="small"
                label="Networks"
                SelectProps={{ multiple: true }}
                value={d.networkIds ?? []}
                onChange={(e) => set({ networkIds: e.target.value as unknown as string[] })}
                error={!d.networkIds?.length}
                helperText="Pick the networks to forward discovery between."
              >
                {networks.map((n) => (
                  <MenuItem key={n.id} value={n.id}>
                    {n.name ?? n.id}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </>
        )}
      </ResourceCard>

      <ListSection<Row>
        siteId={siteId}
        resource="service/dhcp"
        title="DHCP reservations"
        keyOf={(r, i) => text(r.mac ?? r.id ?? i)}
        emptyText="No reserved addresses."
        columns={[
          { header: 'MAC', render: (r) => text(r.mac) },
          { header: 'IP address', render: (r) => text(r.ip) },
          { header: 'Network', render: (r) => text(r.netName ?? r.netId), hideOnMobile: true },
          { header: 'Description', render: (r) => text(r.description), hideOnMobile: true },
        ]}
      />

      <ListSection<Row>
        siteId={siteId}
        resource="service/ddns"
        title="Dynamic DNS"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No dynamic DNS entries."
        columns={[
          { header: 'Domain', render: (r) => text(r.domainName) },
          { header: 'Username', render: (r) => text(r.username) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />

      <ListSection<Row>
        siteId={siteId}
        resource="service/rebootSchedules"
        title="Reboot schedules"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No reboot schedules."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />

      <ListSection<Row>
        siteId={siteId}
        resource="service/poeSchedules"
        title="PoE schedules"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No PoE schedules."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />
    </Stack>
  );
}

import { Alert, Stack } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useSetting } from '../hooks/queries';
import { Fact, ListSection, PageTitle, SectionCard, onOff } from '../components/SettingsKit';

// VPN — read-only for now. GETs verified live on v5.15.6.7 (2026-11-13),
// all under sites/{sid}/setting/:
//   vpns (grid + support flags), vpns/users (grid), wireguard (grid),
//   sslvpn/server ({status, supportRadius, supportLdap})
// VPN tunnels terminate on the gateway, so nothing here is active until one
// is adopted.

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

export default function VpnPage() {
  const { siteId } = useSite();
  const ssl = useSetting<{ status?: boolean }>(siteId, 'sslvpn/server');
  const status = useSetting<{ adoptedGateway?: boolean }>(siteId, 'wanlanstatus');

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="VPN" subtitle="Tunnels that terminate on this site's gateway." />
      {status.data && !status.data.adoptedGateway && (
        <Alert severity="info">
          VPN needs an adopted gateway. Policies listed here take effect once one joins the site. Editing is not
          available here yet.
        </Alert>
      )}

      <ListSection<Row>
        siteId={siteId}
        resource="vpns"
        title="VPN policies"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No VPN policies."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />

      <ListSection<Row>
        siteId={siteId}
        resource="wireguard"
        title="WireGuard interfaces"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No WireGuard interfaces."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />

      <ListSection<Row>
        siteId={siteId}
        resource="vpns/users"
        title="VPN users"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No VPN users."
        columns={[{ header: 'Username', render: (r) => text(r.username) }]}
      />

      <SectionCard title="SSL VPN">
        <Fact label="Server">{ssl.data ? onOff(ssl.data.status) : '—'}</Fact>
      </SectionCard>
    </Stack>
  );
}

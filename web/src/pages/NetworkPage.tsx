import { useState } from 'react';
import { Alert, Box, Chip, CircularProgress, Stack, Tab, Tabs } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useSetting } from '../hooks/queries';
import { ResponsiveList } from '../components/ResponsiveList';
import { Fact, ListSection, PageTitle, SectionCard, apiErrorText, onOff } from '../components/SettingsKit';

// Wired network configuration — read-only for now. Every GET below was
// verified live on v5.15.6.7 (2026-11-13) and answers even with no gateway
// adopted: the controller keeps the site's intended config and pushes it on
// adoption. Paths are under sites/{sid}/setting/:
//   lan/networks, lan/profiles, wan/networks, wanlanstatus,
//   transmission/{portForwardings,staticRoutings,policyRoutings,alg},
//   firewall/{acls?type=0,urlfilterings?type=gateway,attackdefense,timeout}, ips

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

interface LanNetwork {
  id: string;
  name?: string;
  purpose?: string;
  vlan?: number;
  gatewaySubnet?: string;
  dhcpSettings?: { enable?: boolean; ipaddrStart?: string; ipaddrEnd?: string };
  igmpSnoopEnable?: boolean;
}

interface PortProfile {
  id: string;
  name?: string;
  poe?: number;
  spanningTreeEnable?: boolean;
  loopbackDetectEnable?: boolean;
  portIsolationEnable?: boolean;
  tagNetworkIds?: string[];
}

interface WanNetworks {
  osgPortInfo?: { wanLanPortSettings?: { portUuid: string; portName?: string; type?: number }[] };
  wanPortSettings?: {
    portUuid: string;
    portName?: string;
    wanPortIpv4Setting?: { proto?: string; vlanId?: number; ipv4Dhcp?: { mtu?: number } };
    wanPortIpv6Setting?: { enable?: number };
  }[];
}

interface WanLanStatus {
  adoptedGateway?: boolean;
}

interface Alg {
  ftp?: boolean;
  h323?: boolean;
  pptp?: boolean;
  sip?: boolean;
  ipSec?: boolean;
}

function WanTab({ siteId }: { siteId: string | undefined }) {
  const wan = useSetting<WanNetworks>(siteId, 'wan/networks');
  if (wan.isLoading) return <CircularProgress size={22} />;
  if (wan.error) return <Alert severity="info">{apiErrorText(wan.error)}</Alert>;
  const configured = wan.data?.wanPortSettings ?? [];
  const ports = wan.data?.osgPortInfo?.wanLanPortSettings ?? [];
  return (
    <Stack spacing={2}>
      <ResponsiveList
        rows={configured}
        keyOf={(p) => p.portUuid}
        emptyText="No WAN port is configured."
        columns={[
          { header: 'Port', render: (p) => p.portName ?? '—' },
          { header: 'Connection', render: (p) => (p.wanPortIpv4Setting?.proto ?? '—').toUpperCase() },
          { header: 'MTU', render: (p) => text(p.wanPortIpv4Setting?.ipv4Dhcp?.mtu), hideOnMobile: true },
          { header: 'VLAN', render: (p) => p.wanPortIpv4Setting?.vlanId || '—', hideOnMobile: true },
          { header: 'IPv6', render: (p) => onOff(p.wanPortIpv6Setting?.enable) },
        ]}
      />
      {ports.length > 0 && (
        <SectionCard title="Gateway ports" subtitle="Port roles on the gateway model this site is planned for.">
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {ports.map((p) => (
              <Chip key={p.portUuid} size="small" variant="outlined" label={p.portName} />
            ))}
          </Box>
        </SectionCard>
      )}
    </Stack>
  );
}

function SecurityTab({ siteId }: { siteId: string | undefined }) {
  const ips = useSetting<{ enable?: boolean }>(siteId, 'ips');
  const defense = useSetting<Record<string, unknown>>(siteId, 'firewall/attackdefense');
  const timeout = useSetting<Record<string, unknown>>(siteId, 'firewall/timeout');
  const alg = useSetting<Alg>(siteId, 'transmission/alg');
  const defenseOn = Object.entries(defense.data ?? {}).filter(([k, v]) => k.endsWith('Enable') && v === true).length;
  const defenseAll = Object.keys(defense.data ?? {}).filter((k) => k.endsWith('Enable')).length;

  return (
    <Stack spacing={2}>
      <ListSection<Row>
        siteId={siteId}
        resource="firewall/acls"
        params={{ type: 0 }}
        title="Gateway ACL rules"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No gateway ACL rules."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />
      <ListSection<Row>
        siteId={siteId}
        resource="firewall/urlfilterings"
        params={{ type: 'gateway' }}
        title="URL filtering"
        keyOf={(r, i) => text(r.id ?? i)}
        emptyText="No URL filtering rules."
        columns={[
          { header: 'Name', render: (r) => text(r.name) },
          { header: 'Status', render: (r) => onOff(r.status) },
        ]}
      />
      <SectionCard title="Protection">
        <Fact label="Intrusion prevention (IPS)">{ips.data ? onOff(ips.data.enable) : '—'}</Fact>
        <Fact label="Attack defense checks on">{defense.data ? `${defenseOn} of ${defenseAll}` : '—'}</Fact>
        <Fact label="SYN cookies">{timeout.data ? onOff(timeout.data.synCookies) : '—'}</Fact>
        <Fact label="Reply to broadcast ping">{timeout.data ? onOff(timeout.data.broadcastPing) : '—'}</Fact>
      </SectionCard>
      {alg.data && (
        <SectionCard title="Application layer gateways">
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {(['ftp', 'h323', 'pptp', 'sip', 'ipSec'] as const).map((k) => (
              <Chip
                key={k}
                size="small"
                variant="outlined"
                color={alg.data[k] ? 'success' : 'default'}
                label={`${k === 'ipSec' ? 'IPsec' : k.toUpperCase()} ${alg.data[k] ? 'on' : 'off'}`}
              />
            ))}
          </Box>
        </SectionCard>
      )}
    </Stack>
  );
}

const TABS = ['LAN', 'Internet', 'Routing & NAT', 'Security'] as const;

export default function NetworkPage() {
  const { siteId } = useSite();
  const [tab, setTab] = useState<(typeof TABS)[number]>('LAN');
  const status = useSetting<WanLanStatus>(siteId, 'wanlanstatus');

  return (
    <Stack spacing={2}>
      <PageTitle title="Network" subtitle="The wired network this site is configured for." />
      {status.data && !status.data.adoptedGateway && (
        <Alert severity="info">
          No gateway is adopted yet. This is the configuration the controller will push to one when it joins. Editing
          is not available here yet.
        </Alert>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
        {TABS.map((t) => (
          <Tab key={t} value={t} label={t} />
        ))}
      </Tabs>

      {tab === 'LAN' && (
        <Stack spacing={2}>
          <ListSection<LanNetwork>
            siteId={siteId}
            resource="lan/networks"
            title="Networks"
            keyOf={(n) => n.id}
            columns={[
              { header: 'Name', render: (n) => n.name ?? '—' },
              { header: 'VLAN', render: (n) => text(n.vlan) },
              { header: 'Gateway / subnet', render: (n) => text(n.gatewaySubnet) },
              {
                header: 'DHCP',
                render: (n) =>
                  n.dhcpSettings?.enable ? `${n.dhcpSettings.ipaddrStart} – ${n.dhcpSettings.ipaddrEnd}` : 'Off',
              },
              { header: 'Purpose', render: (n) => text(n.purpose), hideOnMobile: true },
            ]}
          />
          <ListSection<PortProfile>
            siteId={siteId}
            resource="lan/profiles"
            title="Switch port profiles"
            keyOf={(p) => p.id}
            columns={[
              { header: 'Name', render: (p) => p.name ?? '—' },
              { header: 'Tagged networks', render: (p) => p.tagNetworkIds?.length ?? 0 },
              { header: 'Spanning tree', render: (p) => onOff(p.spanningTreeEnable) },
              { header: 'Loopback detection', render: (p) => onOff(p.loopbackDetectEnable), hideOnMobile: true },
              { header: 'Port isolation', render: (p) => onOff(p.portIsolationEnable), hideOnMobile: true },
            ]}
          />
        </Stack>
      )}

      {tab === 'Internet' && <WanTab siteId={siteId} />}

      {tab === 'Routing & NAT' && (
        <Stack spacing={2}>
          <ListSection<Row>
            siteId={siteId}
            resource="transmission/portForwardings"
            title="Port forwarding"
            keyOf={(r, i) => text(r.id ?? i)}
            emptyText="No port forwarding rules."
            columns={[
              { header: 'Name', render: (r) => text(r.name) },
              { header: 'Status', render: (r) => onOff(r.status) },
            ]}
          />
          <ListSection<Row>
            siteId={siteId}
            resource="transmission/staticRoutings"
            title="Static routes"
            keyOf={(r, i) => text(r.id ?? i)}
            emptyText="No static routes."
            columns={[
              { header: 'Name', render: (r) => text(r.name) },
              { header: 'Status', render: (r) => onOff(r.status) },
            ]}
          />
          <ListSection<Row>
            siteId={siteId}
            resource="transmission/policyRoutings"
            title="Policy routes"
            keyOf={(r, i) => text(r.id ?? i)}
            emptyText="No policy routes."
            columns={[
              { header: 'Name', render: (r) => text(r.name) },
              { header: 'Status', render: (r) => onOff(r.status) },
            ]}
          />
        </Stack>
      )}

      {tab === 'Security' && <SecurityTab siteId={siteId} />}
    </Stack>
  );
}

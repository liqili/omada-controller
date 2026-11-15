import { useMemo, useState } from 'react';
import { Alert, Chip, CircularProgress, Link, Stack, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useClients } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContext';
import { ResponsiveList, type Column } from '../components/ResponsiveList';
import type { Client } from '../api/types';
import { clientUplink } from './clientFormat';

function formatRate(kbps?: number): string {
  if (!kbps) return '—';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} Kbps`;
}

export default function ClientsPage() {
  const { siteId } = useSite();
  const { data: clients = [], isLoading, error } = useClients(siteId);
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () =>
      clients.filter(
        (c) =>
          !search ||
          [c.name, c.hostname, c.mac, c.ip, c.ssid, clientUplink(c).text].some((v) =>
            v?.toLowerCase().includes(search.toLowerCase()),
          ),
      ),
    [clients, search],
  );

  const columns: Column<Client>[] = [
    { header: 'Name', render: (c) => c.name ?? c.hostname ?? '—' },
    { header: 'MAC', render: (c) => c.mac, hideOnMobile: true },
    { header: 'IP', render: (c) => c.ip ?? '—' },
    { header: 'Connection', render: (c) => c.ssid ?? (c.type === 0 ? 'Wired' : 'Wireless') },
    {
      header: 'AP/Port',
      render: (c) => {
        // Links to the AP / switch / gateway, as the legacy grid's device button does.
        const { text, deviceMac } = clientUplink(c);
        return deviceMac ? (
          <Link component={RouterLink} to={`/devices/${deviceMac}`} underline="hover">
            {text}
          </Link>
        ) : (
          text
        );
      },
    },
    { header: 'RX', render: (c) => formatRate(c.rxRate) },
    { header: 'TX', render: (c) => formatRate(c.txRate), hideOnMobile: true },
    {
      header: 'State',
      render: (c) =>
        c.blocked ? <Chip label="Blocked" color="error" size="small" /> : c.authorized === false ? <Chip label="Unauthorized" color="warning" size="small" /> : <Chip label="Active" color="success" size="small" />,
    },
  ];

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert severity="error">{(error as Error).message}</Alert>;

  return (
    <Stack spacing={2}>
      <TextField
        size="small"
        placeholder="Search name / MAC / IP / SSID / AP"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
      />
      <ResponsiveList rows={rows} columns={columns} keyOf={(c) => c.mac} emptyText="No active clients" />
    </Stack>
  );
}

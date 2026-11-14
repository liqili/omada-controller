import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { useDevices, usePendingDevices, useAdoptMany } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContext';
import { DeviceStatusChip, deviceStatus } from '../components/StatusChip';
import { ResponsiveList, type Column } from '../components/ResponsiveList';
import { AddDevicesDialog } from '../components/AddDevicesDialog';
import type { Device } from '../api/types';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ap', label: 'Access Points' },
  { key: 'switch', label: 'Switches' },
  { key: 'gateway', label: 'Gateways' },
];

export default function DevicesPage() {
  const { siteId } = useSite();
  const { data: devices = [], isLoading, error } = useDevices(siteId);
  const pending = usePendingDevices();
  const adoptMany = useAdoptMany(siteId);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'adopted' | 'pending'>('adopted');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const navigate = useNavigate();

  const pendingDevices = pending.data?.data ?? [];

  const rows = useMemo(
    () =>
      devices.filter(
        (d) =>
          (filter === 'all' || d.type === filter) &&
          (!search ||
            [d.name, d.mac, d.model, d.showModel, d.ip].some((v) =>
              v?.toLowerCase().includes(search.toLowerCase()),
            )),
      ),
    [devices, filter, search],
  );

  const pendingRows = useMemo(
    () =>
      pendingDevices.filter(
        (d) =>
          !search ||
          [d.name, d.mac, d.model, d.showModel, d.ip].some((v) =>
            v?.toLowerCase().includes(search.toLowerCase()),
          ),
      ),
    [pendingDevices, search],
  );

  const toggleCheck = (m: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  const adoptMacs = (macs: string[]) =>
    adoptMany.mutate(macs, {
      onSuccess: () => {
        setChecked(new Set());
        setToast(`Adoption requested for ${macs.length} device(s).`);
      },
      onError: (e) => setToast((e as Error).message),
    });

  const columns: Column<Device>[] = [
    { header: 'Name', render: (d) => d.name ?? d.mac },
    { header: 'Type', render: (d) => <Chip label={d.type} size="small" /> },
    { header: 'Model', render: (d) => d.showModel ?? d.model ?? '—', hideOnMobile: true },
    { header: 'IP', render: (d) => d.ip ?? '—' },
    { header: 'Status', render: (d) => <DeviceStatusChip status={d.status} statusCategory={d.statusCategory} /> },
    { header: 'Firmware', render: (d) => d.firmwareVersion ?? d.version ?? '—', hideOnMobile: true },
  ];

  const pendingColumns: Column<Device>[] = [
    {
      header: '',
      render: (d) => (
        <Checkbox
          size="small"
          checked={checked.has(d.mac)}
          onChange={() => toggleCheck(d.mac)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    { header: 'Name', render: (d) => d.name ?? d.mac },
    { header: 'MAC', render: (d) => d.mac },
    { header: 'Model', render: (d) => d.showModel ?? d.model ?? '—', hideOnMobile: true },
    { header: 'IP', render: (d) => d.ip ?? '—' },
    { header: 'Status', render: (d) => <DeviceStatusChip status={d.status} statusCategory={d.statusCategory} /> },
    {
      header: 'Action',
      render: (d) => (
        <Button
          size="small"
          variant="contained"
          disabled={adoptMany.isPending || deviceStatus(d.status, d.statusCategory).transient}
          onClick={(e) => {
            e.stopPropagation();
            adoptMacs([d.mac]);
          }}
        >
          {d.status === 24 || d.status === 25 ? 'Retry' : 'Adopt'}
        </Button>
      ),
    },
  ];

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{(error as Error).message}</Alert>}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', flexGrow: 1 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab value="adopted" label={`Adopted (${devices.length})`} />
            <Tab value="pending" label={`Pending (${pendingRows.length})`} />
          </Tabs>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add
        </Button>
      </Box>
      <TextField
        size="small"
        placeholder="Search name / MAC / model / IP"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
      />

      {tab === 'adopted' && (
        <>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', overflowX: 'auto' }}>
            <Tabs value={filter} onChange={(_, v) => setFilter(v)}>
              {FILTERS.map((f) => (
                <Tab key={f.key} value={f.key} label={f.label} />
              ))}
            </Tabs>
          </Box>
          <ResponsiveList
            rows={rows}
            columns={columns}
            keyOf={(d) => d.mac}
            onClickRow={(d) => navigate(`/devices/${d.mac}`)}
            emptyText="No devices match"
          />
        </>
      )}

      {tab === 'pending' && (
        <>
          {pending.error && <Alert severity="error">{(pending.error as Error).message}</Alert>}
          {checked.size > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                {checked.size} selected
              </Typography>
              <Button size="small" variant="contained" disabled={adoptMany.isPending} onClick={() => adoptMacs([...checked])}>
                Adopt selected
              </Button>
            </Box>
          )}
          <ResponsiveList
            rows={pendingRows}
            columns={pendingColumns}
            keyOf={(d) => d.mac}
            emptyText="No devices pending adoption — click Add to scan, or a device joins this list when it discovers the controller on the LAN."
          />
        </>
      )}

      <AddDevicesDialog open={addOpen} onClose={() => setAddOpen(false)} />

      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Stack>
  );
}

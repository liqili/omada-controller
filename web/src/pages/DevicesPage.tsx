import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { useDevices, usePendingDevices, useAdoptMany, useDeviceCmd, useConfigResultDevices } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContext';
import { DeviceStatusChip, deviceCommandable, deviceStatus } from '../components/StatusChip';
import { ResponsiveList, type Column } from '../components/ResponsiveList';
import { AddDevicesDialog } from '../components/AddDevicesDialog';
import { useAdoptFlow } from '../components/AdoptFlow';
import { ConfigResultsPanel } from './ConfigResultsPanel';
import { CONFIG_STATUS } from '../api/domains/configResult';
import type { Device } from '../api/types';

// Same key as the Configuration Results panel's first page, so the tab count costs no extra request.
const CONFIG_FIRST_PAGE = { status: CONFIG_STATUS.FAIL, deviceType: 'all', page: 1, pageSize: 10 } as const;

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
  const cmd = useDeviceCmd(siteId);
  const [confirmReboot, setConfirmReboot] = useState<Device | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'adopted' | 'pending' | 'config'>('adopted');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const navigate = useNavigate();

  const pendingDevices = pending.data?.data ?? [];
  const configStat = useConfigResultDevices(siteId, CONFIG_FIRST_PAGE).data?.statistic;
  const configIssues =
    configStat && [configStat.fail, configStat.preConfig, configStat.alert].some((v) => typeof v === 'number')
      ? (configStat.fail ?? 0) + (configStat.preConfig ?? 0) + (configStat.alert ?? 0)
      : undefined;

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

  const adoptFlow = useAdoptFlow(
    async (list, account) => {
      await adoptMany.mutateAsync({ devices: list, account });
      setChecked(new Set());
      setToast(`Adoption requested for ${list.length} device(s).`);
    },
    (e) => setToast((e as Error).message),
  );
  const adoptMacs = (macs: string[]) => adoptFlow.start(pendingDevices.filter((d) => macs.includes(d.mac)));

  // Locate toggles, as in the legacy UI: a device already flashing (locateEnable) gets {locateEnable:false}.
  const runCmd = (d: Device, c: 'locate' | 'reboot') => {
    const stop = c === 'locate' && Boolean(d.locateEnable);
    const name = d.name ?? d.mac;
    const done = c === 'reboot' ? `Reboot requested for ${name}.` : stop ? `${name} stopped flashing its LED.` : `${name} is flashing its LED.`;
    cmd.mutate(
      { mac: d.mac, cmd: c, ...(c === 'locate' ? { enable: !stop } : {}) },
      {
        onSuccess: () => setToast(done),
        onError: (e) => setToast((e as Error).message),
      },
    );
  };

  const columns: Column<Device>[] = [
    { header: 'Name', render: (d) => d.name ?? d.mac },
    { header: 'Type', render: (d) => <Chip label={d.type} size="small" /> },
    { header: 'Model', render: (d) => d.showModel ?? d.model ?? '—', hideOnMobile: true },
    { header: 'IP', render: (d) => d.ip ?? '—' },
    { header: 'Status', render: (d) => <DeviceStatusChip status={d.status} statusCategory={d.statusCategory} /> },
    { header: 'Firmware', render: (d) => d.firmwareVersion ?? d.version ?? '—', hideOnMobile: true },
    {
      header: 'Action',
      render: (d) => {
        const off = !deviceCommandable(d) || cmd.isPending;
        return (
          // stopPropagation: the row itself opens the device page.
          <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
            <Button size="small" disabled={off} onClick={() => runCmd(d, 'locate')}>
              {d.locateEnable ? 'Stop locating' : 'Locate'}
            </Button>
            <Button size="small" disabled={off} onClick={() => setConfirmReboot(d)}>
              Reboot
            </Button>
          </Box>
        );
      },
    },
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
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="adopted" label={`Adopted (${devices.length})`} />
            <Tab value="pending" label={`Pending (${pendingRows.length})`} />
            <Tab
              value="config"
              label={configIssues === undefined ? 'Configuration results' : `Configuration results (${configIssues})`}
            />
          </Tabs>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add
        </Button>
      </Box>
      {tab !== 'config' && (
        <TextField
          size="small"
          placeholder="Search name / MAC / model / IP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
        />
      )}

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

      {tab === 'config' && <ConfigResultsPanel siteId={siteId} />}

      <AddDevicesDialog open={addOpen} onClose={() => setAddOpen(false)} />
      {adoptFlow.dialog}

      <Dialog open={Boolean(confirmReboot)} onClose={() => setConfirmReboot(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reboot {confirmReboot?.name ?? confirmReboot?.mac}?</DialogTitle>
        <DialogContent>
          <DialogContentText>The device goes offline for a few minutes and its clients are disconnected meanwhile.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmReboot(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (confirmReboot) runCmd(confirmReboot, 'reboot');
              setConfirmReboot(null);
            }}
          >
            Reboot
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Stack>
  );
}

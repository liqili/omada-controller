import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePendingDevices, useAdoptMany } from '../hooks/queries';
import { useSites } from '../hooks/useSiteContextBridge';
import { useSite } from '../hooks/useSiteContext';
import { DeviceStatusChip } from './StatusChip';
import { ResponsiveList, type Column } from './ResponsiveList';
import type { Device } from '../api/types';

// Mirrors the legacy "Add Devices" dialog: pick a target site, filter by
// category (live counts from the pending grid's deviceStat), refresh to
// re-detect, then check rows and Apply to adopt them in one batch.

type Cat = 'all' | 'switch' | 'ap' | 'olt';

const inCat = (d: Device, c: Cat) => {
  if (c === 'all') return true;
  if (c === 'ap') return d.type === 'ap';
  if (c === 'olt') return d.type === 'olt';
  // Gateway/Switches
  return d.type === 'switch' || d.type === 'gateway' || d.type === 'router';
};

export function AddDevicesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { siteId } = useSite();
  const { data: sites = [] } = useSites();
  const pending = usePendingDevices();
  const adoptMany = useAdoptMany(siteId);

  const [target, setTarget] = useState(siteId ?? '');
  const [cat, setCat] = useState<Cat>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setChecked(new Set());
      setTarget(siteId ?? '');
      adoptMany.reset();
      pending.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId]);

  const devices = pending.data?.data ?? [];
  const stat = pending.data?.deviceStat ?? {};
  const rows = useMemo(() => devices.filter((d) => inCat(d, cat)), [devices, cat]);

  const tabs: { key: Cat; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stat.allDevices ?? devices.length },
    { key: 'switch', label: 'Gateway/Switches', count: stat.allSwitchsAndGateway ?? 0 },
    { key: 'ap', label: 'APs', count: stat.allAps ?? 0 },
    { key: 'olt', label: 'OLTs', count: stat.allOlts ?? 0 },
  ];

  const toggle = (mac: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      n.has(mac) ? n.delete(mac) : n.add(mac);
      return n;
    });

  const allChecked = rows.length > 0 && rows.every((d) => checked.has(d.mac));
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (allChecked) rows.forEach((d) => n.delete(d.mac));
      else rows.forEach((d) => n.add(d.mac));
      return n;
    });

  const columns: Column<Device>[] = [
    {
      header: '',
      render: (d) => (
        <Checkbox
          size="small"
          checked={checked.has(d.mac)}
          onChange={() => toggle(d.mac)}
          onClick={(e) => e.stopPropagation()}
          inputProps={{ 'aria-label': `Select ${d.name ?? d.mac}` }}
        />
      ),
    },
    { header: 'Device Name', render: (d) => d.name ?? '—' },
    { header: 'Status', render: (d) => <DeviceStatusChip status={d.status} statusCategory={d.statusCategory} /> },
    { header: 'IP Address', render: (d) => d.ip ?? '—' },
    { header: 'MAC Address', render: (d) => d.mac },
    { header: 'Model', render: (d) => d.showModel ?? d.model ?? '—', hideOnMobile: true },
    { header: 'Version', render: (d) => d.firmwareVersion ?? d.version ?? '—', hideOnMobile: true },
  ];

  const adopt = () =>
    adoptMany.mutate([...checked], {
      onSuccess: () => {
        setChecked(new Set());
        pending.refetch();
      },
    });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Add Devices
        <IconButton size="small" onClick={onClose} aria-label="close">
          <Typography>×</Typography>
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          For Switches, only the Switch Type supported by the currently selected site will be
          adopted. You can edit the Switch Type in the Site List.
        </Alert>

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
            Add to Site
          </Typography>
          <Select
            size="small"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={adoptMany.isPending}
            sx={{ minWidth: 220 }}
          >
            {sites.map((s) => (
              <MenuItem key={s._id} value={s._id}>
                {s.name}
              </MenuItem>
            ))}
          </Select>
        </Stack>

        <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ flexGrow: 1, overflowX: 'auto' }}>
            <Tabs value={cat} onChange={(_, v) => setCat(v)} variant="scrollable" scrollButtons="auto">
              {tabs.map((t) => (
                <Tab key={t.key} value={t.key} label={`${t.label} (${t.count})`} />
              ))}
            </Tabs>
          </Box>
          <Tooltip title="Re-scan for devices">
            <IconButton size="small" onClick={() => pending.refetch()} disabled={pending.isFetching}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ mt: 1, minHeight: 160 }}>
          {pending.isLoading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : pending.error ? (
            <Alert severity="error">{(pending.error as Error).message}</Alert>
          ) : rows.length ? (
            <ResponsiveList
              rows={rows}
              columns={columns}
              keyOf={(d) => d.mac}
              emptyText="No entry in the table."
            />
          ) : (
            <Alert severity="info">No entry in the table.</Alert>
          )}
          {rows.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              <Checkbox
                size="small"
                checked={allChecked}
                indeterminate={checked.size > 0 && !allChecked}
                onChange={toggleAll}
                inputProps={{ 'aria-label': 'Select all devices' }}
              />
              <Typography component="span" variant="caption" color="text.secondary">
                {checked.size} selected
              </Typography>
            </Box>
          )}
          {adoptMany.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(adoptMany.error as Error).message}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          disabled={checked.size === 0 || adoptMany.isPending || !target}
          onClick={adopt}
        >
          {adoptMany.isPending ? 'Adopting…' : 'Apply'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

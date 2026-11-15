import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { Link as RouterLink } from 'react-router-dom';
import { useConfigComponents, useConfigFeatures, useConfigResultDevices, useReapplyConfig } from '../hooks/queries';
import {
  CONFIG_STATUS,
  type ConfigDeviceType,
  type ConfigFeature,
  type ConfigResultDevice,
  type ConfigStatus,
} from '../api/domains/configResult';
import {
  STATUS_EXPLANATION,
  capabilityText,
  componentColumns,
  configDeviceName,
  configSearch,
  failReason,
  featureColumns,
  featureLocation,
  featureName,
  operationText,
  timeText,
} from './configResultFormat';

const PAGE_SIZE = 10;

const STATUSES: { value: ConfigStatus; label: string; count: 'fail' | 'preConfig' | 'alert'; color: string }[] = [
  { value: CONFIG_STATUS.FAIL, label: 'Failed', count: 'fail', color: 'error.main' },
  { value: CONFIG_STATUS.PRECONFIG, label: 'Preconfigure', count: 'preConfig', color: 'warning.main' },
  { value: CONFIG_STATUS.ALERT, label: 'Incompatible', count: 'alert', color: 'info.main' },
];

/**
 * Devices → Configuration Results, after the vendor page: which settings a
 * device failed to apply, could only pre-configure, or can't run on its firmware.
 */
export function ConfigResultsPanel({ siteId }: { siteId: string | undefined }) {
  const [status, setStatus] = useState<ConfigStatus>(CONFIG_STATUS.FAIL);
  const [deviceType, setDeviceType] = useState<ConfigDeviceType>('all');
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [selectedMac, setSelectedMac] = useState<string | null>(null);

  // Search as the user pauses typing; a new search starts on page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const query = useMemo(
    () => ({ status, deviceType, page, pageSize: PAGE_SIZE, ...configSearch(search) }),
    [status, deviceType, page, search],
  );
  const grid = useConfigResultDevices(siteId, query);
  const rows = grid.data?.rows ?? [];
  const stat = grid.data?.statistic ?? {};
  const pages = Math.max(1, Math.ceil((grid.data?.total ?? 0) / PAGE_SIZE));

  // Keep the selected device while it is listed, else select the first one (vendor behaviour).
  const selected = rows.find((d) => d.mac === selectedMac) ?? rows[0];

  const n = (v?: number) => (typeof v === 'number' ? ` (${v})` : '');

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v: ConfigStatus | null) => {
            if (v === null) return;
            setStatus(v);
            setPage(1);
          }}
        >
          {STATUSES.map((s) => (
            <ToggleButton key={s.value} value={s.value} sx={{ textTransform: 'none', gap: 0.75 }}>
              <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color }} />
              {s.label}
              {n(stat[s.count])}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={deviceType}
          onChange={(_, v: ConfigDeviceType | null) => {
            if (v === null) return;
            setDeviceType(v);
            setPage(1);
          }}
        >
          <ToggleButton value="all" sx={{ textTransform: 'none' }}>
            All
            {typeof stat.osgAndOsw === 'number' || typeof stat.ap === 'number' ? ` (${(stat.osgAndOsw ?? 0) + (stat.ap ?? 0)})` : ''}
          </ToggleButton>
          <ToggleButton value="gatewaySwitch" sx={{ textTransform: 'none' }}>
            Gateways & switches{n(stat.osgAndOsw)}
          </ToggleButton>
          <ToggleButton value="ap" sx={{ textTransform: 'none' }}>
            APs{n(stat.ap)}
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Device name or MAC"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 180 }}
        />
      </Box>

      {STATUS_EXPLANATION[status] && (
        <Alert severity="info" variant="outlined">
          {STATUS_EXPLANATION[status]}
        </Alert>
      )}
      {grid.error && <Alert severity="error">{(grid.error as Error).message}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' }, gap: 2 }}>
        <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 120 }}>
          {grid.isLoading ? (
            <CircularProgress size={24} sx={{ m: 'auto', my: 3 }} />
          ) : rows.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              No devices in this state.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ flexGrow: 1 }}>
              {rows.map((d) => (
                <ListItemButton key={d.mac} selected={d.mac === selected?.mac} onClick={() => setSelectedMac(d.mac)}>
                  <ListItemText
                    primary={configDeviceName(d)}
                    secondary={[d.mac, d.model].filter(Boolean).join(' · ')}
                    primaryTypographyProps={{ fontWeight: 600, noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
          {pages > 1 && (
            <Pagination
              size="small"
              count={pages}
              page={page}
              onChange={(_, p) => setPage(p)}
              sx={{ alignSelf: 'center', py: 1 }}
            />
          )}
        </Paper>

        {selected ? <DeviceConfigDetail siteId={siteId} device={selected} status={status} /> : null}
      </Box>
    </Stack>
  );
}

function DeviceConfigDetail({
  siteId,
  device,
  status,
}: {
  siteId: string | undefined;
  device: ConfigResultDevice;
  status: ConfigStatus;
}) {
  const features = useConfigFeatures(siteId, device, status);
  const reapply = useReapplyConfig(siteId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const cols = featureColumns(status);

  useEffect(() => {
    setExpanded(new Set());
    setDone(null);
  }, [device.mac, status]);

  const toggle = (f: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const list = features.data ?? [];
  const colCount = 2 + Number(cols.operation) + Number(cols.time) + Number(cols.capability) + Number(cols.reason);

  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Link component={RouterLink} to={`/devices/${device.mac}`} variant="subtitle1" fontWeight={600} underline="hover">
            {configDeviceName(device)}
          </Link>
          <Typography variant="body2" color="text.secondary">
            {device.mac} · UI configuration
          </Typography>
        </Box>
        {device.needFullSync && device.supportConfigSync ? (
          <Button size="small" variant="outlined" disabled={reapply.isPending} onClick={() => setConfirm(true)}>
            {reapply.isPending ? 'Applying…' : 'Apply again'}
          </Button>
        ) : null}
      </Box>
      {done && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {reapply.error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {(reapply.error as Error).message}
        </Alert>
      )}
      {features.error && <Alert severity="error">{(features.error as Error).message}</Alert>}

      {features.isLoading ? (
        <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 3 }} />
      ) : list.length === 0 && !features.error ? (
        <Typography color="text.secondary">No features in this state for this device.</Typography>
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Feature</TableCell>
                {cols.operation && <TableCell>Action</TableCell>}
                {cols.capability && <TableCell>Capability description</TableCell>}
                {cols.time && <TableCell>Time</TableCell>}
                {cols.reason && <TableCell>Failure cause</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((f) => (
                <FeatureRow
                  key={f.feature}
                  feature={f}
                  status={status}
                  open={expanded.has(f.feature)}
                  onToggle={() => toggle(f.feature)}
                  colCount={colCount}
                  siteId={siteId}
                  mac={device.mac}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Apply the configuration again?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The controller regenerates the full configuration of {configDeviceName(device)} and applies it. This may cause
            configuration loss on the device; incompatible settings still won't be applied, and some features may briefly
            disconnect the device.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirm(false);
              reapply.mutate(device.mac, { onSuccess: () => setDone('Configuration sent to the device again.') });
            }}
          >
            Apply again
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function FeatureRow({
  feature: f,
  status,
  open,
  onToggle,
  colCount,
  siteId,
  mac,
}: {
  feature: ConfigFeature;
  status: ConfigStatus;
  open: boolean;
  onToggle: () => void;
  colCount: number;
  siteId: string | undefined;
  mac: string;
}) {
  const cols = featureColumns(status);
  const where = featureLocation(f.uiPosition);
  const name = (
    <span>
      {featureName(f)}
      {f.expandable && typeof f.featureItemSum === 'number' ? ` (${f.featureItemSum})` : ''}
    </span>
  );
  return (
    <Fragment>
      <TableRow hover sx={{ '& > td': { verticalAlign: 'top' } }}>
        <TableCell padding="checkbox">
          {f.expandable ? (
            <IconButton size="small" aria-label={open ? 'Collapse' : 'Expand'} onClick={onToggle}>
              {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </TableCell>
        <TableCell>{where ? <Tooltip title={`Set in: ${where}`}>{name}</Tooltip> : name}</TableCell>
        {cols.operation && <TableCell>{operationText(f.operationList)}</TableCell>}
        {cols.capability && <TableCell sx={{ wordBreak: 'break-word' }}>{capabilityText(f)}</TableCell>}
        {cols.time && <TableCell sx={{ whiteSpace: 'nowrap' }}>{timeText(f.timeList)}</TableCell>}
        {cols.reason && (
          <TableCell sx={{ wordBreak: 'break-word' }}>{failReason(f.uiErrorCodeList, f.uiErrorMsgList, status)}</TableCell>
        )}
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={colCount} sx={{ bgcolor: 'action.hover', py: 1 }}>
            <FeatureComponents siteId={siteId} mac={mac} feature={f.feature} status={status} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function FeatureComponents({
  siteId,
  mac,
  feature,
  status,
}: {
  siteId: string | undefined;
  mac: string;
  feature: string;
  status: ConfigStatus;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const q = useConfigComponents(siteId, mac, { feature, status, page: page + 1, pageSize });
  const cols = componentColumns(status);
  const rows = q.data?.rows ?? [];

  if (q.isLoading) return <CircularProgress size={20} sx={{ display: 'block', mx: 'auto', my: 1 }} />;
  if (q.error) return <Alert severity="error">{(q.error as Error).message}</Alert>;
  if (!rows.length) return <Typography variant="body2" color="text.secondary">No items.</Typography>;
  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            {cols.operation && <TableCell>Action</TableCell>}
            {cols.time && <TableCell>Time</TableCell>}
            {cols.capability && <TableCell>Capability description</TableCell>}
            {cols.reason && <TableCell>Failure cause</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((c, i) => (
            <TableRow key={c.component ? `${c.component}-${c.name ?? i}` : i}>
              <TableCell sx={{ wordBreak: 'break-word' }}>{c.name || '—'}</TableCell>
              {cols.operation && <TableCell>{operationText(c.operation)}</TableCell>}
              {cols.time && <TableCell sx={{ whiteSpace: 'nowrap' }}>{timeText(c.time)}</TableCell>}
              {cols.capability && (
                <TableCell sx={{ wordBreak: 'break-word' }}>
                  {c.notSupportInfo || capabilityText(c) !== '—'
                    ? capabilityText(c)
                    : failReason(c.uiErrorCode, c.uiErrorMsg, status)}
                </TableCell>
              )}
              {cols.reason && (
                <TableCell sx={{ wordBreak: 'break-word' }}>{failReason(c.uiErrorCode, c.uiErrorMsg, status)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(q.data?.total ?? 0) > pageSize && (
        <TablePagination
          component="div"
          count={q.data?.total ?? 0}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[5, 10, 20, 50]}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
        />
      )}
    </>
  );
}

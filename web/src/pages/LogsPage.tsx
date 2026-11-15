import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSite } from '../hooks/useSiteContextBridge';
import { useLogNums, useLogs } from '../hooks/queries';
import { LOG_LEVELS, LOG_MODULES, logText, type LogEntry, type LogKind } from '../api/domains/logs';
import { ResponsiveList } from '../components/ResponsiveList';
import { PageTitle, apiErrorText } from '../components/SettingsKit';

// Alerts and events for the selected site (see api/domains/logs.ts — the
// controller requires an explicit time window on both lists).

const RANGES = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 24 * 7, label: 'Last 7 days' },
  { hours: 24 * 30, label: 'Last 30 days' },
];

const LEVEL_COLOR: Record<string, 'error' | 'warning' | 'info'> = {
  Critical: 'error',
  Error: 'error',
  Warning: 'warning',
  Information: 'info',
};

const PAGE_SIZE = 50;

export default function LogsPage() {
  const { siteId } = useSite();
  const [kind, setKind] = useState<LogKind>('alerts');
  // 30 days, as the legacy logs page opens (its first request spans exactly 30 days).
  const [hours, setHours] = useState(RANGES[2].hours);
  const [level, setLevel] = useState('');
  const [module, setModule] = useState('');
  // Alerts only; the vendor page opens on unresolved ones.
  const [resolved, setResolved] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // The window is anchored when the filters change or Refresh is pressed, so
  // the query key stays stable between renders.
  const [anchor, setAnchor] = useState(() => Date.now());

  const query = useMemo(
    () => ({
      timeStart: anchor - hours * 3600_000,
      timeEnd: anchor,
      level: level || undefined,
      module: module || undefined,
      search: search || undefined,
      resolved,
      page,
      pageSize: PAGE_SIZE,
    }),
    [anchor, hours, level, module, search, resolved, page],
  );
  const logs = useLogs(siteId, kind, query);
  const nums = useLogNums();
  const total = logs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refilter = (apply: () => void) => {
    apply();
    setPage(1);
    setAnchor(Date.now());
  };

  return (
    <Stack spacing={2}>
      <PageTitle
        title="Logs"
        subtitle={
          nums.data?.limitNum
            ? `${nums.data.totalNum.toLocaleString()} of ${nums.data.limitNum.toLocaleString()} log entries stored`
            : undefined
        }
        action={
          <Button startIcon={<RefreshIcon />} onClick={() => refilter(() => undefined)} disabled={logs.isFetching}>
            Refresh
          </Button>
        }
      />

      <Tabs value={kind} onChange={(_, v) => refilter(() => setKind(v))}>
        <Tab value="alerts" label="Alerts" />
        <Tab value="events" label="Events" />
      </Tabs>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          refilter(() => setSearch(searchInput.trim()));
        }}
        sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${kind === 'alerts' ? 5 : 4}, minmax(0, 1fr))` } }}
      >
        {kind === 'alerts' && (
          <TextField
            select
            size="small"
            label="Status"
            value={resolved ? 'resolved' : 'unresolved'}
            onChange={(e) => refilter(() => setResolved(e.target.value === 'resolved'))}
          >
            <MenuItem value="unresolved">Unresolved</MenuItem>
            <MenuItem value="resolved">Resolved</MenuItem>
          </TextField>
        )}
        <TextField select size="small" label="Period" value={hours} onChange={(e) => refilter(() => setHours(Number(e.target.value)))}>
          {RANGES.map((r) => (
            <MenuItem key={r.hours} value={r.hours}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Level" value={level} onChange={(e) => refilter(() => setLevel(e.target.value))}>
          <MenuItem value="">All levels</MenuItem>
          {LOG_LEVELS.map((l) => (
            <MenuItem key={l} value={l}>
              {l}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Source" value={module} onChange={(e) => refilter(() => setModule(e.target.value))}>
          <MenuItem value="">All sources</MenuItem>
          {LOG_MODULES.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          helperText="Press Enter to search"
        />
      </Box>

      {logs.isLoading && <CircularProgress sx={{ mx: 'auto' }} />}
      {logs.error && <Alert severity="error">{apiErrorText(logs.error)}</Alert>}
      {logs.data && (
        <ResponsiveList<LogEntry>
          rows={logs.data.rows}
          keyOf={(l) => l.id ?? `${l.time}-${l.key}`}
          emptyText={kind === 'alerts' ? 'No alerts in this period.' : 'No events in this period.'}
          columns={[
            { header: 'Message', render: (l) => logText(l) || '—' },
            { header: 'Time', render: (l) => (l.time ? new Date(l.time).toLocaleString() : '—') },
            {
              header: 'Level',
              render: (l) =>
                l.level ? (
                  <Chip size="small" variant="outlined" color={LEVEL_COLOR[l.level] ?? 'default'} label={l.level} />
                ) : (
                  '—'
                ),
            },
            { header: 'Source', render: (l) => l.module ?? '—', hideOnMobile: true },
          ]}
        />
      )}

      {total > PAGE_SIZE && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Typography variant="body2" color="text.secondary">
            Page {page} of {pages}
          </Typography>
          <Button size="small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </Box>
      )}
    </Stack>
  );
}

import { Suspense, lazy, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDevice, useDeviceCmd, useForgetDevice } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContext';
import { DeviceStatusChip, deviceCommandable, deviceStatus } from '../components/StatusChip';
import { Fact, SectionCard, Toast, apiErrorText } from '../components/SettingsKit';
import type { DeviceCommand } from '../api/domains/device';
import { DetailSections, RadioUtilization } from './device/DetailSections';

// Loaded on first use: the terminal pulls in xterm.js (~300 kB).
const ApConfigPanel = lazy(() => import('./device/ApConfigPanel'));
const FirmwarePanel = lazy(() => import('./device/FirmwarePanel'));
const TerminalPanel = lazy(() => import('./device/TerminalPanel'));

type TabKey = 'overview' | 'config' | 'advanced' | 'terminal';

const COMMAND_LABEL: Record<DeviceCommand, string> = {
  forceProvision: 'Provision requested',
  reboot: 'Reboot requested',
  locate: 'Locate LED flashing',
};

export default function DeviceDetailPage() {
  const { mac } = useParams<{ mac: string }>();
  const { siteId } = useSite();
  const navigate = useNavigate();
  const { data: device, isLoading, error } = useDevice(siteId, mac);
  const cmd = useDeviceCmd(siteId);
  const forget = useForgetDevice(siteId);
  const [confirmForget, setConfirmForget] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert severity="error">{apiErrorText(error)}</Alert>;
  if (!device) return <Alert severity="info">Device not found.</Alert>;

  const state = deviceStatus(device.status, device.statusCategory);
  const connected = deviceCommandable(device);
  const run = (c: DeviceCommand) =>
    cmd.mutate({ mac: device.mac, cmd: c }, { onSuccess: () => setToast(COMMAND_LABEL[c]) });
  const broadcast = device.simBroadcast;
  const isAp = device.type === 'ap';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Details' },
    ...(isAp ? [{ key: 'config' as const, label: 'Configuration' }] : []),
    { key: 'advanced', label: 'Advanced' },
    { key: 'terminal', label: 'Terminal' },
  ];
  // ?tab=firmware is the Advanced tab's old name; keep old links working.
  const requested = (params.get('tab') === 'firmware' ? 'advanced' : params.get('tab')) as TabKey | null;
  const tab: TabKey = tabs.some((t) => t.key === requested) ? requested! : 'overview';
  // Config edits are allowed for any adopted AP, even offline: the
  // controller pushes them when it reconnects. Pending devices have none.
  const adopted = device.statusCategory !== 2;

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <Card>
        <CardContent>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h5" sx={{ mr: 0.5 }}>
                {device.name ?? device.mac}
              </Typography>
              <DeviceStatusChip status={device.status} statusCategory={device.statusCategory} />
              {device.simulated && <Chip size="small" color="secondary" label="Simulated" />}
              {state.transient && <CircularProgress size={16} />}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {[device.showModel ?? device.model, device.ip, device.name && device.name !== device.mac ? device.mac : undefined]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </Stack>
          {/* Channel utilization per radio, as at the top of the legacy drawer. */}
          {isAp && device.statusCategory === 1 && (
            <Box sx={{ mt: 2 }}>
              <RadioUtilization device={device} bare />
            </Box>
          )}
        </CardContent>
      </Card>

      <Tabs
        value={tab}
        onChange={(_e, v: TabKey) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {tabs.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      {/* Outside Suspense: the actions show at once while the firmware panel loads. */}
      {tab === 'advanced' && (
            <SectionCard title="Device actions">
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" disabled={!connected || cmd.isPending} onClick={() => run('forceProvision')}>
                  Force provision
                </Button>
                <Button size="small" color="error" onClick={() => setConfirmForget(true)}>
                  Forget
                </Button>
              </Box>
              {cmd.isError && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {apiErrorText(cmd.error)}
                </Alert>
              )}
            </SectionCard>
      )}

      <Suspense fallback={<CircularProgress sx={{ display: 'block', mx: 'auto', my: 3 }} />}>
        {tab === 'config' && siteId && adopted && <ApConfigPanel siteId={siteId} mac={device.mac} />}
        {tab === 'advanced' && siteId && <FirmwarePanel siteId={siteId} device={device} connected={connected} />}
        {tab === 'terminal' && siteId && <TerminalPanel siteId={siteId} device={device} connected={connected} />}
      </Suspense>

      {tab === 'overview' && <DetailSections device={device} connected={device.statusCategory === 1} />}

      {tab === 'overview' && isAp ? (
        <Card>
          <CardContent>
            <Typography variant="subtitle1">Broadcasting</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Wireless networks this access point is serving
              {device.wlanGroup ? ` from WLAN group “${device.wlanGroup}”` : ''}.
            </Typography>
            {broadcast?.length ? (
              <Stack spacing={0.75}>
                {broadcast.map((b) => (
                  <Fact key={b.bssid} label={b.ssid}>
                    {b.band} · {b.bssid}
                  </Fact>
                ))}
              </Stack>
            ) : device.bssids?.length ? (
              <Stack spacing={0.75}>
                {device.bssids.map((b) => (
                  <Fact key={b} label="BSSID">
                    {b}
                  </Fact>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Not broadcasting any network.
              </Typography>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'overview' && device.provision && (
        <Card>
          <CardContent>
            <Typography variant="subtitle1">Last configuration push</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {device.provision.at ? new Date(device.provision.at).toLocaleString() : '—'}
              {device.provision.reason ? ` · ${device.provision.reason}` : ''}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              {(device.provision.items ?? []).map((it) => (
                <Chip key={it} size="small" variant="outlined" label={it} />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmForget} onClose={() => setConfirmForget(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Forget {device.name ?? device.mac}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The device is reset to factory defaults and drops off this site. Its clients are disconnected.
          </DialogContentText>
          {forget.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {apiErrorText(forget.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmForget(false)} disabled={forget.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={forget.isPending}
            onClick={() => forget.mutate(device.mac, { onSuccess: () => navigate('/devices') })}
          >
            Forget
          </Button>
        </DialogActions>
      </Dialog>
      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

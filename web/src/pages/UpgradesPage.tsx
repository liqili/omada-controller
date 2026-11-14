import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useDevices, useFirmwares, useSetting, useSiteSetting } from '../hooks/queries';
import { ResponsiveList } from '../components/ResponsiveList';
import { DeviceStatusChip } from '../components/StatusChip';
import { Fact, PageTitle, SectionCard, apiErrorText, onOff } from '../components/SettingsKit';
import type { Device } from '../api/types';
import type { Firmware } from '../api/domains/admin';

// Firmware — read-only. Verified live on v5.15.6.7:
//   GET upgrade/firmwares (grid of uploaded files)
//   GET sites/{sid}/setting/service/scheduleUpgrade → {enable, repeat}
//   site setting autoUpgrade.enable (editable on the Site settings page)
// upgrade/overview|history|firmware/plans answer -1600 on this build.
export default function UpgradesPage() {
  const { siteId } = useSite();
  const devices = useDevices(siteId);
  const firmwares = useFirmwares();
  const site = useSiteSetting<{ autoUpgrade?: { enable?: boolean } }>(siteId);
  const schedule = useSetting<{ enable?: boolean; repeat?: boolean }>(siteId, 'service/scheduleUpgrade');

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Upgrades" subtitle="Firmware running on your devices." />

      <SectionCard title="Upgrade policy" subtitle="Change automatic upgrades under Site settings.">
        <Fact label="Automatic upgrades">{site.data ? onOff(site.data.autoUpgrade?.enable) : '—'}</Fact>
        <Fact label="Scheduled upgrade">{schedule.data ? onOff(schedule.data.enable) : '—'}</Fact>
      </SectionCard>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
          Device firmware
        </Typography>
        {devices.isLoading && <CircularProgress size={22} />}
        {devices.error && <Alert severity="error">{apiErrorText(devices.error)}</Alert>}
        {devices.data && (
          <ResponsiveList<Device>
            rows={devices.data}
            keyOf={(d) => d.mac}
            emptyText="No adopted devices yet. Their firmware versions appear here after adoption."
            columns={[
              { header: 'Device', render: (d) => d.name ?? d.mac },
              { header: 'Model', render: (d) => d.showModel ?? d.model ?? '—' },
              { header: 'Firmware', render: (d) => d.firmwareVersion ?? d.version ?? '—' },
              { header: 'Status', render: (d) => <DeviceStatusChip status={d.status} statusCategory={d.statusCategory} /> },
            ]}
          />
        )}
      </Box>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="subtitle1">Uploaded firmware files</Typography>
          {firmwares.data && <Chip size="small" label={firmwares.data.total} />}
        </Box>
        {firmwares.isLoading && <CircularProgress size={22} />}
        {firmwares.error && <Alert severity="info">{apiErrorText(firmwares.error)}</Alert>}
        {firmwares.data && (
          <ResponsiveList<Firmware>
            rows={firmwares.data.rows}
            keyOf={(f) => f.id ?? f.name ?? ''}
            emptyText="No firmware files have been uploaded to the controller."
            columns={[
              { header: 'File', render: (f) => f.name ?? '—' },
              { header: 'Model', render: (f) => f.model ?? '—' },
              { header: 'Version', render: (f) => f.version ?? '—' },
            ]}
          />
        )}
      </Box>
    </Stack>
  );
}

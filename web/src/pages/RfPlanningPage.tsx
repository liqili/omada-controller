import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useRfPlanning, useRfPlanningRun, usePutRfPlanningConfig } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContextBridge';

const CONTROLS: { key: 'channelDeployEnable' | 'channelWidthDeployEnable' | 'bandDeployEnable' | 'powerAdjustEnable'; label: string }[] = [
  { key: 'channelDeployEnable', label: 'Auto channel assignment' },
  { key: 'channelWidthDeployEnable', label: 'Channel width optimization' },
  { key: 'bandDeployEnable', label: 'Band steering' },
  { key: 'powerAdjustEnable', label: 'Transmit power adjustment' },
];

// RF Planning ("setup space") — GET sites/{sid}/rfPlanning, start/cancel via
// POST cmd/rfPlanning[/cancel]. Toggles are display-only here; the controller
// applies the plan when the run starts.
export default function RfPlanningPage() {
  const { siteId } = useSite();
  const { data, isLoading, error } = useRfPlanning(siteId);
  const run = useRfPlanningRun(siteId);
  const saveConfig = usePutRfPlanningConfig(siteId);

  const toggle = (key: (typeof CONTROLS)[number]['key']) =>
    data && saveConfig.mutate({ ...data, [key]: !data[key] });

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;

  return (
    <Stack spacing={2} sx={{ maxWidth: 520 }}>
      <Typography variant="h5">RF Planning</Typography>
      {error && <Alert severity="error">{(error as Error).message}</Alert>}
      {!data && !error && <Alert severity="info">Select a site first.</Alert>}
      {data && (
        <>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Optimization
              </Typography>
              <Stack spacing={0.5}>
                {CONTROLS.map((c) => (
                  <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{c.label}</Typography>
                    <Switch
                      checked={Boolean(data[c.key])}
                      size="small"
                      disabled={saveConfig.isPending}
                      onChange={() => toggle(c.key)}
                    />
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={run.isPending} onClick={() => run.mutate(true)}>
              Start optimization
            </Button>
            <Button variant="outlined" color="error" disabled={run.isPending} onClick={() => run.mutate(false)}>
              Cancel
            </Button>
          </Box>
          {run.isSuccess && <Alert severity="success">Request sent — optimization will run shortly.</Alert>}
          {run.isError && <Alert severity="error">{(run.error as Error).message}</Alert>}
        </>
      )}
    </Stack>
  );
}

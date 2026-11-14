import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { useAlertNum, useOverview } from '../hooks/queries';
import { useSite } from '../hooks/useSiteContext';
import { StatTile, StatTileGrid } from '../components/StatTile';

export default function DashboardPage() {
  const { siteId, siteName } = useSite();
  const { data, isLoading, error } = useOverview(siteId);
  const alertNum = useAlertNum(siteId).data;

  if (isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert severity="error">{(error as Error).message}</Alert>;
  if (!data) return null;

  const onlineRatio = (online?: number, total?: number) =>
    total ? `${online ?? 0}/${total}` : String(online ?? 0);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">{siteName ?? 'Dashboard'}</Typography>
      <StatTileGrid>
        <StatTile label="Access Points" value={onlineRatio(data.connectedApNum, data.totalApNum)} color={data.connectedApNum === data.totalApNum ? 'success.main' : 'warning.main'} />
        <StatTile label="Switches" value={onlineRatio(data.connectedSwitchNum, data.totalSwitchNum)} color={data.connectedSwitchNum === data.totalSwitchNum ? 'success.main' : 'warning.main'} />
        <StatTile label="Gateways" value={onlineRatio(data.connectedGatewayNum, data.totalGatewayNum)} color={data.connectedGatewayNum === data.totalGatewayNum ? 'success.main' : 'error.main'} />
        <StatTile label="Clients" value={data.totalClientNum ?? 0} sub={`${data.wiredClientNum ?? 0} wired · ${data.wirelessClientNum ?? 0} wireless`} />
        <StatTile label="Net Utilization" value={data.netUtilization != null ? `${data.netUtilization.toFixed(1)}%` : '—'} sub={data.netCapacity ? `${data.netCapacity} Gbps capacity` : undefined} />
        <StatTile label="Ports" value={onlineRatio(data.availablePorts, data.totalPorts)} />
        <StatTile
          label="Open alerts"
          value={alertNum ?? '—'}
          color={alertNum ? 'error.main' : undefined}
          sub={alertNum === undefined ? undefined : alertNum ? 'See Logs' : 'All clear'}
        />
      </StatTileGrid>
    </Stack>
  );
}

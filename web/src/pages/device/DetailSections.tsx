// Device "Details" tab, laid out like the legacy controller's device drawer:
// a channel-utilization card per radio, then Overview / LAN / Uplink (Wired) /
// Uplink (Wireless) / Downlink / Radios sections. Field choice and wording
// follow the legacy initDetails(); sections without data are left out, and
// live sections only appear while the device is connected (as in legacy).
import type { ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Card,
  CardContent,
  Divider,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { Device, RadioBand, Traffic } from '../../api/types';
import {
  BANDS,
  DUPLEX_LABEL,
  actualChannelNumber,
  bandLabel,
  downlinkSpeed,
  negotiatedSpeed,
  num,
  packetsBytes,
  rateText,
  trafficText,
  uptimeText,
  utilization,
} from './detailFormat';
import type { Numeric } from './detailFormat';

const UTIL_COLORS = { rx: '#0b6e6e', tx: '#13c27a', interference: '#f5b82e', busy: '#7a8fa6' };

const dash = (v: unknown) => (v === undefined || v === null || v === '' ? '--' : String(v));
const duplexText = (d?: Numeric) => {
  const n = num(d);
  return n === undefined ? '--' : DUPLEX_LABEL[n] ?? '--';
};
const activityText = (bytesPerSec?: Numeric) => (num(bytesPerSec) === undefined ? '--' : `${trafficText(bytesPerSec)}/s`);

/** Label-over-value pair, two per row from sm up — the legacy drawer's grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>{children}</Box>;
}

function Section({ title, defaultExpanded, children }: { title: string; defaultExpanded?: boolean; children: ReactNode }) {
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle1">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

function TrafficFields({ t }: { t: Traffic }) {
  return (
    <FieldGrid>
      <Field label="Rx Packets">{dash(t.rxPkts)}</Field>
      <Field label="Tx Packets">{dash(t.txPkts)}</Field>
      <Field label="Rx Bytes">{trafficText(t.rx)}</Field>
      <Field label="Tx Bytes">{trafficText(t.tx)}</Field>
      <Field label="Rx Dropped Packets">{dash(t.rxDropPkts)}</Field>
      <Field label="Tx Dropped Packets">{dash(t.txDropPkts)}</Field>
      <Field label="Rx Error Packets">{dash(t.rxErrPkts)}</Field>
      <Field label="Tx Error Packets">{dash(t.txErrPkts)}</Field>
    </FieldGrid>
  );
}

/**
 * Channel utilization per radio — the card at the top of the legacy drawer.
 * `bare` renders just the rows, for embedding in another card (the page header).
 */
export function RadioUtilization({ device, bare }: { device: Device; bare?: boolean }) {
  // A radio switched off in its settings still reports wp{band} ("N/A", zeros);
  // leave it out of the header rather than show an empty row for it.
  const radios = BANDS.filter((band) => device[`radioSetting${band}`]?.radioEnable !== false)
    .map((band) => ({ band, wp: device[`wp${band}`], u: utilization(device[`wp${band}`]) }))
    .filter((r) => r.u);
  if (!radios.length) return null;
  const rows = (
        <Stack spacing={2.5} divider={<Divider flexItem />}>
          {radios.map(({ band, wp, u }) => {
            // "36 / 5180MHz" → 36; "N/A" (radio off / not up) → "--", not "N".
            const channel = actualChannelNumber(wp);
            const segments = u!.busy !== undefined
              ? [{ key: 'busy', pct: u!.busy, label: 'Busy' }]
              : [
                  { key: 'rx', pct: u!.rx, label: 'Rx Frames' },
                  { key: 'tx', pct: u!.tx, label: 'Tx Frames' },
                  { key: 'interference', pct: u!.interference, label: 'Interference' },
                ];
            return (
              <Box key={band} data-testid={`util-${band}`}>
                <Stack direction="row" spacing={2} alignItems="baseline" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6" component="span">
                    {channel ?? '--'}
                  </Typography>
                  <Typography component="span">{wp?.rdMode ?? ''}</Typography>
                  <Typography component="span">{bandLabel(band, device)}</Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography component="span" color={u!.rating === 'High' ? 'error' : undefined}>
                    ({u!.total}% Utilized)
                  </Typography>
                </Stack>
                <Box
                  sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'action.hover', my: 1 }}
                  aria-label={`Channel utilization ${u!.total}%`}
                >
                  {segments.map((s) => (
                    <Box key={s.key} sx={{ width: `${Math.min(100, s.pct)}%`, bgcolor: UTIL_COLORS[s.key as keyof typeof UTIL_COLORS] }} />
                  ))}
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
                  <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                    {[...segments, { key: 'free', pct: Math.max(0, 100 - u!.total), label: 'Free' }].map((s) => (
                      <Stack key={s.key} direction="row" spacing={0.75} alignItems="center">
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            bgcolor: s.key === 'free' ? 'action.hover' : UTIL_COLORS[s.key as keyof typeof UTIL_COLORS],
                          }}
                        />
                        <Typography variant="body2">
                          {s.label} {s.pct}%
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                  <Typography variant="body2" color={u!.rating === 'High' ? 'error' : 'text.secondary'}>
                    {u!.rating}
                  </Typography>
                </Stack>
              </Box>
            );
          })}
        </Stack>
  );
  if (bare) return rows;
  return (
    <Card>
      <CardContent>{rows}</CardContent>
    </Card>
  );
}

function Percent({ value }: { value?: number }) {
  if (typeof value !== 'number') return <>--</>;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <span>{value}%</span>
      <LinearProgress variant="determinate" value={Math.min(100, value)} sx={{ flex: 1, maxWidth: 120, height: 6, borderRadius: 3 }} />
    </Stack>
  );
}

export function DetailSections({ device, connected }: { device: Device; connected: boolean }) {
  const isAp = device.type === 'ap';
  const pending = device.statusCategory === 2;
  const radios = BANDS.filter((b) => device[`wp${b}`] || device[`radioTraffic${b}`]);
  const wired = device.wiredUplink;
  const wireless = device.wirelessUplink;
  const downlinks = device.downlinkList ?? [];

  return (
    <Stack spacing={1.5}>
      <Section title="Overview" defaultExpanded>
        <FieldGrid>
          {device.sn && !pending && <Field label="Serial Number">{device.sn}</Field>}
          {device.customName && !pending && <Field label="Custom Name">{device.customName}</Field>}
          <Field label="MAC Address">{device.mac}</Field>
          <Field label="IP Address">{dash(device.ip)}</Field>
          <Field label="Public IP Address">{dash(device.publicIp)}</Field>
          <Field label="IPv6 Address">{device.ipv6List?.length ? device.ipv6List.join(', ') : '--'}</Field>
          <Field label="Model">
            {dash(device.showModel ?? device.model)}
            {device.specialModel ? ' (Custom made)' : ''}
          </Field>
          <Field label="Firmware Version">{dash(device.firmwareVersion ?? device.version)}</Field>
          {connected && (
            <>
              <Field label="CPU Utilization">
                <Percent value={device.cpuUtil} />
              </Field>
              <Field label="Memory Utilization">
                <Percent value={device.memUtil} />
              </Field>
              <Field label="Uptime">{uptimeText(device.uptimeLong, device.uptime)}</Field>
            </>
          )}
          {!connected && device.lastSeen ? (
            <Field label="Last Seen">{new Date(device.lastSeen).toLocaleString()}</Field>
          ) : null}
          {device.clientNum !== undefined && <Field label="Clients">{device.clientNum}</Field>}
        </FieldGrid>
      </Section>

      {connected && device.lanTraffic && (
        <Section title="LAN">
          <TrafficFields t={device.lanTraffic} />
        </Section>
      )}

      {connected && (wired || (!wireless && (device.uplinkDeviceName || device.linkSpeed))) && (
        <Section title="Uplink (Wired)">
          {/* Labels and order as the legacy drawer (view: apDetailsModel.wiredUplinkName … activity). */}
          <FieldGrid>
            <Field label="Uplink Device">
              {dash(wired?.name ?? device.uplinkDeviceName ?? wired?.uplinkMac ?? device.uplinkDeviceMac)}
              {device.uplinkDevicePort ? ` (port ${device.uplinkDevicePort})` : ''}
            </Field>
            <Field label="Duplex">{duplexText(wired?.duplex ?? device.duplex)}</Field>
            <Field label="Negotiated Speed">{negotiatedSpeed(device)}</Field>
            <Field label="Down Pkts/Bytes">{packetsBytes(wired?.downPackets, wired?.downBytes)}</Field>
            <Field label="Up Pkts/Bytes">{packetsBytes(wired?.upPackets, wired?.upBytes)}</Field>
            <Field label="Activity Speed">{activityText(wired?.activity)}</Field>
          </FieldGrid>
        </Section>
      )}

      {connected && wireless && (
        <Section title="Uplink (Wireless)">
          <FieldGrid>
            <Field label="Uplink Device">{dash(wireless.name ?? wireless.uplinkMac)}</Field>
            <Field label="Signal">{typeof wireless.rssi === 'number' ? `${wireless.rssi} dBm` : '--'}</Field>
            <Field label="Tx Rate">{rateText(wireless.txRateInt)}</Field>
            <Field label="Rx Rate">{rateText(wireless.rxRateInt)}</Field>
            <Field label="Down Pkts/Bytes">{packetsBytes(wireless.downPackets, wireless.downBytes)}</Field>
            <Field label="Up Pkts/Bytes">{packetsBytes(wireless.upPackets, wireless.upBytes)}</Field>
            <Field label="Activity Speed">{activityText(wireless.activity)}</Field>
          </FieldGrid>
        </Section>
      )}

      {connected && downlinks.length > 0 && (
        <Section title="Downlink">
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                {/* Columns as the legacy ap-downlink-grid. */}
                <TableRow>
                  <TableCell>Port</TableCell>
                  <TableCell>Device Name</TableCell>
                  <TableCell>Device IP</TableCell>
                  <TableCell>Device MAC</TableCell>
                  <TableCell>Link Status</TableCell>
                  <TableCell>Speed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {downlinks.map((l, i) => (
                  <TableRow key={`${l.port}-${l.mac ?? i}`}>
                    <TableCell>{dash(l.port)}</TableCell>
                    <TableCell>{dash(l.deviceName || l.mac)}</TableCell>
                    <TableCell>{dash(l.ip)}</TableCell>
                    <TableCell>{dash(l.mac)}</TableCell>
                    <TableCell>{l.link ? 'Connected' : 'Disconnected'}</TableCell>
                    <TableCell>{downlinkSpeed(l)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Section>
      )}

      {isAp && connected && radios.length > 0 && (
        <Section title="Radios">
          <Stack spacing={2} divider={<Divider flexItem />}>
            {radios.map((band) => (
              <RadioFields key={band} band={band} device={device} />
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

function RadioFields({ band, device }: { band: RadioBand; device: Device }) {
  const wp = device[`wp${band}`];
  const traffic = device[`radioTraffic${band}`];
  const setting = device[`radioSetting${band}`];
  // Real firmware pads it: "40  / 5200MHz".
  const channel =
    wp?.actualChannel && wp.actualChannel.toUpperCase() !== 'N/A' ? wp.actualChannel.replace(/\s+/g, ' ').trim() : undefined;
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {bandLabel(band, device)}
      </Typography>
      {wp && (
        <FieldGrid>
          <Field label="Mode">{wp.rdMode ? `802.11${wp.rdMode}` : '--'}</Field>
          <Field label="Channel Width">{dash(wp.bandWidth)}</Field>
          <Field label="Channel">{dash(channel)}</Field>
          <Field label="Tx Power">{setting?.radioEnable !== false && typeof wp.txPower === 'number' ? `${wp.txPower} dBm` : '--'}</Field>
        </FieldGrid>
      )}
      {traffic && (
        <Box sx={{ mt: wp ? 2 : 0 }}>
          <TrafficFields t={traffic} />
        </Box>
      )}
    </Box>
  );
}

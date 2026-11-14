import { useRef, useState } from 'react';
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
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useFirmwareInfo, useManualUpgrade, useOnlineUpgrade } from '../../hooks/queries';
import { Fact, SectionCard, apiErrorText } from '../../components/SettingsKit';
import type { Device } from '../../api/types';

const MAX_BYTES = 256 * 1024 * 1024; // the vendor UI's limit

type Pending = { kind: 'online' } | { kind: 'file'; file: File };

export default function FirmwarePanel({ siteId, device, connected }: { siteId: string; device: Device; connected: boolean }) {
  const info = useFirmwareInfo(siteId, device.mac);
  const online = useOnlineUpgrade(siteId, device.mac);
  const manual = useManualUpgrade(siteId, { mac: device.mac, type: device.type });
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const upgrading = device.status === 12;
  const current = device.firmwareVersion ?? info.data?.curFwVer;
  const latest = info.data?.lastFwVer;
  const hasUpdate = Boolean(latest && latest !== current);
  const busy = upgrading || online.isPending || manual.isPending;

  const pickFile = (f?: File) => {
    setFileError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.bin')) return setFileError('Choose a .bin firmware file for this model.');
    if (f.size > MAX_BYTES) return setFileError('The file is larger than 256 MB.');
    setConfirm({ kind: 'file', file: f });
  };

  const start = () => {
    if (!confirm) return;
    if (confirm.kind === 'online') online.mutate(undefined, { onSettled: () => setConfirm(null) });
    else {
      setProgress(0);
      manual.mutate(
        { file: confirm.file, onProgress: setProgress },
        { onSettled: () => (setConfirm(null), setProgress(null)) },
      );
    }
  };

  return (
    <Stack spacing={2}>
      <SectionCard title="Firmware">
        <Fact label="Installed">{current ?? '—'}</Fact>
        <Fact label="Latest available">
          {info.isLoading ? <CircularProgress size={14} /> : latest ?? 'Unknown — the controller has not checked yet'}
        </Fact>
        {upgrading && (
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Upgrading — the device reboots when it is done. Do not unplug it.
            </Typography>
            <LinearProgress />
          </Box>
        )}
        {info.error && <Alert severity="info">{apiErrorText(info.error)}</Alert>}
        {!upgrading && !hasUpdate && latest && <Alert severity="success">This device is up to date.</Alert>}
        {hasUpdate && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              What’s new in {latest}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              component="pre"
              sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0, maxHeight: 220, overflow: 'auto' }}
            >
              {info.data?.fwReleaseLog || 'No release notes.'}
            </Typography>
          </Box>
        )}
        {online.isError && <Alert severity="error">{apiErrorText(online.error)}</Alert>}
        <Box>
          <Button
            variant="contained"
            size="small"
            disabled={!hasUpdate || !connected || busy}
            onClick={() => setConfirm({ kind: 'online' })}
          >
            {hasUpdate ? `Upgrade to ${latest}` : 'Upgrade'}
          </Button>
        </Box>
      </SectionCard>

      <SectionCard title="Upgrade from a file" subtitle="Use a .bin from TP-Link’s support site for this exact model and hardware version.">
        <input
          ref={input}
          type="file"
          accept=".bin"
          hidden
          aria-label="Firmware file"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {fileError && <Alert severity="warning">{fileError}</Alert>}
        {manual.isError && <Alert severity="error">{apiErrorText(manual.error)}</Alert>}
        {progress !== null && (
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Uploading… {Math.round(progress * 100)}%
            </Typography>
            <LinearProgress variant="determinate" value={progress * 100} />
          </Box>
        )}
        <Box>
          <Button variant="outlined" size="small" disabled={!connected || busy} onClick={() => input.current?.click()}>
            Choose file…
          </Button>
        </Box>
      </SectionCard>

      <Dialog open={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Upgrade {device.name ?? device.mac}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm?.kind === 'file'
              ? `Install ${confirm.file.name} (${(confirm.file.size / 1048576).toFixed(1)} MB).`
              : `Install firmware ${latest}.`}{' '}
            The device reboots and its clients lose connection for a few minutes.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={start} disabled={busy}>
            {busy ? 'Starting…' : 'Upgrade'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

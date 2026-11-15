import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { SectionCard, apiErrorText } from '../components/SettingsKit';
import {
  BACKUP_RETENTION,
  cancelBackup,
  downloadBackup,
  getBackupStatus,
  saveFile,
  type BackupOptions,
} from '../api/domains/backup';

/**
 * Controller settings → Backup: the vendor "Local file" backup. Settings
 * always go in; the .cfg can be imported by a fresh controller (setup
 * wizard → Restore from backup) or by this one.
 */
export function BackupSection() {
  const [opts, setOpts] = useState<BackupOptions>({
    retainUser: false,
    retainAuthRecord: false,
    retainFirmwareLog: false,
    retention: 7,
  });
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const keepsData = opts.retainAuthRecord || opts.retainFirmwareLog;

  // Progress, as the vendor page shows it, while the file is being produced.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      getBackupStatus()
        .then((s) => typeof s.percent === 'number' && setPercent(s.percent))
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [running]);

  const start = async () => {
    setRunning(true);
    setPercent(undefined);
    setResult(null);
    abort.current = new AbortController();
    try {
      const { blob, filename } = await downloadBackup(opts, abort.current.signal);
      saveFile(blob, filename);
      setResult({ ok: true, text: `Saved ${filename}.` });
    } catch (e) {
      if (abort.current?.signal.aborted) setResult({ ok: false, text: 'Backup cancelled.' });
      else setResult({ ok: false, text: `Backup failed: ${apiErrorText(e)}` });
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const cancel = async () => {
    abort.current?.abort();
    await cancelBackup().catch(() => undefined);
  };

  const check = (key: 'retainUser' | 'retainAuthRecord' | 'retainFirmwareLog', label: string, hint?: string) => (
    <Box>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={opts[key]}
            disabled={running}
            onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
          />
        }
        label={label}
      />
      {hint && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ ml: 4, mt: -0.5 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );

  return (
    <SectionCard
      title="Backup"
      subtitle="Download the controller's configuration as a .cfg file. A new controller with an empty database can import it in its setup wizard (Restore from backup)."
    >
      <Box>
        <FormControlLabel control={<Checkbox size="small" checked disabled />} label="Settings (always included)" />
        {check(
          'retainUser',
          'User info',
          'Keeps local and cloud users except the main admin. For cloud users, enable Cloud Access on the controller you restore to.',
        )}
        {check(
          'retainAuthRecord',
          'Authenticated clients',
          'Records used to verify clients for portal authentication.',
        )}
        {check('retainFirmwareLog', 'Firmware update logs')}
      </Box>
      {keepsData && (
        <TextField
          select
          size="small"
          label="Retained data"
          value={opts.retention}
          disabled={running}
          onChange={(e) => setOpts({ ...opts, retention: Number(e.target.value) })}
          sx={{ maxWidth: 220 }}
        >
          {BACKUP_RETENTION.map((r) => (
            <MenuItem key={r.value} value={r.value}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
      )}
      {running && (
        <Box>
          <LinearProgress variant={percent === undefined ? 'indeterminate' : 'determinate'} value={percent ?? 0} />
          <Typography variant="caption" color="text.secondary">
            Preparing the backup{percent === undefined ? '…' : ` — ${percent}%`}
          </Typography>
        </Box>
      )}
      {result && (
        <Alert severity={result.ok ? 'success' : 'error'} onClose={() => setResult(null)}>
          {result.text}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button variant="contained" startIcon={<DownloadIcon />} disabled={running} onClick={() => void start()}>
          {running ? 'Backing up…' : 'Back up'}
        </Button>
        {running && <Button onClick={() => void cancel()}>Cancel</Button>}
      </Box>
    </SectionCard>
  );
}

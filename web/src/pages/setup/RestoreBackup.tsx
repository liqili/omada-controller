import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  BACKUP_EXTENSION,
  RESTORE_TIMING,
  getControllerIdentity,
  getRestoreResult,
  interpretRestoreResult,
  prepareRestore,
  uploadRestore,
  validateBackupFile,
  type ControllerIdentity,
  type RestoreOutcome,
} from '../../api/domains/restore';

type View =
  | { kind: 'select' }
  | { kind: 'working'; stage: 'uploading' | 'restoring'; percent: number }
  | Exclude<RestoreOutcome, { kind: 'progress' }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Full page load: drops cached "unconfigured" state and opens the login. */
export function goToLogin() {
  window.location.assign('/login');
}

interface Props {
  onBack: () => void;
  timing?: typeof RESTORE_TIMING;
  onFinished?: () => void;
}

// "Restore from backup file" step of the first-run wizard — same calls,
// options and result handling as the vendor wizard (see api/domains/restore).
export function RestoreBackup({ onBack, timing = RESTORE_TIMING, onFinished = goToLogin }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [retainDevices, setRetainDevices] = useState(true);
  const [view, setView] = useState<View>({ kind: 'select' });
  const [cancelled, setCancelled] = useState(false);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [dragging, setDragging] = useState(false);
  const alive = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    getControllerIdentity()
      .then((id) => alive.current && setIdentity(id))
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, []);

  // Restored: the backup's own accounts sign in from now on.
  useEffect(() => {
    if (view.kind !== 'done') return;
    const t = setTimeout(onFinished, 2000);
    return () => clearTimeout(t);
  }, [view.kind, onFinished]);

  const pick = (f: File | null | undefined) => {
    setCancelled(false);
    setFile(f ?? null);
    setFileError(f ? validateBackupFile(f) : null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (view.kind === 'select') pick(e.dataTransfer.files?.[0]);
  };

  const run = async (skipConfirm: boolean) => {
    if (!file) return;
    setCancelled(false);
    setView({ kind: 'working', stage: 'uploading', percent: 0 });
    try {
      const id = identity ?? (await getControllerIdentity());
      if (!identity) setIdentity(id);
      await prepareRestore(id.omadacId);
      await uploadRestore(id.omadacId, file, { retainDevices, skipConfirm }, (p) => {
        if (alive.current) setView({ kind: 'working', stage: 'uploading', percent: p });
      });
      if (!alive.current) return;
      setView({ kind: 'working', stage: 'restoring', percent: 0 });
      await sleep(timing.firstPollMs);
      let failures = 0;
      while (alive.current) {
        let outcome: RestoreOutcome;
        try {
          outcome = interpretRestoreResult(await getRestoreResult(id.omadacId));
          failures = 0;
        } catch {
          // The controller can be briefly unreachable while it applies the file.
          failures += 1;
          if (failures > timing.maxFailures) {
            setView({ kind: 'failed', title: 'Operation failed', message: 'Request timed out. Check that the controller is running, then try again.' });
            return;
          }
          await sleep(timing.pollMs);
          continue;
        }
        if (!alive.current) return;
        if (outcome.kind === 'progress') {
          setView({ kind: 'working', stage: 'restoring', percent: outcome.percent });
          await sleep(timing.pollMs);
          continue;
        }
        setView(outcome);
        return;
      }
    } catch (e) {
      if (alive.current) setView({ kind: 'failed', title: 'Operation failed', message: (e as Error).message });
    }
  };

  const working = view.kind === 'working';
  const fileOk = Boolean(file) && !fileError;

  return (
    <Stack spacing={2}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5">Restore from backup</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Import a controller backup file (.cfg). Its settings, sites and devices are restored; you keep the administrator account you just created.
        </Typography>
      </Box>

      {view.kind === 'failed' && (
        <Alert severity="error" onClose={() => setView({ kind: 'select' })}>
          <AlertTitle>{view.title}</AlertTitle>
          {view.message}
        </Alert>
      )}
      {cancelled && view.kind === 'select' && (
        <Alert severity="info" onClose={() => setCancelled(false)}>
          Restore cancelled. Nothing was imported.
        </Alert>
      )}

      {(view.kind === 'select' || view.kind === 'failed' || view.kind === 'confirm') && (
        <>
          <Box
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Choose backup file"
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            sx={{
              border: 2,
              borderStyle: 'dashed',
              borderColor: fileError ? 'error.main' : dragging ? 'primary.main' : 'divider',
              bgcolor: dragging ? 'action.hover' : 'transparent',
              borderRadius: 2,
              p: 3,
              textAlign: 'center',
              cursor: 'pointer',
              outline: 'none',
              '&:focus-visible': { borderColor: 'primary.main' },
            }}
          >
            <UploadFileIcon color={fileOk ? 'primary' : 'action'} sx={{ fontSize: 40 }} />
            {file ? (
              <>
                <Typography sx={{ wordBreak: 'break-all', fontWeight: 600 }}>{file.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatSize(file.size)} · click to choose another file
                </Typography>
              </>
            ) : (
              <>
                <Typography sx={{ fontWeight: 600 }}>Choose a backup file</Typography>
                <Typography variant="body2" color="text.secondary">
                  or drop it here · {BACKUP_EXTENSION}, up to 500 MB
                </Typography>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={BACKUP_EXTENSION}
              hidden
              data-testid="backup-file"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </Box>
          {fileError && (
            <Typography variant="body2" color="error" sx={{ mt: -1 }}>
              {fileError}
            </Typography>
          )}

          <Box>
            <FormControlLabel
              control={<Switch checked={retainDevices} onChange={(e) => setRetainDevices(e.target.checked)} />}
              label="Retain Device Info"
            />
            <Typography variant="body2" color="text.secondary">
              {retainDevices
                ? 'Devices in the backup stay adopted and reconnect to this controller.'
                : 'Only settings are restored. Devices must be adopted again.'}
            </Typography>
          </Box>

          <Alert severity="info" variant="outlined">
            Only configuration files of Omada Controller v5.0.x or above are supported, from a controller with the same
            or a lower version (Major.Minor.Patch)
            {identity?.controllerVer ? ` than this one (v${identity.controllerVer})` : ''}.
          </Alert>

          <Stack direction="row" spacing={1}>
            <Button onClick={onBack} sx={{ flex: 1 }}>
              Back
            </Button>
            <Button variant="contained" disabled={!fileOk} onClick={() => run(false)} sx={{ flex: 2 }}>
              Restore
            </Button>
          </Stack>
        </>
      )}

      {working && (
        <Box sx={{ py: 2 }} role="status" aria-live="polite">
          <Typography sx={{ fontWeight: 600 }}>
            {view.stage === 'uploading' ? `Uploading ${file?.name ?? 'backup'}…` : 'Restoring…'}
          </Typography>
          <LinearProgress
            variant={view.stage === 'restoring' && view.percent === 0 ? 'indeterminate' : 'determinate'}
            value={view.percent}
            sx={{ my: 1.5, height: 8, borderRadius: 4 }}
          />
          <Typography variant="body2" color="text.secondary">
            {view.percent > 0 ? `${view.percent}% · ` : ''}This may take several minutes. Please wait without any
            operation.
          </Typography>
        </Box>
      )}

      {view.kind === 'done' && (
        <Stack spacing={1.5} alignItems="center" sx={{ py: 2, textAlign: 'center' }} role="status">
          <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
          <Typography variant="h6">Restore complete</Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in with your administrator account.
          </Typography>
          <Button variant="contained" onClick={onFinished}>
            Go to sign in
          </Button>
        </Stack>
      )}

      {view.kind === 'needReboot' && (
        <Stack spacing={1.5} sx={{ py: 1 }}>
          <Alert severity="warning">
            <AlertTitle>Restart required</AlertTitle>
            Some configurations in the imported file require the controller to restart before they can take effect.
            Please restart the controller to make the configurations effective.
          </Alert>
          <Button variant="contained" onClick={onFinished}>
            Continue to sign in
          </Button>
        </Stack>
      )}

      {view.kind === 'jumpIp' && (
        <Stack spacing={1.5} sx={{ py: 1 }}>
          <Alert severity="info">
            <AlertTitle>Controller address changed</AlertTitle>
            The IP address and port of the controller have been changed to <b>{view.address}</b>. Sign in at the new
            address.
          </Alert>
          <Button variant="contained" href={`${window.location.protocol}//${view.address}`} target="_blank" rel="noreferrer">
            Open {view.address}
          </Button>
          <Button onClick={onFinished}>Continue here</Button>
        </Stack>
      )}

      <Dialog open={view.kind === 'confirm'} fullWidth maxWidth="sm">
        {view.kind === 'confirm' && (
          <>
            <DialogTitle>Review before importing</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                {view.unsupportedModels.length > 0 && (
                  <Box>
                    <Typography variant="body2">
                      The file contains models that are not supported by this controller. If you continue, the data of
                      these models will be lost.
                    </Typography>
                    <Typography variant="body2" color="error" sx={{ my: 1 }}>
                      Unsupported models:
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      {view.unsupportedModels.map((m) => (
                        <Chip key={m} label={m} size="small" />
                      ))}
                    </Stack>
                  </Box>
                )}
                {view.deviceLimit && (
                  <Typography variant="body2">
                    <b>Device limitation reached.</b> The number of imported devices ({view.deviceLimit.file}) has
                    reached the limit ({view.deviceLimit.max}). If you continue, information of exceeded devices will be
                    lost.
                  </Typography>
                )}
                {view.incompatibleSettings.length > 0 && (
                  <Box>
                    <Typography variant="body2">
                      The imported file contains incompatible configurations. If you continue, incompatible
                      configurations will be lost.
                    </Typography>
                    <Box component="ul" sx={{ pl: 3, my: 1 }}>
                      {view.incompatibleSettings.map((s) => (
                        <li key={s}>
                          <Typography variant="body2">{s}</Typography>
                        </li>
                      ))}
                    </Box>
                  </Box>
                )}
                {!view.unsupportedModels.length && !view.deviceLimit && !view.incompatibleSettings.length && (
                  <Typography variant="body2">The controller needs your confirmation to import this file.</Typography>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              {view.needConfirm && (
                <Button
                  onClick={() => {
                    setCancelled(true);
                    setView({ kind: 'select' });
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="contained"
                onClick={() => (view.needConfirm ? run(true) : setView({ kind: 'done' }))}
              >
                Import
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Stack>
  );
}

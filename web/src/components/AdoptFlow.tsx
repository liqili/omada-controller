import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { OmadaApiError } from '../api/client';
import { adoptNeedsAccount, type AdoptTarget, type DeviceAccount } from '../api/domains/device';

/** Controller answer to an adopt whose device login is missing or wrong. */
export const ADOPT_LOGIN_FAILED = -39003;

const isLoginFailure = (e: unknown) => e instanceof OmadaApiError && e.errorCode === ADOPT_LOGIN_FAILED;

/**
 * Adopt with the vendor UI's credential rule, plus a retry on a wrong login:
 *  - devices on factory settings are adopted straight away;
 *  - a device managed by another controller, or whose adoption failed on its
 *    login, needs its own username/password first (adoptNeedsAccount);
 *  - when the controller refuses a single adopt with -39003 ("the username or
 *    password is incorrect"), the login dialog opens with that message and the
 *    adopt is sent again with what the user enters — repeatedly, until it is
 *    accepted or cancelled. (The vendor UI only marks the row failed; asking
 *    again at once is what the user asked for, 2026-11-15.)
 * `adopt` returns the request's promise; errors other than -39003 go to `onError`.
 */
export function useAdoptFlow(
  adopt: (devices: AdoptTarget[], account?: DeviceAccount) => Promise<unknown>,
  onError?: (e: unknown) => void,
): {
  start: (devices: AdoptTarget[]) => void;
  dialog: ReactNode;
  busy: boolean;
} {
  const [asking, setAsking] = useState<AdoptTarget[] | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = (devices: AdoptTarget[], error: string | null) => {
    setPassword('');
    setLoginError(error);
    setAsking(devices);
  };

  const send = async (devices: AdoptTarget[], account?: DeviceAccount) => {
    setBusy(true);
    try {
      await adopt(devices, account);
      setAsking(null);
    } catch (e) {
      if (devices.length === 1 && isLoginFailure(e)) ask(devices, (e as Error).message);
      else {
        setAsking(null);
        onError?.(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const start = (devices: AdoptTarget[]) => {
    if (!devices.length) return;
    if (!adoptNeedsAccount(devices)) {
      void send(devices);
      return;
    }
    setUsername('');
    ask(devices, null);
  };
  // Vendor limits: 1–64 characters each.
  const valid = username.length >= 1 && username.length <= 64 && password.length >= 1 && password.length <= 64;
  const submit = () => {
    if (!asking || !valid || busy) return;
    void send(asking, { username, password });
  };

  const dialog = (
    <Dialog open={Boolean(asking)} onClose={() => !busy && setAsking(null)} maxWidth="xs" fullWidth>
      <DialogTitle>Device login needed</DialogTitle>
      <DialogContent>
        {loginError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {loginError}
          </Alert>
        ) : null}
        <DialogContentText sx={{ mb: 2 }}>
          {asking && asking.length > 1 ? 'Some of these devices are' : 'This device is'} not on factory settings (managed by
          another controller, or a previous adoption failed on its login). Enter the username and password the device uses now.
        </DialogContentText>
        <Stack spacing={2} component="form" onSubmit={(e) => (e.preventDefault(), submit())}>
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            inputProps={{ maxLength: 64, autoComplete: 'off' }}
            autoFocus
            required
            disabled={busy}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            inputProps={{ maxLength: 64, autoComplete: 'new-password' }}
            required
            disabled={busy}
          />
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setAsking(null)} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" disabled={!valid || busy} onClick={submit}>
          {busy ? 'Adopting…' : 'Adopt'}
        </Button>
      </DialogActions>
    </Dialog>
  );
  return { start, dialog, busy };
}

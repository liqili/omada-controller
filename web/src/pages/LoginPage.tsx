import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getLocalAdminHint } from '../api/domains/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Pre-fill the local main administrator username (/anon/root).
  useEffect(() => {
    let alive = true;
    getLocalAdminHint().then((u) => {
      if (alive && u) setUsername((cur) => cur || u);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h5" textAlign="center">
              Omada Dashboard
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <form onSubmit={onSubmit}>
              <Stack spacing={2}>
                <TextField
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  fullWidth
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  fullWidth
                  required
                />
                <FormControlLabel
                  control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
                  label="Remember me"
                />
                <Button type="submit" variant="contained" size="large" disabled={busy} fullWidth>
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
                <Box sx={{ textAlign: 'right' }}>
                  <Link
                    component="button"
                    type="button"
                    variant="body2"
                    underline="hover"
                    onClick={() => setResetOpen(true)}
                  >
                    Forgot password?
                  </Link>
                </Box>
              </Stack>
            </form>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reset your password</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              <Typography variant="body2">
                Omada accounts are stored locally with a one-way hash, so the controller cannot email a reset
                link. Try these in order:
              </Typography>
              <Typography variant="body2">
                <strong>1. Check your browser's saved passwords</strong> — open{' '}
                <code>chrome://password-manager/passwords</code> and search for this host.
              </Typography>
              <Typography variant="body2">
                <strong>2. Log in through the vendor UI</strong> at{' '}
                <Link href="https://localhost:8043" target="_blank" rel="noopener">
                  https://localhost:8043
                </Link>{' '}
                — if you're still signed in there, your browser has the password saved.
              </Typography>
              <Typography variant="body2">
                <strong>3. Reset the controller (last resort)</strong> — wipe its database and re-initialize.
                This deletes all sites, settings and device adoptions; every device must be re-adopted
                afterwards. Contact{' '}
                <Link href="https://www.tp-link.com/us/support/" target="_blank" rel="noopener">
                  TP-Link support
                </Link>{' '}
                for the reset procedure.
              </Typography>
            </Stack>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

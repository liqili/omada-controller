import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { GEO_COUNTRIES } from '../wizardGeoData';
import { RestoreBackup } from './setup/RestoreBackup';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registerAdmin, submitWizardConfig } from '../api/domains/auth';
import { getControllerIdentity } from '../api/domains/restore';
import { OmadaApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useInitialization } from '../hooks/queries';

type Step = 'account' | 'choose' | 'scratch' | 'restore';
interface Admin {
  username: string;
  password: string;
}

// First-run wizard in the vendor's order (setup module):
//   1. Create the Local Main Administrator (POST /api/v2/anon/register) —
//      shown only while /api/info reports registeredRoot:false. A restore
//      depends on it: backups never carry the main admin.
//   2. "Set up your controller": from scratch (POST anon/cmd/wizardConfig,
//      then sign in) or restore a backup file (setup/RestoreBackup).
// The controller reports configured:false until step 2 completes.
export default function SetupPage() {
  const { data: init } = useInitialization();
  const identity = useQuery({ queryKey: ['controllerIdentity'], queryFn: getControllerIdentity, retry: 1, staleTime: 0 });
  const [chosen, setChosen] = useState<Step | null>(null);
  const [admin, setAdmin] = useState<Admin | null>(null);

  if (init?.configured && chosen !== 'restore') return <Navigate to="/login" replace />;

  const step: Step | 'loading' | 'error' =
    chosen ?? (identity.isPending ? 'loading' : identity.isError ? 'error' : identity.data?.registeredRoot ? 'choose' : 'account');

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
      <Card sx={{ width: '100%', maxWidth: step === 'restore' ? 520 : 440 }}>
        <CardContent>
          {step === 'loading' && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress />
            </Box>
          )}
          {step === 'error' && (
            <Stack spacing={2}>
              <Alert severity="error">Could not reach the controller. {(identity.error as Error)?.message}</Alert>
              <Button variant="contained" onClick={() => identity.refetch()}>
                Try again
              </Button>
            </Stack>
          )}
          {step === 'account' && (
            <AccountStep
              onCreated={(a) => {
                setAdmin(a);
                setChosen('choose');
              }}
              onExists={() => setChosen('choose')}
            />
          )}
          {step === 'choose' && <SetupChoice onPick={setChosen} justCreated={Boolean(admin)} />}
          {step === 'scratch' && <ScratchStep admin={admin} onBack={() => setChosen('choose')} />}
          {step === 'restore' && <RestoreBackup onBack={() => setChosen('choose')} />}
        </CardContent>
      </Card>
    </Box>
  );
}

// Omada policy (verified live): ≥8 chars incl. special characters.
export function passwordProblem(password: string): string | null {
  if (!password) return null;
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(password)) return 'Password must contain lowercase letters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain uppercase letters.';
  if (!/\d/.test(password)) return 'Password must contain numbers.';
  if (!/[^a-zA-Z0-9]/.test(password)) return 'Password must contain special characters.';
  return null;
}

// Vendor createRootM: username 1–128 of [a-zA-Z0-9_-].
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function AccountStep({ onCreated, onExists }: { onCreated: (a: Admin) => void; onExists: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const userError = username && !USERNAME_RE.test(username) ? 'Use letters, numbers, - and _ only.' : null;
  const pwError = passwordProblem(password) ?? (confirm && confirm !== password ? 'Passwords do not match.' : null);

  const create = useMutation({
    mutationFn: () => registerAdmin({ username, password, email: email || undefined }),
    onSuccess: () => onCreated({ username, password }),
    onError: (err) => {
      const omada = err as OmadaApiError;
      if (omada.errorCode === -30167) return onExists();
      setError(omada.message || 'Could not create the account.');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || userError || pwError || !confirm) return;
    create.mutate();
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5">Welcome to Omada</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          First, create the administrator account. You will use it to sign in, also after restoring a backup.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <TextField
            label="Admin username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            name="admin-username"
            autoComplete="username"
            fullWidth
            required
            error={Boolean(userError)}
            helperText={userError}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            fullWidth
            required
            error={Boolean(pwError)}
            helperText={pwError ?? '≥8 chars: upper, lower, number and special character.'}
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            fullWidth
            required
            error={Boolean(confirm && confirm !== password)}
          />
          <TextField
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            fullWidth
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={create.isPending || !username || Boolean(userError) || Boolean(pwError) || !confirm}
            fullWidth
          >
            {create.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}

function ScratchStep({ admin, onBack }: { admin: Admin | null; onBack: () => void }) {
  const { login } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const detected = useMemo(() => {
    let country = GEO_COUNTRIES.find((c) => c.code === 'US');
    let timeZone = 'UTC';
    try {
      const regionCode = (new Intl.NumberFormat().resolvedOptions() as { region?: string }).region;
      const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (regionCode) country = GEO_COUNTRIES.find((c) => c.code === regionCode) ?? country;
      if (tz) timeZone = tz;
    } catch {
      /* keep defaults */
    }
    // browser tz may not be in the country's list — fall back to first zone
    if (country && !country.zones.includes(timeZone)) timeZone = country.zones[0];
    return { country: country ?? GEO_COUNTRIES[0], timeZone };
  }, []);

  const [controllerName, setControllerName] = useState('Omada Controller');
  const [country, setCountry] = useState(detected.country);
  const [timeZone, setTimeZone] = useState(detected.timeZone);
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: async () => {
      await submitWizardConfig({ controllerName, region: country.name, timeZone });
      queryClient.setQueryData(['initialization'], { configured: true });
      // Signed straight in when the account was created in this visit;
      // otherwise (page reloaded mid-setup) the login page asks.
      if (admin) await login(admin.username, admin.password);
      return Boolean(admin);
    },
    onSuccess: (signedIn) => navigate(signedIn ? '/' : '/login'),
    onError: (err) => {
      const omada = err as OmadaApiError;
      if (omada.errorCode === -30000) {
        queryClient.setQueryData(['initialization'], { configured: true });
        navigate('/login');
        return;
      }
      setError(omada.message || 'Setup failed');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!controllerName || !country || !timeZone) return;
    setup.mutate();
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5">Set up from scratch</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Name the controller and choose where it runs.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <form onSubmit={onSubmit}>
        <Stack spacing={2}>
          <TextField
            label="Controller name"
            value={controllerName}
            onChange={(e) => setControllerName(e.target.value)}
            name="controller-name"
            autoComplete="off"
            fullWidth
            required
            inputProps={{ maxLength: 32 }}
          />
          <Autocomplete
            options={GEO_COUNTRIES}
            getOptionLabel={(c) => c.name}
            value={country}
            onChange={(_, c) => {
              if (!c) return;
              setCountry(c);
              if (!c.zones.includes(timeZone)) setTimeZone(c.zones[0]);
            }}
            disableClearable
            renderInput={(params) => <TextField {...params} label="Region" name="region" autoComplete="off" required />}
          />
          <TextField
            select
            label="Time zone"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            name="time-zone"
            autoComplete="off"
            fullWidth
            required
          >
            {country.zones.map((z) => (
              <MenuItem key={z} value={z}>
                {z}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1}>
            <Button size="large" onClick={onBack} disabled={setup.isPending} sx={{ flex: 1 }}>
              Back
            </Button>
            <Button type="submit" variant="contained" size="large" disabled={setup.isPending || !controllerName} sx={{ flex: 2 }}>
              {setup.isPending ? 'Configuring…' : admin ? 'Finish & sign in' : 'Finish'}
            </Button>
          </Stack>
        </Stack>
      </form>
    </Stack>
  );
}

const CHOICES: { step: 'scratch' | 'restore'; icon: JSX.Element; title: string; text: string }[] = [
  {
    step: 'scratch',
    icon: <TuneIcon color="primary" />,
    title: 'Set up from scratch',
    text: 'Name the controller and choose its region and time zone.',
  },
  {
    step: 'restore',
    icon: <SettingsBackupRestoreIcon color="primary" />,
    title: 'Restore from backup',
    text: 'Import a controller backup file (.cfg) with its settings, sites and devices.',
  },
];

function SetupChoice({ onPick, justCreated }: { onPick: (s: Step) => void; justCreated: boolean }) {
  return (
    <Stack spacing={2}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5">Set up your controller</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {justCreated ? 'Administrator account created. ' : ''}How do you want to start?
        </Typography>
      </Box>
      {CHOICES.map((c) => (
        <Card key={c.step} variant="outlined">
          <CardActionArea onClick={() => onPick(c.step)} sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              {c.icon}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{c.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {c.text}
                </Typography>
              </Box>
              <ChevronRightIcon color="action" />
            </Stack>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

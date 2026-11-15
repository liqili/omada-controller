import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useAccountSites, useAddAccount, useAvailableRoles, useEditAccount, useSites } from '../hooks/queries';
import {
  ACCOUNT_ERRORS,
  ACCOUNT_ROLE_CHANGE,
  MASTER_ADMIN_ROLE,
  passwordProblem,
  type AccountInput,
  type ControllerUser,
} from '../api/domains/admin';
import { OmadaApiError } from '../api/client';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function accountErrorText(e: unknown): string {
  if (e instanceof OmadaApiError && e.errorCode !== undefined && ACCOUNT_ERRORS[e.errorCode]) return ACCOUNT_ERRORS[e.errorCode];
  return (e as Error)?.message || 'Request failed';
}

/**
 * Add or edit a local controller account, with the vendor Admin page's
 * fields and rules: username, password (strong), email (needed for alert
 * emails), role, site privileges. Editing yourself asks for your current
 * password first, as the vendor UI does.
 */
export function AccountDialog({
  open,
  user,
  isSelf,
  onClose,
  onDone,
}: {
  open: boolean;
  /** undefined = add */
  user?: ControllerUser;
  isSelf: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = Boolean(user);
  const isMaster = user?.roleId === MASTER_ADMIN_ROLE;
  const roles = useAvailableRoles(open);
  const sites = useSites();
  const accountSites = useAccountSites(open && user && !user.privilege?.all ? user.id : undefined);
  const add = useAddAccount();
  const edit = useEditAccount();

  const [name, setName] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ownPassword, setOwnPassword] = useState('');
  const [email, setEmail] = useState('');
  const [alertMail, setAlertMail] = useState(false);
  const [roleId, setRoleId] = useState('');
  const [allSites, setAllSites] = useState(true);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roleChange, setRoleChange] = useState(false);
  const [touched, setTouched] = useState(false);

  // Fill the form whenever it opens.
  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setChangePassword(!user);
    setPassword('');
    setConfirm('');
    setOwnPassword('');
    setEmail((user?.email as string | undefined) ?? '');
    setAlertMail(Boolean(user?.alert));
    setRoleId(user?.roleId ?? '');
    setAllSites(user ? Boolean(user.privilege?.all) : true);
    setSiteIds([]);
    setError(null);
    setRoleChange(false);
    setTouched(false);
  }, [open, user]);

  // Default role for a new account; selected sites of an edited one.
  useEffect(() => {
    if (open && !user && !roleId && roles.data?.length) setRoleId(roles.data[0].id);
  }, [open, user, roleId, roles.data]);
  useEffect(() => {
    if (accountSites.data) setSiteIds(accountSites.data);
  }, [accountSites.data]);

  const siteList = sites.data ?? [];
  const allSiteIds = useMemo(() => siteList.map((s) => s._id), [siteList]);
  const roleOptions = roles.data ?? [];

  const problems = {
    name: !name.trim() ? 'Enter a username.' : name.length > 128 || !/^[\x20-\x7e]+$/.test(name) ? 'Use up to 128 plain characters.' : null,
    password: changePassword ? passwordProblem(password) : null,
    confirm: changePassword && confirm !== password ? 'The passwords do not match.' : null,
    ownPassword: isSelf && !ownPassword ? 'Enter your current password.' : null,
    email: alertMail && !email ? 'Alert emails need an email address.' : email && (!EMAIL.test(email) || email.length > 128) ? 'Enter a valid email address.' : null,
    role: !roleId ? 'Choose a role.' : null,
    sites: !allSites && !siteIds.length ? 'Choose at least one site.' : null,
  };
  const valid = Object.values(problems).every((p) => !p);
  const busy = add.isPending || edit.isPending;
  const show = (k: keyof typeof problems) => (touched ? problems[k] : null);

  const input = (): AccountInput => ({
    name: name.trim(),
    password: changePassword ? password : undefined,
    email: email.trim() || undefined,
    roleId,
    alert: alertMail,
    allSites,
    sites: siteIds,
  });

  const save = async (forceModify = false) => {
    setTouched(true);
    if (!valid || busy) return;
    setError(null);
    try {
      if (user) {
        await edit.mutateAsync({ user, input: input(), allSiteIds, ownPassword: isSelf ? ownPassword : undefined, forceModify });
        onDone(`${name.trim()} was updated.`);
      } else {
        await add.mutateAsync({ input: input(), allSiteIds });
        onDone(`${name.trim()} was added.`);
      }
    } catch (e) {
      if (e instanceof OmadaApiError && e.errorCode === ACCOUNT_ROLE_CHANGE) setRoleChange(true);
      else setError(accountErrorText(e));
    }
  };

  const roleName = roleOptions.find((r) => r.id === roleId)?.name ?? user?.roleName ?? '';

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? `Edit ${user?.name}` : 'Add account'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }} component="form" autoComplete="off" onSubmit={(e) => (e.preventDefault(), void save())}>
          {error && <Alert severity="error">{error}</Alert>}
          {roleChange && (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" disabled={busy} onClick={() => void save(true)}>
                  Change role
                </Button>
              }
            >
              Change the role of {name} to {roleName}? Without permission to manage accounts, the accounts it created move to
              the root account.
            </Alert>
          )}
          <TextField
            label="Username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={Boolean(show('name'))}
            helperText={show('name') ?? ' '}
            inputProps={{ maxLength: 128, autoComplete: 'off' }}
            required
            disabled={busy}
          />
          {editing && (
            <FormControlLabel
              control={<Switch checked={changePassword} onChange={(e) => setChangePassword(e.target.checked)} disabled={busy} />}
              label="Change password"
            />
          )}
          {changePassword && (
            <>
              <TextField
                label={editing ? 'New password' : 'Password'}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={Boolean(show('password'))}
                helperText={show('password') ?? '8–128 characters with a lowercase and an uppercase letter, a number and a symbol.'}
                inputProps={{ maxLength: 128, autoComplete: 'new-password' }}
                required
                disabled={busy}
              />
              <TextField
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={Boolean(show('confirm'))}
                helperText={show('confirm') ?? ' '}
                inputProps={{ maxLength: 128, autoComplete: 'new-password' }}
                required
                disabled={busy}
              />
            </>
          )}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={Boolean(show('email'))}
            helperText={show('email') ?? ' '}
            inputProps={{ maxLength: 128 }}
            disabled={busy}
          />
          <FormControlLabel
            control={<Checkbox checked={alertMail} onChange={(e) => setAlertMail(e.target.checked)} disabled={busy} />}
            label="Send alert emails to this account"
          />
          {isMaster ? (
            <TextField label="Role" value={user?.roleName ?? 'Main administrator'} disabled helperText="The main administrator's role and sites can't change." />
          ) : (
            <TextField
              select
              label="Role"
              value={roleOptions.some((r) => r.id === roleId) ? roleId : ''}
              onChange={(e) => setRoleId(e.target.value)}
              error={Boolean(show('role')) || Boolean(roles.error)}
              helperText={roles.error ? accountErrorText(roles.error) : (show('role') ?? ' ')}
              required
              disabled={busy || roles.isLoading}
            >
              {roleOptions.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!isMaster && (
            <>
              <FormControlLabel
                control={<Switch checked={allSites} onChange={(e) => setAllSites(e.target.checked)} disabled={busy} />}
                label="All sites, including sites added later"
              />
              {!allSites && (
                <Autocomplete
                  multiple
                  options={siteList.map((s) => s._id)}
                  getOptionLabel={(id) => siteList.find((s) => s._id === id)?.name ?? id}
                  value={siteIds}
                  onChange={(_, v) => setSiteIds(v)}
                  loading={sites.isLoading || accountSites.isLoading}
                  disabled={busy}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Sites"
                      error={Boolean(show('sites'))}
                      helperText={show('sites') ?? ' '}
                    />
                  )}
                />
              )}
            </>
          )}
          {isSelf && (
            <TextField
              label="Your current password"
              type="password"
              value={ownPassword}
              onChange={(e) => setOwnPassword(e.target.value)}
              error={Boolean(show('ownPassword'))}
              helperText={show('ownPassword') ?? 'Needed to change your own account.'}
              inputProps={{ maxLength: 128, autoComplete: 'current-password' }}
              required
              disabled={busy}
            />
          )}
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || (touched && !valid)}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

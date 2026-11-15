import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useCurrentUser, useDeleteAccount, useUsers } from '../hooks/queries';
import { ResponsiveList } from '../components/ResponsiveList';
import { Fact, PageTitle, SectionCard, Toast, apiErrorText, onOff } from '../components/SettingsKit';
import { LOCAL_ACCOUNT, MASTER_ADMIN_ROLE, type ControllerUser } from '../api/domains/admin';
import { AccountDialog, accountErrorText } from './AccountDialog';

// Controller accounts: list, add, edit, delete (vendor Admin page flows,
// endpoints in api/domains/admin.ts).
export default function UsersPage() {
  const users = useUsers();
  const me = useCurrentUser();
  const del = useDeleteAccount();
  const [dialog, setDialog] = useState<{ user?: ControllerUser } | null>(null);
  const [confirm, setConfirm] = useState<ControllerUser | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isSelf = (u: ControllerUser) => Boolean(me.data?.id) && me.data?.id === u.id;
  // Cloud (TP-Link ID) accounts and invitations not yet accepted are managed by their owner.
  const canEdit = (u: ControllerUser) => (u.type ?? LOCAL_ACCOUNT) === LOCAL_ACCOUNT && u.verified !== false;
  const canDelete = (u: ControllerUser) => !isSelf(u) && u.roleId !== MASTER_ADMIN_ROLE;

  const closeConfirm = () => {
    setConfirm(null);
    del.reset();
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle
        title="Accounts"
        subtitle="People who can sign in to this controller."
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>
            Add account
          </Button>
        }
      />

      {me.data && (
        <SectionCard title="Signed in as">
          <Fact label="Username">{me.data.name ?? '—'}</Fact>
          <Fact label="Role">{me.data.roleName ?? '—'}</Fact>
          <Fact label="Two-factor sign-in">{onOff(me.data.enableMFA)}</Fact>
          <Fact label="Sites">{me.data.sitePrivilege?.all ? 'All sites' : (me.data.sitePrivilege?.sites?.length ?? 0)}</Fact>
        </SectionCard>
      )}

      {users.isLoading && <CircularProgress sx={{ mx: 'auto' }} />}
      {users.error && <Alert severity="error">{apiErrorText(users.error)}</Alert>}
      {users.data && (
        <ResponsiveList<ControllerUser>
          rows={users.data.rows}
          keyOf={(u) => u.id}
          emptyText="No accounts."
          columns={[
            { header: 'Username', render: (u) => (isSelf(u) ? `${u.name} (you)` : u.name) },
            { header: 'Role', render: (u) => u.roleName ?? '—' },
            {
              header: 'Sites',
              render: (u) => (u.privilege?.all ? 'All sites' : (u.privilege?.sites?.map((s) => s.name).join(', ') ?? '—')),
            },
            {
              header: 'Status',
              render: (u) => (
                <Chip
                  size="small"
                  variant="outlined"
                  color={u.verified ? 'success' : 'warning'}
                  label={u.verified ? 'Active' : 'Pending'}
                />
              ),
              hideOnMobile: true,
            },
            {
              header: '',
              render: (u) => (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {canEdit(u) && (
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setDialog({ user: u })} aria-label={`Edit ${u.name}`}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {canDelete(u) && (
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => setConfirm(u)} aria-label={`Delete ${u.name}`}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ),
            },
          ]}
        />
      )}

      <AccountDialog
        open={Boolean(dialog)}
        user={dialog?.user}
        isSelf={Boolean(dialog?.user && isSelf(dialog.user))}
        onClose={() => setDialog(null)}
        onDone={(msg) => {
          setDialog(null);
          setToast(msg);
        }}
      />

      {confirm && (
        <Dialog open onClose={del.isPending ? undefined : closeConfirm} maxWidth="xs" fullWidth>
          <DialogTitle>Delete {confirm.name}?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.name} can no longer sign in to this controller. This cannot be undone.
            </DialogContentText>
            {del.error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {accountErrorText(del.error)}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeConfirm} disabled={del.isPending}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(confirm.id, {
                  onSuccess: () => {
                    setToast(`${confirm.name} was deleted.`);
                    closeConfirm();
                  },
                })
              }
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

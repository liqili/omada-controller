import { Alert, Chip, CircularProgress, Stack } from '@mui/material';
import { useCurrentUser, useUsers } from '../hooks/queries';
import { ResponsiveList } from '../components/ResponsiveList';
import { Fact, PageTitle, SectionCard, apiErrorText, onOff } from '../components/SettingsKit';
import type { ControllerUser } from '../api/domains/admin';

// Controller accounts — read-only. GET users / current/user-detail verified
// live on v5.15.6.7; account create/edit/delete verbs are not pinned down.
export default function UsersPage() {
  const users = useUsers();
  const me = useCurrentUser();

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Accounts" subtitle="People who can sign in to this controller." />

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
            { header: 'Username', render: (u) => u.name },
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
          ]}
        />
      )}
      <Alert severity="info">Adding, editing and removing accounts is not available here yet — use the vendor UI.</Alert>
    </Stack>
  );
}

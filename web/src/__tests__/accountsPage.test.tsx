// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from '../theme';
import { OmadaApiError } from '../api/client';

const api = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  listAvailableRoles: vi.fn(),
  getAccountSites: vi.fn(),
  confirmOwnPassword: vi.fn(),
  addAccount: vi.fn(),
  editAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock('../api/domains/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/domains/admin')>()),
  ...api,
}));
vi.mock('../api/domains/site', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/domains/site')>()),
  listSites: async () => [
    { _id: 'S1', name: 'Home' },
    { _id: 'S2', name: 'Office' },
  ],
}));

import UsersPage from '../pages/UsersPage';

const users = [
  { id: 'U0', name: 'root', roleId: 'master_admin_id', roleName: 'Main Administrator', type: 0, verified: true, privilege: { all: true } },
  { id: 'U1', name: 'bob', roleId: 'viewer_id', roleName: 'Viewer', type: 0, verified: true, privilege: { all: false, sites: [{ name: 'Office', key: 'S2' }] } },
];

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={theme}>
        <UsersPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );

const field = (label: RegExp) => screen.getByLabelText(label);
const type = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listUsers.mockResolvedValue({ rows: users });
  api.getCurrentUser.mockResolvedValue({ id: 'U0', name: 'root', roleName: 'Main Administrator' });
  api.listAvailableRoles.mockResolvedValue([
    { id: 'admin_id', name: 'Administrator' },
    { id: 'viewer_id', name: 'Viewer' },
  ]);
  api.getAccountSites.mockResolvedValue(['S2']);
  api.confirmOwnPassword.mockResolvedValue('T0K');
});

describe('Accounts page', () => {
  it('offers edit on every local account but delete only on others than you and the main admin', async () => {
    mount();
    expect(await screen.findByText('root (you)')).toBeTruthy();
    expect(screen.getByLabelText('Edit root')).toBeTruthy();
    expect(screen.queryByLabelText('Delete root')).toBeNull();
    expect(screen.getByLabelText('Delete bob')).toBeTruthy();
  });

  it('adds an account after checking the password', async () => {
    api.addAccount.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(api.listAvailableRoles).toHaveBeenCalled());
    type(/^Username/, 'carol');
    type(/^Password/, 'weak');
    type(/^Confirm password/, 'weak');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/Use 8 to 128/)).toBeTruthy();
    expect(api.addAccount).not.toHaveBeenCalled();

    type(/^Password/, 'Str0ng!pw');
    type(/^Confirm password/, 'Str0ng!pw');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('carol was added.')).toBeTruthy();
    expect(api.addAccount).toHaveBeenCalledWith(
      { name: 'carol', password: 'Str0ng!pw', email: undefined, roleId: 'admin_id', alert: false, allSites: true, sites: [] },
      ['S1', 'S2'],
    );
  });

  it('edits an account with its own sites preselected, confirming a role change that moves its accounts', async () => {
    api.editAccount
      .mockRejectedValueOnce(new OmadaApiError('role change', -30135))
      .mockResolvedValueOnce(undefined);
    mount();
    fireEvent.click(await screen.findByLabelText('Edit bob'));
    await waitFor(() => expect(api.getAccountSites).toHaveBeenCalledWith('U1'));
    expect(await within(screen.getByRole('dialog')).findByText('Office')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('bob was updated.')).toBeTruthy();
    expect(api.editAccount).toHaveBeenLastCalledWith(
      users[1],
      expect.objectContaining({ name: 'bob', password: undefined, roleId: 'viewer_id', allSites: false, sites: ['S2'] }),
      ['S1', 'S2'],
      { token: undefined, forceModify: true },
    );
    expect(api.confirmOwnPassword).not.toHaveBeenCalled();
  });

  it('asks for your current password to edit yourself', async () => {
    api.editAccount.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByLabelText('Edit root'));
    expect(screen.queryByLabelText(/^Role/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter your current password.')).toBeTruthy();
    type(/^Your current password/, 'mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('root was updated.')).toBeTruthy();
    expect(api.confirmOwnPassword).toHaveBeenCalledWith('U0', 'mine');
    expect(api.editAccount.mock.calls[0][3]).toEqual({ token: 'T0K', forceModify: false });
  });

  it('deletes after confirming and shows the controller’s reason when it refuses', async () => {
    api.deleteAccount.mockRejectedValueOnce(new OmadaApiError('x', -30115)).mockResolvedValueOnce(undefined);
    mount();
    fireEvent.click(await screen.findByLabelText('Delete bob'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(dialog).findByText(/signed in right now/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('bob was deleted.')).toBeTruthy();
    expect(api.deleteAccount).toHaveBeenLastCalledWith('U1', expect.anything());
  });
});

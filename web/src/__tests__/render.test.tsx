// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Deterministic first-run gate: pretend the controller is already configured.
let initialized = true;
let registeredRoot = false;

vi.mock('../api/domains/restore', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/domains/restore')>();
  return {
    ...mod,
    getControllerIdentity: vi.fn(async () => ({ omadacId: 'cid', configured: initialized, registeredRoot })),
  };
});

vi.mock('../api/domains/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/domains/auth')>();
  return {
    ...mod,
    getInitialization: vi.fn(async () => ({ configured: initialized })),
    getControllerInfo: vi.fn(async () => ({ controllerName: 'Test Controller' })),
  };
});
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { theme } from '../theme';
import { AuthProvider } from '../auth/AuthContext';
import App from '../App';

function mountAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.pushState({}, '', path);
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('app render (full main.tsx stack)', () => {
  it('shows login form at / when unauthenticated', async () => {
    localStorage.clear();
    mountAt('/');
    // InitGate resolves asynchronously — wait for the login form.
    await waitFor(() => expect(screen.getByLabelText(/username/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('starts the setup wizard with the admin account on a new controller', async () => {
    initialized = false;
    registeredRoot = false;
    localStorage.clear();
    mountAt('/');
    await waitFor(() => expect(screen.getByText(/welcome to omada/i)).toBeTruthy());
    expect(screen.getByLabelText(/admin username/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
    initialized = true;
  });

  it('offers scratch or restore once the admin account exists', async () => {
    initialized = false;
    registeredRoot = true;
    localStorage.clear();
    mountAt('/setup');
    await waitFor(() => expect(screen.getByText(/set up your controller/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /restore from backup/i })).toBeTruthy();
    screen.getByRole('button', { name: /set up from scratch/i }).click();
    await waitFor(() => expect(screen.getByLabelText(/controller name/i)).toBeTruthy());
    initialized = true;
  });
});

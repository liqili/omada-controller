import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './auth/AuthContext';
import { SiteProvider } from './hooks/useSiteContext';
import { useInitialization } from './hooks/queries';
import { AppShell } from './layout/AppShell';
import LoginPage from './pages/LoginPage';

// Every page but login is its own chunk, fetched on first visit (the sign-in
// page stays in the main bundle so it paints at once). AppShell shows a
// spinner in the content area while a page loads.
const SetupPage = lazy(() => import('./pages/SetupPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const WlanPage = lazy(() => import('./pages/WlanPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const RfPlanningPage = lazy(() => import('./pages/RfPlanningPage'));
const SiteSettingsPage = lazy(() => import('./pages/SiteSettingsPage'));
const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const AccessControlPage = lazy(() => import('./pages/AccessControlPage'));
const GuestControlPage = lazy(() => import('./pages/GuestControlPage'));
const NetworkPage = lazy(() => import('./pages/NetworkPage'));
const VpnPage = lazy(() => import('./pages/VpnPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));
const UpgradesPage = lazy(() => import('./pages/UpgradesPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

// Layout guard: authenticated renders children via <Outlet/>, else redirects.
function RequireAuth() {
  const { authenticated } = useAuth();
  return authenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

// First-run gate: an un-initialized controller only serves the setup wizard.
function InitGate() {
  const { data, isPending } = useInitialization();
  if (isPending) return <FullPageSpinner />;
  if (data && !data.configured) return <Navigate to="/setup" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/setup"
        element={
          <Suspense fallback={<FullPageSpinner />}>
            <SetupPage />
          </Suspense>
        }
      />
      <Route element={<InitGate />}>
        <Route path="/login" element={<LoginPage />} />
        {/* SiteProvider sits behind the guard so no controller call happens
            before a token exists (unauthenticated calls 302 and break). */}
        <Route element={<RequireAuth />}>
          <Route
            element={
              <SiteProvider>
                <Outlet />
              </SiteProvider>
            }
          >
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="devices/:mac" element={<DeviceDetailPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="wlan" element={<WlanPage />} />
              <Route path="rf-planning" element={<RfPlanningPage />} />
              <Route path="logs" element={<LogsPage />} />
              <Route path="network" element={<NetworkPage />} />
              <Route path="vpn" element={<VpnPage />} />
              <Route path="authentication" element={<AccessControlPage />} />
              <Route path="guest" element={<GuestControlPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="site" element={<SiteSettingsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="accounts" element={<UsersPage />} />
              <Route path="upgrades" element={<UpgradesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

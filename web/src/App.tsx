import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from './auth/AuthContext';
import { SiteProvider } from './hooks/useSiteContext';
import { useInitialization } from './hooks/queries';
import { AppShell } from './layout/AppShell';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import DevicesPage from './pages/DevicesPage';
import DeviceDetailPage from './pages/DeviceDetailPage';
import ClientsPage from './pages/ClientsPage';
import WlanPage from './pages/WlanPage';
import SettingsPage from './pages/SettingsPage';
import RfPlanningPage from './pages/RfPlanningPage';
import SiteSettingsPage from './pages/SiteSettingsPage';
import ServicesPage from './pages/ServicesPage';
import AccessControlPage from './pages/AccessControlPage';
import GuestControlPage from './pages/GuestControlPage';
import NetworkPage from './pages/NetworkPage';
import VpnPage from './pages/VpnPage';
import LogsPage from './pages/LogsPage';
import UpgradesPage from './pages/UpgradesPage';
import UsersPage from './pages/UsersPage';

// Layout guard: authenticated renders children via <Outlet/>, else redirects.
function RequireAuth() {
  const { authenticated } = useAuth();
  return authenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

// First-run gate: an un-initialized controller only serves the setup wizard.
function InitGate() {
  const { data, isPending } = useInitialization();
  if (isPending) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (data && !data.configured) return <Navigate to="/setup" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
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

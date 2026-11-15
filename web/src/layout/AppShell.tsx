import { Suspense, useState, type ReactNode } from 'react';
import {
  AppBar,
  Box,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Select,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import RouterIcon from '@mui/icons-material/Router';
import DevicesIcon from '@mui/icons-material/Devices';
import WifiIcon from '@mui/icons-material/Wifi';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import VpnLockIcon from '@mui/icons-material/VpnLock';
import NotificationsIcon from '@mui/icons-material/Notifications';
import InsightsIcon from '@mui/icons-material/Insights';
import MiscellaneousServicesIcon from '@mui/icons-material/MiscellaneousServices';
import PeopleIcon from '@mui/icons-material/People';
import LanIcon from '@mui/icons-material/Lan';
import SupervisedUserCircleIcon from '@mui/icons-material/SupervisedUserCircle';
import UploadIcon from '@mui/icons-material/Upload';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import TuneIcon from '@mui/icons-material/Tune';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSites, useSite } from '../hooks/useSiteContextBridge';
import { useAlertNum } from '../hooks/queries';

const DRAWER_WIDTH = 240;

interface NavItem {
  label: string;
  icon: ReactNode;
  path?: string; // undefined → coming soon
  /** Show the site's unarchived alert count next to the label. */
  badge?: 'alerts';
}

// Compact rows so the whole menu fits most viewports; the list scrolls on
// short ones.
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Monitor',
    items: [
      { label: 'Dashboard', icon: <DashboardIcon />, path: '/' },
      { label: 'Devices', icon: <RouterIcon />, path: '/devices' },
      { label: 'Clients', icon: <DevicesIcon />, path: '/clients' },
      { label: 'Logs', icon: <NotificationsIcon />, path: '/logs', badge: 'alerts' },
      { label: 'Insight', icon: <InsightsIcon /> },
    ],
  },
  {
    section: 'Site',
    items: [
      { label: 'Wireless', icon: <WifiIcon />, path: '/wlan' },
      { label: 'Network', icon: <LanIcon />, path: '/network' },
      { label: 'VPN', icon: <VpnLockIcon />, path: '/vpn' },
      { label: 'Authentication', icon: <AdminPanelSettingsIcon />, path: '/authentication' },
      { label: 'Guest control', icon: <SupervisedUserCircleIcon />, path: '/guest' },
      { label: 'Services', icon: <MiscellaneousServicesIcon />, path: '/services' },
      { label: 'RF planning', icon: <SettingsInputAntennaIcon />, path: '/rf-planning' },
      { label: 'Site settings', icon: <TuneIcon />, path: '/site' },
    ],
  },
  {
    section: 'Controller',
    items: [
      { label: 'Controller settings', icon: <SettingsIcon />, path: '/settings' },
      { label: 'Accounts', icon: <PeopleIcon />, path: '/accounts' },
      { label: 'Upgrades', icon: <UploadIcon />, path: '/upgrades' },
    ],
  },
];

export function AppShell() {
  const theme = useTheme();
  const permanent = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { controllerName, logout } = useAuth();
  const { siteId, setSiteId } = useSite();
  const { data: sites = [] } = useSites();
  const navigate = useNavigate();
  const alertNum = useAlertNum(siteId).data ?? 0;

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Desktop: transparent spacer so nav starts below the full-width AppBar. */}
      {permanent ? <Toolbar /> : (
        <>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
              {controllerName}
            </Typography>
          </Box>
          <Divider />
        </>
      )}
      <List dense disablePadding sx={{ flex: 1, py: 0.5, overflowY: 'auto' }}>
        {NAV.map((group) => (
          <Box key={group.section} component="li" sx={{ display: 'block' }}>
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 1, pb: 0.25, display: 'block', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {group.section}
            </Typography>
            {group.items.map((item) =>
              item.path ? (
                <ListItemButton
                  key={item.label}
                  component={NavLink}
                  to={item.path}
                  end={item.path === '/'}
                  onClick={() => setMobileOpen(false)}
                  sx={{ py: 0.5, minHeight: 36 }}
                >
                  <ListItemIcon sx={{ minWidth: 36, '& .MuiSvgIcon-root': { fontSize: 21 } }}>{item.icon}</ListItemIcon>
                  <ListItemText primaryTypographyProps={{ fontSize: 14 }}>{item.label}</ListItemText>
                  {item.badge === 'alerts' && alertNum > 0 && (
                    <Chip size="small" color="error" label={alertNum > 99 ? '99+' : alertNum} sx={{ height: 20 }} />
                  )}
                </ListItemButton>
              ) : (
                <ListItemButton key={item.label} disabled sx={{ py: 0.5, minHeight: 36 }}>
                  <ListItemIcon sx={{ minWidth: 36, '& .MuiSvgIcon-root': { fontSize: 21 } }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    secondary="coming soon"
                    primaryTypographyProps={{ fontSize: 14 }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItemButton>
              ),
            )}
          </Box>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Full-width header: above the permanent drawer on desktop; on mobile
          the temporary drawer (modal) covers it while open. */}
      <AppBar position="fixed" sx={{ zIndex: permanent ? 1300 : (t) => t.zIndex.modal }}>
        <Toolbar sx={{ gap: 1 }}>
          {!permanent && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)} aria-label="menu">
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {permanent ? controllerName : 'Omada Dashboard'}
          </Typography>
          {sites.length > 0 && (
            <Select
              size="small"
              value={siteId ?? ''}
              onChange={(e) => setSiteId(e.target.value)}
              sx={{ minWidth: { xs: 120, sm: 180 }, color: 'inherit', '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,.4)' } }}
            >
              {sites.map((s) => (
                <MenuItem key={s._id} value={s._id}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          )}
          <Tooltip title="Log out">
            <IconButton
              color="inherit"
              aria-label="Log out"
              onClick={() => {
                navigate('/login', { replace: true });
                void logout();
              }}
            >
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        {permanent ? (
          <Drawer variant="permanent" open sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', overflow: 'hidden' } }}>
            {drawer}
          </Drawer>
        ) : (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', overflow: 'hidden' } }}
          >
            {drawer}
          </Drawer>
        )}
      </Box>
      {/* minWidth 0: as a flex item, main would otherwise grow to its widest
          child's natural width (e.g. a scrollable tab strip) and widen the page. */}
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, p: { xs: 1.5, sm: 3 }, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}
      >
        <Toolbar />
        {/* Pages are lazy-loaded (App.tsx): the shell stays while one downloads. */}
        <Suspense fallback={<CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />}>
          <Outlet />
        </Suspense>
      </Box>
    </Box>
  );
}

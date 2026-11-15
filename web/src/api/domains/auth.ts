import { api, unwrap, tokenStore } from '../client';
import type { LoginRequest, LoginResult } from '../types';

// Login contract verified live against v5.15.6.7:
//   POST /api/v2/login {"username":"…","password":"…"}
//   → {"errorCode":0,"msg":"Log in successfully.","result":{"omadacId":"…","token":"…"}}
//   — sets the Shiro cookie TPOMADA_SESSIONID; the token doubles as the
//     session CSRF token for every subsequent authenticated request.
//   bad credentials → {"errorCode":-30104,"msg":"Invalid username."}
export async function login(req: LoginRequest): Promise<LoginResult> {
  const data = await unwrap<LoginResult>(api.post('/api/v2/login', { ...req }));
  if (data?.token) tokenStore.set(data.token);
  if (data?.omadacId) tokenStore.setOmadacId(data.omadacId);
  return data;
}

/**
 * Ends the controller session. Never throws: signing out locally must work
 * even when the session is already gone (the controller allows one session
 * per account, so another sign-in ends ours) or the controller is down.
 */
export async function logout(): Promise<void> {
  const token = tokenStore.get();
  const omadacId = tokenStore.omadacId();
  tokenStore.clear();
  if (!token) return;
  try {
    // Omadac-scoped like every session call (vendor registry: system.logout =
    // "/{omadacId}/api/v2/logout"); unscoped it answers -1600 and the
    // controller session stays open. The store is already cleared, so the
    // header is set here.
    const path = omadacId ? `/${omadacId}/api/v2/logout` : '/api/v2/logout';
    await api.post(path, {}, { headers: { 'Csrf-Token': token }, timeout: 5000 });
  } catch {
    // Already signed out server-side, or unreachable — nothing left to do.
  }
}

export interface ControllerInfo {
  controllerName?: string;
  timeZone?: string;
  region?: string;
}

export async function getControllerInfo(): Promise<ControllerInfo> {
  return unwrap<ControllerInfo>(api.get('/api/v2/anon/controllerInfo'));
}

// Verified live: GET → {errorCode:0,result:{configured:false,…}} on a
// freshly initialized controller; configured:true once a local admin exists.
export interface InitializationInfo {
  configured: boolean;
  omadacloudUrl?: string;
  category?: string;
}

export async function getInitialization(): Promise<InitializationInfo> {
  return unwrap<InitializationInfo>(api.get('/api/v2/anon/initialization'));
}

// First-run wizard, step 1 (vendor "createRoot"): creates the Local Main
// Administrator before New Setup or Restore — a restore needs it, since a
// backup never carries the main admin ("restore failed because Local
// MasterAdmin not exist"). Body = vendor createRootM.
// Verified error codes: -1001 (password null), -30105 (invalid password),
// -30167 (account already registered).
export async function registerAdmin(req: LoginRequest & { email?: string }): Promise<void> {
  await unwrap<unknown>(
    api.post('/api/v2/anon/register', {
      username: req.username,
      password: req.password,
      ...(req.email ? { email: req.email } : {}),
      allowRemoteBinding: false,
    }),
  );
}

// "Config New Setup" wizard — verified live against v5.15.6.7.
// POST /api/v2/anon/cmd/wizardConfig (WizardConfigForLocalVO):
//   requires controllerName, region, timeZone; -30000 once configured:true.
//   Optional: username/password/email for the local admin (the wizard form
//   always supplies them), ssidName/ssidPassword for gateway default LAN.
export interface WizardLocalConfig {
  controllerName: string;
  region: string;
  timeZone: string;
  /** Omitted when the admin was created first via registerAdmin (vendor flow). */
  username?: string;
  password?: string;
  email?: string;
  cloudAccountLogin?: boolean;
  allowRemoteBinding?: boolean;
  expImprove?: boolean;
}

export async function submitWizardConfig(cfg: WizardLocalConfig): Promise<void> {
  await unwrap<unknown>(
    api.post('/api/v2/anon/cmd/wizardConfig', {
      cloudAccountLogin: false,
      allowRemoteBinding: false,
      expImprove: false,
      ...cfg,
    }),
  );
}

// Anonymous hint of the local main administrator username (pre-fills login).
export async function getLocalAdminHint(): Promise<string | null> {
  try {
    const r = await unwrap<{ localUserName?: string }>(api.get('/api/v2/anon/root'));
    return r?.localUserName ?? null;
  } catch {
    return null;
  }
}

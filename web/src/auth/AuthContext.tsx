import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tokenStore } from '../api/client';
import * as authApi from '../api/domains/auth';

interface AuthState {
  authenticated: boolean;
  controllerName: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => Boolean(tokenStore.get()));
  const [controllerName, setControllerName] = useState('Omada Controller');
  const queryClient = useQueryClient();

  useEffect(() => {
    authApi
      .getControllerInfo()
      .then((info) => info?.controllerName && setControllerName(info.controllerName))
      .catch(() => undefined);

    // Session ended elsewhere (401 / -1200 from the controller).
    const onLogout = () => {
      setAuthenticated(false);
      queryClient.cancelQueries();
      queryClient.clear();
    };
    window.addEventListener('omada:logout', onLogout);
    return () => window.removeEventListener('omada:logout', onLogout);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await authApi.login({ username, password });
    setAuthenticated(true);
  }, []);

  // Sign out locally first (state, token, cached data), then tell the
  // controller. The UI never waits on — or fails because of — that call.
  const logout = useCallback(async () => {
    setAuthenticated(false);
    const done = authApi.logout();
    queryClient.cancelQueries();
    queryClient.clear();
    await done;
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ authenticated, controllerName, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

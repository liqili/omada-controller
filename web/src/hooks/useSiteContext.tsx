import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSites } from './queries';

interface SiteState {
  siteId: string | undefined;
  setSiteId: (id: string) => void;
  siteName: string | undefined;
  loading: boolean;
}

const SiteContext = createContext<SiteState | null>(null);

const STORAGE_KEY = 'omada.siteId';

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data: sites = [], isLoading } = useSites();
  const [siteId, setSiteIdState] = useState<string | undefined>(() =>
    localStorage.getItem(STORAGE_KEY) ?? undefined,
  );

  const setSiteId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSiteIdState(id);
  };

  useEffect(() => {
    if (!isLoading && sites.length && (!siteId || !sites.some((s) => s._id === siteId))) {
      setSiteId(sites[0]._id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sites, siteId]);

  const siteName = sites.find((s) => s._id === siteId)?.name;

  return (
    <SiteContext.Provider value={{ siteId, setSiteId, siteName, loading: isLoading }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteState {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used within SiteProvider');
  return ctx;
}

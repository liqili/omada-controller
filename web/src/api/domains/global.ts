import { api, scoped, unwrap } from '../client';

// Controller-level settings — verified live against v5.15.6.7:
//   GET   /{omadacId}/api/v2/controller/setting
//   PATCH /{omadacId}/api/v2/controller/setting — vendor SPA's update verb
//     (proxy.update:{type:"PATCH"}). PUT/POST → -1600.
// PATCH rules (both verified live):
//   - echo the FULL object; a minimal body fails with errorCode -1
//   - strip `certificate` (own lifecycle API; echoing it → "-1001 cerId
//     should not be null")
export interface GlobalSetting {
  hardware?: boolean;
  general?: {
    name?: string;
    timeZone?: string;
    region?: string;
    ntpEnable?: boolean;
    ntpServers?: string[];
    [key: string]: unknown;
  };
  mailServer?: {
    smtpEnable?: boolean;
    sslEnable?: boolean;
    authEnable?: boolean;
    [key: string]: unknown;
  };
  webPort?: {
    manageHttpPort?: number;
    manageHttpsPort?: number;
    portalHttpPort?: number;
    portalHttpsPort?: number;
    hostName?: string;
    autoRefresh?: boolean;
    httpsRedirect?: boolean;
    autoPortalIpEnable?: boolean;
    portalHttpsRedirect?: boolean;
  };
  builtInRadiusServer?: {
    enable?: boolean;
    authServerPort?: number;
    tunnelReplyEnable?: boolean;
    status?: boolean;
    serverAddressType?: number;
  };
  radiusProxy?: { enable?: boolean; status?: boolean };
  deviceAccessManagement?: {
    webControlHttp?: boolean;
    webControlHttps?: boolean;
    appDiscovery?: boolean;
  };
  firmware?: { controllerNotification?: boolean };
  certificate?: unknown;
  [key: string]: unknown;
}

export async function getGlobalSetting(): Promise<GlobalSetting> {
  return unwrap<GlobalSetting>(api.get(scoped('/api/v2/controller/setting')));
}

export async function patchGlobalSetting(body: GlobalSetting): Promise<GlobalSetting> {
  const { certificate: _certificate, ...rest } = body;
  return unwrap<GlobalSetting>(api.patch(scoped('/api/v2/controller/setting'), rest));
}

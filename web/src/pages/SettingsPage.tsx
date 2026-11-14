import { useState } from 'react';
import { Alert, Box, CircularProgress, Stack, TextField } from '@mui/material';
import { useGlobalSetting, usePutGlobalSetting } from '../hooks/queries';
import type { GlobalSetting } from '../api/domains/global';
import {
  Fact,
  NumberField,
  PageTitle,
  SaveBar,
  SectionCard,
  Toast,
  ToggleRow,
  apiErrorText,
  onOff,
  useDraft,
} from '../components/SettingsKit';

// Controller settings — GET/PATCH controller/setting (live-verified on
// v5.15.6.7). The PATCH must echo the whole object minus `certificate`;
// patchGlobalSetting() takes care of that, so this page edits a full draft.

type SectionKey = 'general' | 'mailServer' | 'webPort' | 'builtInRadiusServer' | 'radiusProxy' | 'deviceAccessManagement' | 'firmware';

const portOk = (p: number | undefined) => p !== undefined && Number.isInteger(p) && p >= 1 && p <= 65535;

export default function SettingsPage() {
  const query = useGlobalSetting();
  const save = usePutGlobalSetting();
  const { draft, dirty, set, reset, markSaved } = useDraft<GlobalSetting>(query.data);
  const [toast, setToast] = useState<string | null>(null);

  if (query.isLoading) return <CircularProgress sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (query.error) return <Alert severity="error">{apiErrorText(query.error)}</Alert>;
  if (!draft) return null;

  function edit<K extends SectionKey>(key: K, patch: Partial<NonNullable<GlobalSetting[K]>>) {
    set({ [key]: { ...(draft![key] as object), ...patch } } as Partial<GlobalSetting>);
  }

  const { general, mailServer, webPort, builtInRadiusServer: radius, radiusProxy, deviceAccessManagement: access } = draft;
  const mail = (mailServer ?? {}) as Record<string, unknown>;
  const original = query.data?.webPort;
  const portsChanged =
    webPort?.manageHttpPort !== original?.manageHttpPort || webPort?.manageHttpsPort !== original?.manageHttpsPort;
  const valid =
    Boolean(general?.name?.trim()) &&
    [webPort?.manageHttpPort, webPort?.manageHttpsPort, webPort?.portalHttpPort, webPort?.portalHttpsPort].every(portOk) &&
    (!radius?.enable || portOk(radius.authServerPort)) &&
    (!mail.smtpEnable || Boolean(String(mail.smtpServer ?? '').trim()));

  const bar = (
    <SaveBar
      dirty={dirty}
      saving={save.isPending}
      disabled={!valid}
      onReset={() => {
        reset();
        save.reset();
      }}
      onSave={() =>
        save.mutate(draft, {
          onSuccess: () => {
            markSaved();
            setToast('Controller settings saved');
          },
        })
      }
    />
  );

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Controller settings" subtitle="Apply to the controller itself, across all sites." action={bar} />
      {save.isError && <Alert severity="error">{apiErrorText(save.error)}</Alert>}

      <SectionCard title="General">
        <TextField
          size="small"
          label="Controller name"
          value={general?.name ?? ''}
          onChange={(e) => edit('general', { name: e.target.value })}
          error={!general?.name?.trim()}
        />
        <TextField
          size="small"
          label="Time zone"
          value={general?.timeZone ?? ''}
          onChange={(e) => edit('general', { timeZone: e.target.value })}
          helperText="IANA zone id, e.g. Pacific/Auckland"
        />
        <Fact label="Country / region">{general?.region ?? '—'}</Fact>
        <ToggleRow
          label="Network time (NTP)"
          checked={Boolean(general?.ntpEnable)}
          onChange={(v) => edit('general', { ntpEnable: v })}
        />
        {general?.ntpEnable && (
          <TextField
            size="small"
            label="NTP servers"
            value={(general.ntpServers ?? []).join(', ')}
            onChange={(e) =>
              edit('general', {
                ntpServers: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            helperText="Up to two, separated by a comma"
          />
        )}
      </SectionCard>

      <SectionCard title="Access" subtitle="How browsers and guests reach the controller.">
        <TextField
          size="small"
          label="Controller hostname / IP"
          value={webPort?.hostName ?? ''}
          onChange={(e) => edit('webPort', { hostName: e.target.value })}
        />
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
          <NumberField
            label="Management HTTPS"
            value={webPort?.manageHttpsPort}
            min={1}
            max={65535}
            onChange={(v) => edit('webPort', { manageHttpsPort: v })}
          />
          <NumberField
            label="Management HTTP"
            value={webPort?.manageHttpPort}
            min={1}
            max={65535}
            onChange={(v) => edit('webPort', { manageHttpPort: v })}
          />
          <NumberField
            label="Portal HTTPS"
            value={webPort?.portalHttpsPort}
            min={1}
            max={65535}
            onChange={(v) => edit('webPort', { portalHttpsPort: v })}
          />
          <NumberField
            label="Portal HTTP"
            value={webPort?.portalHttpPort}
            min={1}
            max={65535}
            onChange={(v) => edit('webPort', { portalHttpPort: v })}
          />
        </Box>
        {portsChanged && (
          <Alert severity="warning">
            This dashboard reaches the controller on its management HTTPS port, and Docker publishes the current ports.
            After changing them, update docker-compose.yml and web/nginx.conf to match or both UIs stop responding.
          </Alert>
        )}
        <ToggleRow
          label="Redirect management HTTP to HTTPS"
          checked={Boolean(webPort?.httpsRedirect)}
          onChange={(v) => edit('webPort', { httpsRedirect: v })}
        />
        <ToggleRow
          label="Redirect portal HTTP to HTTPS"
          checked={Boolean(webPort?.portalHttpsRedirect)}
          onChange={(v) => edit('webPort', { portalHttpsRedirect: v })}
        />
        <ToggleRow
          label="Detect portal address automatically"
          checked={Boolean(webPort?.autoPortalIpEnable)}
          onChange={(v) => edit('webPort', { autoPortalIpEnable: v })}
        />
        <ToggleRow
          label="Auto-refresh"
          checked={Boolean(webPort?.autoRefresh)}
          onChange={(v) => edit('webPort', { autoRefresh: v })}
        />
      </SectionCard>

      <SectionCard title="Mail server" subtitle="Used for alert emails and password resets.">
        <ToggleRow label="SMTP" checked={Boolean(mail.smtpEnable)} onChange={(v) => edit('mailServer', { smtpEnable: v })} />
        {Boolean(mail.smtpEnable) && (
          <>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="SMTP server"
                value={String(mail.smtpServer ?? '')}
                onChange={(e) => edit('mailServer', { smtpServer: e.target.value })}
                error={!String(mail.smtpServer ?? '').trim()}
                sx={{ flexGrow: 1 }}
              />
              <NumberField
                label="Port"
                value={mail.port as number | undefined}
                min={1}
                max={65535}
                onChange={(v) => edit('mailServer', { port: v })}
                sx={{ width: 120 }}
              />
            </Box>
            <TextField
              size="small"
              label="Sender address"
              value={String(mail.senderAddress ?? '')}
              onChange={(e) => edit('mailServer', { senderAddress: e.target.value })}
            />
            <ToggleRow
              label="Use SSL/TLS"
              checked={Boolean(mail.sslEnable)}
              onChange={(v) => edit('mailServer', { sslEnable: v })}
            />
            <ToggleRow
              label="Server requires sign-in"
              checked={Boolean(mail.authEnable)}
              onChange={(v) => edit('mailServer', { authEnable: v })}
            />
            {Boolean(mail.authEnable) && (
              <>
                <TextField
                  size="small"
                  label="Username"
                  value={String(mail.username ?? '')}
                  onChange={(e) => edit('mailServer', { username: e.target.value })}
                  autoComplete="off"
                />
                <TextField
                  size="small"
                  label="Password"
                  type="password"
                  value={String(mail.password ?? '')}
                  onChange={(e) => edit('mailServer', { password: e.target.value })}
                  autoComplete="new-password"
                />
              </>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="RADIUS">
        <ToggleRow
          label="Built-in RADIUS server"
          checked={Boolean(radius?.enable)}
          onChange={(v) => edit('builtInRadiusServer', { enable: v })}
        />
        {radius?.enable && (
          <>
            <NumberField
              label="Authentication port"
              value={radius.authServerPort}
              min={1}
              max={65535}
              onChange={(v) => edit('builtInRadiusServer', { authServerPort: v })}
              sx={{ width: 200 }}
            />
            <ToggleRow
              label="Tunnel reply"
              checked={Boolean(radius.tunnelReplyEnable)}
              onChange={(v) => edit('builtInRadiusServer', { tunnelReplyEnable: v })}
            />
          </>
        )}
        <Fact label="Server running">{onOff(radius?.status)}</Fact>
        <ToggleRow
          label="RADIUS proxy"
          checked={Boolean(radiusProxy?.enable)}
          onChange={(v) => edit('radiusProxy', { enable: v })}
        />
      </SectionCard>

      <SectionCard title="Device management">
        <ToggleRow
          label="Web control over HTTP"
          checked={Boolean(access?.webControlHttp)}
          onChange={(v) => edit('deviceAccessManagement', { webControlHttp: v })}
        />
        <ToggleRow
          label="Web control over HTTPS"
          checked={Boolean(access?.webControlHttps)}
          onChange={(v) => edit('deviceAccessManagement', { webControlHttps: v })}
        />
        <ToggleRow
          label="App discovery"
          checked={Boolean(access?.appDiscovery)}
          onChange={(v) => edit('deviceAccessManagement', { appDiscovery: v })}
        />
        <ToggleRow
          label="Notify about new controller versions"
          checked={Boolean(draft.firmware?.controllerNotification)}
          onChange={(v) => edit('firmware', { controllerNotification: v })}
        />
      </SectionCard>

      {dirty && bar}
      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

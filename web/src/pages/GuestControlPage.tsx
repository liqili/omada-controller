import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useSite } from '../hooks/useSiteContextBridge';
import { useVouchers } from '../hooks/queries';
import { ResponsiveList } from '../components/ResponsiveList';
import { ListSection, PageTitle, ResourceCard, ToggleRow, apiErrorText, onOff } from '../components/SettingsKit';
import type { Voucher } from '../api/domains/admin';

// Guest access — captive portals, their access rules and hotspot vouchers.
// Controller v5.15.6.7:
//   setting/portals          GET ✅ (array). Create/edit lives on
//                            setting/portals/{id}; its body is not pinned down.
//   setting/accessControl    GET ✅ PATCH ✅ (toggle on → off verified 2026-11-13)
//   hotspot/sites/{sid}/vouchers GET ✅ (grid)

interface Portal {
  id?: string;
  name?: string;
  enable?: boolean;
  ssidList?: unknown[];
  networkList?: unknown[];
}

interface AccessControl {
  preAuthAccessEnable?: boolean;
  preAuthAccessPolicies?: unknown[];
  freeAuthClientEnable?: boolean;
  freeAuthClientPolicies?: unknown[];
}

export default function GuestControlPage() {
  const { siteId } = useSite();
  const vouchers = useVouchers(siteId);

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <PageTitle title="Guest control" subtitle="Captive portals and vouchers for visitors." />

      <ListSection<Portal>
        siteId={siteId}
        resource="portals"
        title="Portals"
        subtitle="A portal shows a sign-in page before guests get online."
        keyOf={(p, i) => p.id ?? String(i)}
        emptyText="No portals yet. Create one in the vendor UI — it will show up here."
        columns={[
          { header: 'Name', render: (p) => p.name ?? '—' },
          { header: 'Status', render: (p) => onOff(p.enable) },
          { header: 'SSIDs', render: (p) => p.ssidList?.length ?? 0, hideOnMobile: true },
        ]}
      />

      <ResourceCard<AccessControl>
        siteId={siteId}
        resource="accessControl"
        verb="PATCH"
        title="Portal access control"
        subtitle="Exceptions to the portal sign-in."
      >
        {(d, set) => (
          <>
            <ToggleRow
              label="Pre-authentication access"
              hint={`Destinations guests can reach before signing in · ${d.preAuthAccessPolicies?.length ?? 0} rules`}
              checked={Boolean(d.preAuthAccessEnable)}
              onChange={(v) => set({ preAuthAccessEnable: v })}
            />
            <ToggleRow
              label="Authentication-free clients"
              hint={`Devices that skip the portal · ${d.freeAuthClientPolicies?.length ?? 0} rules`}
              checked={Boolean(d.freeAuthClientEnable)}
              onChange={(v) => set({ freeAuthClientEnable: v })}
            />
          </>
        )}
      </ResourceCard>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="subtitle1">Vouchers</Typography>
          {vouchers.data && <Chip size="small" label={vouchers.data.total} />}
        </Box>
        {vouchers.isLoading && <CircularProgress size={22} />}
        {vouchers.error && <Alert severity="info">{apiErrorText(vouchers.error)}</Alert>}
        {vouchers.data && (
          <ResponsiveList<Voucher>
            rows={vouchers.data.rows}
            keyOf={(v) => v.id ?? v.code ?? ''}
            emptyText="No vouchers have been generated."
            columns={[
              { header: 'Code', render: (v) => v.code ?? '—' },
              { header: 'Duration', render: (v) => (v.duration ? `${v.duration} min` : '—') },
              { header: 'Note', render: (v) => v.note ?? '—', hideOnMobile: true },
            ]}
          />
        )}
      </Box>
    </Stack>
  );
}

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useSite } from '../hooks/useSiteContextBridge';
import { useSsidMutations, useSsids, useWlanGroupMutations, useWlanGroups } from '../hooks/queries';
import {
  BAND_2G,
  BAND_5G,
  BAND_6G,
  SECURITY,
  SECURITY_LABEL,
  type Ssid,
  type WlanGroup,
} from '../api/domains/wlan';
import SsidDialog from './wlan/SsidDialog';
import { ResponsiveList, type Column } from '../components/ResponsiveList';
import { PageTitle, Toast, apiErrorText } from '../components/SettingsKit';

const bandText = (band: number) =>
  [
    [BAND_2G, '2.4 GHz'],
    [BAND_5G, '5 GHz'],
    [BAND_6G, '6 GHz'],
  ]
    .filter(([bit]) => band & (bit as number))
    .map(([, label]) => label)
    .join(' · ') || '—';

/** Legacy list wording: OWE / Enhanced Open for open networks. */
const securityText = (s: Ssid) => {
  if (s.security === SECURITY.NONE) {
    if (s.oweEnable) return 'OWE';
    return s.band === BAND_6G ? 'Enhanced Open' : 'None';
  }
  return SECURITY_LABEL[s.security] ?? `Mode ${s.security}`;
};

const vlanText = (s: Ssid) => {
  const v = s.vlanSetting as { mode?: number; currentVlanId?: number; customConfig?: { vlanId?: number } } | undefined;
  return v?.mode === 1 ? String(v.currentVlanId ?? v.customConfig?.vlanId ?? 'Custom') : '—';
};

function GroupDialog({
  group,
  saving,
  error,
  onClose,
  onSave,
}: {
  group: WlanGroup | null;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const ok = name.trim().length > 0 && name.trim().length <= 128;
  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{group ? 'Rename WLAN group' : 'New WLAN group'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField label="Group name" value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth />
          {Boolean(error) && <Alert severity="error">{apiErrorText(error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" disabled={!ok || saving} onClick={() => onSave(name)}>
          {group ? 'Rename' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type Confirm = { kind: 'ssid'; ssid: Ssid } | { kind: 'group'; group: WlanGroup };

export default function WlanPage() {
  const { siteId } = useSite();
  const groups = useWlanGroups(siteId);
  const groupList = groups.data?.groups ?? [];
  const [wlanId, setWlanId] = useState<string>();
  const group = groupList.find((g) => g.id === wlanId);
  const ssids = useSsids(siteId, group?.id);
  const ssidMut = useSsidMutations(siteId, group?.id);
  const groupMut = useWlanGroupMutations(siteId);

  // null = closed; 'new' = create; otherwise the row being edited.
  const [editing, setEditing] = useState<Ssid | 'new' | null>(null);
  const [groupDialog, setGroupDialog] = useState<'new' | 'rename' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Follow the site: default to its primary group whenever the selection is gone.
  useEffect(() => {
    if (groupList.length && !groupList.some((g) => g.id === wlanId)) {
      setWlanId((groupList.find((g) => g.primary) ?? groupList[0]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.data]);

  const rows = ssids.data?.ssids ?? [];
  const limits = groups.data;
  const counts = ssids.data;

  const columns: Column<Ssid>[] = [
    { header: 'Network', render: (s) => s.name },
    { header: 'Band', render: (s) => bandText(s.band) },
    {
      header: 'Security',
      render: (s) => (
        <Chip
          size="small"
          variant="outlined"
          color={s.security === SECURITY.NONE && !s.oweEnable ? 'warning' : 'default'}
          label={securityText(s)}
        />
      ),
    },
    { header: 'Guest', render: (s) => (s.guestNetEnable ? 'Yes' : 'No'), hideOnMobile: true },
    { header: 'Broadcast', render: (s) => (s.broadcast ? 'Yes' : 'Hidden'), hideOnMobile: true },
    { header: 'VLAN', render: vlanText, hideOnMobile: true },
    {
      header: '',
      render: (s) => (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => setConfirm({ kind: 'ssid', ssid: s })}
              aria-label={`Delete ${s.name}`}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  const closeSsidDialog = () => {
    setEditing(null);
    ssidMut.save.reset();
  };
  const closeGroupDialog = () => {
    setGroupDialog(null);
    groupMut.create.reset();
    groupMut.rename.reset();
  };
  const deleting = ssidMut.remove.isPending || groupMut.remove.isPending;
  const deleteError = ssidMut.remove.error ?? groupMut.remove.error;

  return (
    <Stack spacing={2}>
      <PageTitle
        title="Wireless networks"
        subtitle="SSIDs live in WLAN groups; each access point broadcasts the networks of one group."
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!group}
            onClick={() => group && setEditing('new')}
          >
            Add network
          </Button>
        }
      />

      {groups.isLoading && <CircularProgress sx={{ mx: 'auto' }} />}
      {groups.error && <Alert severity="error">{apiErrorText(groups.error)}</Alert>}

      {groupList.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label="WLAN group"
            value={group?.id ?? ''}
            onChange={(e) => setWlanId(e.target.value)}
            sx={{ minWidth: 200, flexGrow: { xs: 1, sm: 0 } }}
          >
            {groupList.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
                {g.primary ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <Button size="small" onClick={() => setGroupDialog('new')}>
            New group
          </Button>
          <Button size="small" disabled={!group} onClick={() => setGroupDialog('rename')}>
            Rename
          </Button>
          <Tooltip title={group?.primary ? 'The default group cannot be deleted' : ''}>
            <span>
              <Button
                size="small"
                color="error"
                disabled={!group || group.primary}
                onClick={() => group && setConfirm({ kind: 'group', group })}
              >
                Delete group
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}

      {counts && limits && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={`2.4 GHz ${counts.ssidNum2g ?? 0}/${limits.maxSsids2G ?? 8}`} />
          <Chip size="small" label={`5 GHz ${counts.ssidNum5g ?? 0}/${limits.maxSsids5G ?? 8}`} />
          <Chip size="small" label={`6 GHz ${counts.ssidNum6g ?? 0}/${limits.maxSsids6G ?? 8}`} />
        </Box>
      )}

      {ssids.isLoading && <CircularProgress sx={{ mx: 'auto' }} />}
      {ssids.error && <Alert severity="error">{apiErrorText(ssids.error)}</Alert>}
      {ssids.data && (
        <ResponsiveList
          rows={rows}
          columns={columns}
          keyOf={(s) => s.id ?? s.name}
          onClickRow={(s) => setEditing(s)}
          emptyText="No wireless networks in this group yet. Add one — access points pick it up as soon as they are adopted."
        />
      )}

      {editing && group && siteId && (
        <SsidDialog
          siteId={siteId}
          wlanId={group.id}
          row={editing === 'new' ? undefined : editing}
          list={ssids.data}
          limits={limits}
          saving={ssidMut.save.isPending}
          error={ssidMut.save.error}
          onClose={closeSsidDialog}
          onSave={(body) =>
            ssidMut.save.mutate(
              { id: editing === 'new' ? undefined : editing.id, body },
              {
                onSuccess: () => {
                  setToast(editing === 'new' ? `${body.name} created` : `${body.name} saved`);
                  closeSsidDialog();
                },
              },
            )
          }
        />
      )}

      {groupDialog && (
        <GroupDialog
          group={groupDialog === 'rename' ? (group ?? null) : null}
          saving={groupMut.create.isPending || groupMut.rename.isPending}
          error={groupMut.create.error ?? groupMut.rename.error}
          onClose={closeGroupDialog}
          onSave={(name) => {
            if (groupDialog === 'rename' && group) {
              groupMut.rename.mutate(
                { wlanId: group.id, name },
                {
                  onSuccess: () => {
                    setToast('Group renamed');
                    closeGroupDialog();
                  },
                },
              );
            } else {
              groupMut.create.mutate(name, {
                onSuccess: (id) => {
                  if (id) setWlanId(id);
                  setToast('Group created');
                  closeGroupDialog();
                },
              });
            }
          }}
        />
      )}

      {confirm && (
        <Dialog open onClose={deleting ? undefined : () => setConfirm(null)} maxWidth="xs" fullWidth>
          <DialogTitle>
            Delete {confirm.kind === 'ssid' ? confirm.ssid.name : `group ${confirm.group.name}`}?
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.kind === 'ssid'
                ? 'Clients on this network are disconnected. This cannot be undone.'
                : 'Every network in this group is deleted with it. This cannot be undone.'}
            </DialogContentText>
            {Boolean(deleteError) && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {apiErrorText(deleteError)}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={deleting}
              onClick={() => {
                const done = (msg: string) => () => {
                  setToast(msg);
                  setConfirm(null);
                };
                if (confirm.kind === 'ssid') {
                  ssidMut.remove.mutate(confirm.ssid.id!, { onSuccess: done(`${confirm.ssid.name} deleted`) });
                } else {
                  groupMut.remove.mutate(confirm.group.id, { onSuccess: done('Group deleted') });
                }
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
    </Stack>
  );
}

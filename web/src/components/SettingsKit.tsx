import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
  type TextFieldProps,
} from '@mui/material';
import { OmadaApiError } from '../api/client';
import type { SaveVerb } from '../api/domains/settings';
import { useSaveSetting, useSetting, useSettingList } from '../hooks/queries';
import { ResponsiveList, type Column } from './ResponsiveList';

// Building blocks shared by every settings page: a page header, cards, toggle
// rows, a draft/save cycle for object-shaped resources and a read-only table
// for list-shaped ones.

/** Controller error → something a person can act on. */
export function apiErrorText(e: unknown): string {
  if (e instanceof OmadaApiError && e.errorCode === -1600) {
    return 'The controller does not offer this yet — it usually appears once a matching device (gateway, switch or AP) is adopted.';
  }
  return (e as Error)?.message || 'Request failed';
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1">{title}</Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Box>
        <Stack spacing={1.5}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 40 }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {hint}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        disabled={disabled || !onChange}
        onChange={(e) => onChange?.(e.target.checked)}
        inputProps={{ 'aria-label': label }}
      />
    </Box>
  );
}

/** Numeric TextField that reports a number (or undefined while empty). */
export function NumberField({
  value,
  onChange,
  min,
  max,
  ...rest
}: Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
}) {
  const out = value !== undefined && ((min !== undefined && value < min) || (max !== undefined && value > max));
  return (
    <TextField
      size="small"
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      error={out}
      helperText={out ? `Must be between ${min} and ${max}` : rest.helperText}
      inputProps={{ min, max, inputMode: 'numeric' }}
      {...rest}
    />
  );
}

/** A label/value line for read-only facts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

export const onOff = (v: unknown) => (
  <Chip size="small" variant="outlined" color={v ? 'success' : 'default'} label={v ? 'On' : 'Off'} />
);

/** Local editable copy of server data; re-syncs whenever there are no unsaved edits. */
export function useDraft<T extends object>(data: T | null | undefined) {
  const [draft, setDraft] = useState<T | undefined>(data ?? undefined);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setDraft(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return {
    draft,
    dirty,
    set: (patch: Partial<T>) => {
      setDraft((d) => (d ? { ...d, ...patch } : d));
      setDirty(true);
    },
    reset: () => {
      setDraft(data ?? undefined);
      setDirty(false);
    },
    markSaved: () => setDirty(false),
  };
}

export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  disabled,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
      <Button variant="contained" size="small" disabled={!dirty || saving || disabled} onClick={onSave}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
      <Button size="small" disabled={!dirty || saving} onClick={onReset}>
        Discard
      </Button>
    </Box>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Snackbar
      open={Boolean(message)}
      autoHideDuration={3000}
      onClose={onClose}
      message={message}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    />
  );
}

/**
 * Card bound to one object-shaped setting resource: loads it, lets `children`
 * render fields against a draft, and saves the whole object back with the
 * resource's own verb.
 */
export function ResourceCard<T extends object>({
  siteId,
  resource,
  verb,
  title,
  subtitle,
  valid,
  toBody,
  children,
}: {
  siteId: string | undefined;
  resource: string;
  verb: SaveVerb;
  title: string;
  subtitle?: string;
  /** Return false to block saving (e.g. a field is out of range). */
  valid?: (draft: T) => boolean;
  /** Shape the request body when it is not simply the whole draft. */
  toBody?: (draft: T) => unknown;
  children: (draft: T, set: (patch: Partial<T>) => void) => ReactNode;
}) {
  const query = useSetting<T>(siteId, resource);
  const save = useSaveSetting(siteId, resource, verb);
  const { draft, dirty, set, reset, markSaved } = useDraft<T>(query.data);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <SectionCard title={title} subtitle={subtitle}>
      {query.isLoading && <CircularProgress size={22} />}
      {query.error && <Alert severity="info">{apiErrorText(query.error)}</Alert>}
      {draft && (
        <>
          {children(draft, set)}
          {save.isError && <Alert severity="error">{apiErrorText(save.error)}</Alert>}
          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            disabled={valid ? !valid(draft) : false}
            onReset={() => {
              reset();
              save.reset();
            }}
            onSave={() =>
              save.mutate(toBody ? toBody(draft) : draft, {
                onSuccess: () => {
                  markSaved();
                  setToast(`${title} saved`);
                },
              })
            }
          />
        </>
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </SectionCard>
  );
}

/** Read-only table bound to one list-shaped setting resource. */
export function ListSection<T = Record<string, unknown>>({
  siteId,
  resource,
  params,
  title,
  subtitle,
  columns,
  keyOf,
  emptyText,
}: {
  siteId: string | undefined;
  resource: string;
  params?: Record<string, unknown>;
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  keyOf: (row: T, index: number) => string;
  emptyText?: string;
}) {
  const { data, isLoading, error } = useSettingList<T>(siteId, resource, params);
  const rows = data?.rows ?? [];
  const indexed = rows.map((row, i) => ({ row, key: keyOf(row, i) }));

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle1">{title}</Typography>
        {data && <Chip size="small" label={data.total} />}
      </Box>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {subtitle}
        </Typography>
      )}
      {isLoading && <CircularProgress size={22} />}
      {error && <Alert severity="info">{apiErrorText(error)}</Alert>}
      {data && (
        <ResponsiveList
          rows={indexed}
          columns={columns.map((c) => ({ ...c, render: (r: { row: T }) => c.render(r.row) }))}
          keyOf={(r) => r.key}
          emptyText={emptyText ?? 'Nothing configured yet.'}
        />
      )}
    </Box>
  );
}

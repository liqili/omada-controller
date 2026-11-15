import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useCreateTimeRange } from '../../hooks/queries';
import { apiErrorText } from '../../components/SettingsKit';
import {
  DAY_MODE,
  DAY_NAMES,
  DEFAULT_SLOT,
  MAX_SLOTS,
  STEP_MINUTES,
  clock,
  emptyTimeRangeForm,
  overlapping,
  slotCount,
  timeRangeProblem,
  type Slot,
  type TimeRangeForm,
} from '../../api/domains/timeRange';

const TIMES = Array.from({ length: 24 * 60 / STEP_MINUTES + 1 }, (_, i) => i * STEP_MINUTES);

function SlotRows({
  slots,
  onChange,
  canAdd,
  label,
}: {
  slots: Slot[];
  onChange: (s: Slot[]) => void;
  canAdd: boolean;
  label: string;
}) {
  const bad = overlapping(slots);
  const put = (i: number, s: Partial<Slot>) => onChange(slots.map((x, j) => (j === i ? { ...x, ...s } : x)));
  return (
    <Stack spacing={1}>
      {slots.map((s, i) => {
        const problem = s.end <= s.start ? 'Ends before it starts.' : bad.has(i) ? 'Overlaps another slot.' : null;
        return (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            {(['start', 'end'] as const).map((k) => (
              <TextField
                key={k}
                select
                size="small"
                label={k === 'start' ? 'From' : 'To'}
                value={s[k]}
                onChange={(e) => put(i, { [k]: Number(e.target.value) })}
                error={Boolean(problem)}
                helperText={k === 'end' ? (problem ?? ' ') : ' '}
                inputProps={{ 'aria-label': `${label} slot ${i + 1} ${k === 'start' ? 'from' : 'to'}` }}
                sx={{ width: 120 }}
                SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 280 } } } }}
              >
                {TIMES.filter((t) => (k === 'start' ? t < 1440 : t > 0)).map((t) => (
                  <MenuItem key={t} value={t}>
                    {clock(t)}
                  </MenuItem>
                ))}
              </TextField>
            ))}
            {slots.length > 1 && (
              <IconButton aria-label={`Remove ${label} slot ${i + 1}`} onClick={() => onChange(slots.filter((_, j) => j !== i))} sx={{ mt: 0.5 }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        );
      })}
      <Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={!canAdd}
          onClick={() => {
            const last = slots[slots.length - 1];
            // Next free hour after the last slot, so a new row doesn't overlap.
            const start = last ? Math.min(last.end + 60, 1440 - 60) : DEFAULT_SLOT.start;
            onChange([...slots, { start, end: Math.min(start + 60, 1440) }]);
          }}
        >
          Add time slot
        </Button>
        {!canAdd && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            Up to {MAX_SLOTS} slots in all.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/**
 * New time range, as the vendor's "create time range entry" in its SSID
 * editor: name, which days, and up to 7 time slots in 15-minute steps.
 */
export function TimeRangeDialog({
  open,
  siteId,
  onClose,
  onCreated,
}: {
  open: boolean;
  siteId: string;
  onClose: () => void;
  onCreated: (id: string | undefined, name: string) => void;
}) {
  const create = useCreateTimeRange(siteId);
  const [f, setF] = useState<TimeRangeForm>(emptyTimeRangeForm);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(emptyTimeRangeForm());
    setTouched(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problem = timeRangeProblem(f);
  const canAdd = slotCount(f) < MAX_SLOTS;
  const set = (p: Partial<TimeRangeForm>) => setF((x) => ({ ...x, ...p }));
  const save = () => {
    setTouched(true);
    if (problem || create.isPending) return;
    create.mutate(f, { onSuccess: (id) => onCreated(id, f.name.trim()) });
  };

  return (
    <Dialog open={open} onClose={() => !create.isPending && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>New time range</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {create.error && <Alert severity="error">{apiErrorText(create.error)}</Alert>}
          {touched && problem && <Alert severity="warning">{problem}</Alert>}
          <TextField
            label="Name"
            size="small"
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            inputProps={{ maxLength: 64 }}
            error={touched && !f.name.trim()}
            required
          />
          <RadioGroup row value={f.dayMode} onChange={(e) => set({ dayMode: Number(e.target.value) })}>
            <FormControlLabel value={DAY_MODE.EVERYDAY} control={<Radio />} label="Every day" />
            <FormControlLabel value={DAY_MODE.WEEKDAY} control={<Radio />} label="Weekdays" />
            <FormControlLabel value={DAY_MODE.WEEKEND} control={<Radio />} label="Weekend" />
            <FormControlLabel value={DAY_MODE.CUSTOM} control={<Radio />} label="Custom" />
          </RadioGroup>
          {f.dayMode !== DAY_MODE.CUSTOM ? (
            <SlotRows label="Time" slots={f.slots} onChange={(slots) => set({ slots })} canAdd={canAdd} />
          ) : (
            DAY_NAMES.map((day, d) => {
              const on = f.days[d].length > 0;
              const days = (slots: Slot[]) => set({ days: f.days.map((x, j) => (j === d ? slots : x)) });
              return (
                <Box key={day}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={on}
                        disabled={!on && !canAdd}
                        onChange={(e) => days(e.target.checked ? [{ ...DEFAULT_SLOT }] : [])}
                      />
                    }
                    label={day}
                  />
                  {on && (
                    <Box sx={{ pl: 4 }}>
                      <SlotRows label={day} slots={f.days[d]} onChange={days} canAdd={canAdd} />
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={create.isPending || (touched && Boolean(problem))}>
          {create.isPending ? 'Saving…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

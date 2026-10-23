import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { useId, useState, type FormEvent } from 'react';
import { createMeeting, updateMeeting } from 'src/domain/meeting/ops';
import { MeetingAtSchema, type Meeting, type MeetingMode } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';
import { useLibraryAction } from 'src/stores/library-state';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  meetingId?: string;
  initial?: Partial<{ title: string; at: Meeting['at']['value']; mode: MeetingMode }>;
  onClose(): void;
  onDone?(id: string): void;
};

/** 약속의 기본 정보. 일시는 날짜와 시각을 모두 비우거나 함께 넣는다. */
export function MeetingFormDialog({ open, mode, meetingId, initial, onClose, onDone }: Props) {
  const titleId = useId();
  const { run } = useLibraryAction();
  const fresh = () => ({
    title: initial?.title ?? '',
    date: initial?.at?.date ?? '',
    time: initial?.at?.time ?? '',
    mode: initial?.mode ?? ('transit' as MeetingMode),
  });
  const [form, setForm] = useState(fresh);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(fresh());
      setTouched(false);
      setFailure(null);
      setSubmitting(false);
    }
  }
  const titleError =
    form.title.trim().length === 0
      ? '약속 이름을 넣어 주세요'
      : form.title.trim().length > 60
        ? '약속 이름은 60자까지예요'
        : null;
  const at = form.date === '' && form.time === '' ? null : { date: form.date, time: form.time };
  const atError = !safeParse(MeetingAtSchema, at).success ? '날짜와 시각을 함께 넣어 주세요' : null;
  const valid = titleError === null && atError === null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || submitting) return;
    setSubmitting(true);
    const input = { title: form.title, at, mode: form.mode };
    const result = await run((lib, ctx) =>
      mode === 'create'
        ? createMeeting(lib, input, ctx)
        : updateMeeting(lib, meetingId ?? '', input, ctx),
    );
    setSubmitting(false);
    if (!result.ok) {
      setFailure('저장하지 못했어요. 다시 시도해 주세요');
      return;
    }
    onClose();
    const id = mode === 'create' ? result.createdId : meetingId;
    if (id !== undefined) onDone?.(id);
  };
  const showTitleError = titleError !== null && (touched || form.title.trim().length > 0);
  const change = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFailure(null);
  };
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle id={titleId}>{mode === 'create' ? '새 약속' : '약속 고치기'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}
        >
          <TextField
            autoFocus
            label="약속 이름"
            value={form.title}
            onChange={(event) => {
              setTouched(true);
              change({ title: event.target.value });
            }}
            error={showTitleError}
            helperText={showTitleError ? titleError : null}
            fullWidth
          />
          <TextField
            label="날짜 (선택)"
            type="date"
            value={form.date}
            onChange={(event) => change({ date: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="시각 (선택)"
            type="time"
            value={form.time}
            onChange={(event) => change({ time: event.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {atError !== null && (
            <Box role="alert" sx={{ color: 'error.main', fontSize: 13 }}>
              {atError}
            </Box>
          )}
          <FormControl>
            <FormLabel id={`${titleId}-mode`}>이동수단</FormLabel>
            <RadioGroup
              aria-labelledby={`${titleId}-mode`}
              value={form.mode}
              onChange={(event) => change({ mode: event.target.value as MeetingMode })}
            >
              <FormControlLabel
                value="transit"
                control={<Radio />}
                label="대중교통"
                sx={{ minHeight: 44 }}
              />
              <FormControlLabel
                value="car"
                control={<Radio />}
                label="자동차"
                sx={{ minHeight: 44 }}
              />
              <FormControlLabel
                value="straight"
                control={<Radio />}
                label="직선거리"
                sx={{ minHeight: 44 }}
              />
            </RadioGroup>
          </FormControl>
          {failure !== null && <Box role="alert">{failure}</Box>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>
            취소
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!valid || submitting}
            sx={{ minHeight: 44 }}
          >
            {mode === 'create' ? '만들기' : '저장'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

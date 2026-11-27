import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import Drawer from '@mui/material/Drawer';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { bookingLimitsIssue, proposeBookings, type BookingInput } from 'src/domain/trips/bookings';
import { tripDates, visibleStops } from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import {
  BOOKING_CODE_CHARS,
  BOOKING_LINK_LABEL_CHARS,
  BOOKING_LINKS_MAX,
  BOOKING_NOTE_CHARS,
  BOOKING_TITLE_CHARS,
  BOOKING_VIA_CHARS,
  BookingSchema,
  PREP_URL_CHARS,
  type Booking,
  type Trip,
} from 'src/schema/trip';
import { useLayout } from 'src/sections/shell/use-layout';
import { shortDate } from 'src/sections/trips/trip-dates';
import type { LibraryActionResult } from 'src/stores/library-state';
import { KIND_LABELS, NEED_LABELS, STATUS_LABELS } from './booking-labels';

const EMPTY: BookingInput = {
  kind: 'other',
  title: '',
  need: 'optional',
  status: 'todo',
  date: null,
  placeId: null,
  links: [],
  bookBy: null,
  at: null,
  freeCancelUntil: null,
  code: '',
  price: null,
  bookedVia: '',
  note: '',
};

const selectOptions = {
  select: { MenuProps: { sx: { '& .MuiMenuItem-root': { minHeight: 44 } } } },
};
const dateOptions = { inputLabel: { shrink: true } };

const lengths = {
  title: { subject: '제목은', max: BOOKING_TITLE_CHARS },
  label: { subject: '링크 이름은', max: BOOKING_LINK_LABEL_CHARS },
  code: { subject: '예약번호는', max: BOOKING_CODE_CHARS },
  bookedVia: { subject: '예약한 곳은', max: BOOKING_VIA_CHARS },
  note: { subject: '메모는', max: BOOKING_NOTE_CHARS },
};

function fieldIssue(path: string): string {
  const field = path.split('.').at(-1);
  switch (field) {
    case 'title':
    case 'label':
    case 'code':
    case 'bookedVia':
    case 'note':
      return `${lengths[field].subject} ${lengths[field].max}자까지 적을 수 있어요`;
    case 'url':
      return `링크는 https://로 시작하는 주소를 ${PREP_URL_CHARS}자 이내로 적어 주세요`;
    case 'amount':
      return '금액은 0 이상의 숫자로 적어 주세요';
    case 'currency':
      return '통화는 KRW, EUR처럼 영문 대문자 3자로 적어 주세요';
    case 'date':
    case 'at':
    case 'bookBy':
    case 'freeCancelUntil':
      return '날짜와 시각을 확인해 주세요';
    default:
      return '예약 내용을 다시 확인해 주세요';
  }
}

function placeOptions(trip: Trip, library: Library) {
  const dates = tripDates(trip);
  const options = new Map<string, { label: string; date: string }>();
  trip.days.forEach((day, i) => {
    const ids = visibleStops(library, day).map(({ placeId }) => placeId);
    if (day.lodging.value !== null) ids.push(day.lodging.value);
    for (const id of ids) {
      const place = library.places[id];
      const date = dates[i];
      if (date !== undefined && place?.deletedAt === null && !options.has(id)) {
        options.set(id, { label: place.name.value, date });
      }
    }
  });
  return options;
}

type Props = {
  initial: Booking | null;
  trip: Trip;
  library: Library;
  onClose: () => void;
  onSave: (booking: BookingInput) => Promise<LibraryActionResult>;
  onRemove: (id: string) => Promise<LibraryActionResult>;
};

export function BookingSheet({ initial, trip, library, onClose, onSave, onRemove }: Props) {
  const titleId = useId();
  const mobile = useLayout() === 'compact';
  const [draft, setDraft] = useState<BookingInput>(initial ?? EMPTY);
  const [amount, setAmount] = useState(initial?.price?.amount.toString() ?? '');
  const [currency, setCurrency] = useState(initial?.price?.currency ?? '');
  const [changingPlace, setChangingPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const places = placeOptions(trip, library);
  const unlisted = draft.placeId !== null && !places.has(draft.placeId) ? draft.placeId : null;
  const booking = {
    ...draft,
    title: draft.title.trim(),
    price:
      amount === '' && currency === ''
        ? null
        : {
            amount: amount === '' ? NaN : Number(amount),
            currency,
          },
  };

  // 저장소에서 새 ID를 만들기 전에도 형식과 예약 전체 길이를 검사한다.
  const id = booking.id ?? '00000000';
  const parsed = safeParse(BookingSchema, { ...booking, id });
  const invalidField = parsed.success
    ? undefined
    : parsed.issues.find(({ path }) => path !== 'title' || booking.title.length > 0);
  const validation = parsed.success
    ? bookingLimitsIssue(proposeBookings(trip.bookings?.value ?? [], booking, id))
    : invalidField === undefined
      ? null
      : fieldIssue(invalidField.path);
  const canSave = parsed.success && validation === null;

  function change<K extends keyof BookingInput>(key: K, value: BookingInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  }

  const close = () => {
    if (!busy) onClose();
  };
  const run = async (action: () => Promise<LibraryActionResult>) => {
    if (busy) return;
    setBusy(true);
    setSaveError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    const { error } = result;
    setSaveError(
      error &&
        typeof error === 'object' &&
        '_tag' in error &&
        (error._tag === 'BookingInvalid' || error._tag === 'TripTooLarge') &&
        'message' in error &&
        typeof error.message === 'string'
        ? error.message
        : '예약 변경을 저장하지 못했어요. 다시 시도해 주세요',
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.code);
      toast('예약번호를 복사했어요');
    } catch {
      toast.error('예약번호를 복사하지 못했어요');
    }
  };

  const linkChange = (index: number, key: 'label' | 'url', value: string) =>
    change(
      'links',
      draft.links.map((link, i) => (i === index ? { ...link, [key]: value } : link)),
    );

  const content = (
    <Stack
      component="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void run(() => onSave(booking));
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
          event.stopPropagation();
        }
      }}
      sx={{
        gap: 2,
        p: 2,
        pb: mobile ? 'calc(16px + env(safe-area-inset-bottom, 0px))' : 2,
        '& .MuiInputBase-root': { minHeight: 44 },
      }}
    >
      {mobile && (
        <Box
          aria-hidden="true"
          sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'var(--tm-border)', mx: 'auto' }}
        />
      )}
      <Typography id={titleId} component="h2" sx={{ fontSize: 20, fontWeight: 800 }}>
        {initial === null ? '예약 더하기' : '예약 편집'}
      </Typography>

      <Stack role="group" aria-label="예약 상태" direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {Object.entries(STATUS_LABELS).map(([status, label]) => (
          <Chip
            key={status}
            component="button"
            type="button"
            clickable
            disabled={busy}
            label={label}
            aria-pressed={draft.status === status}
            color={draft.status === status ? 'primary' : 'default'}
            variant={draft.status === status ? 'filled' : 'outlined'}
            onClick={() => change('status', status as Booking['status'])}
            sx={{ minHeight: 44, minWidth: 44 }}
          />
        ))}
      </Stack>

      <TextField
        label="제목"
        required
        autoFocus={!mobile}
        value={draft.title}
        onChange={(event) => change('title', event.target.value)}
      />
      <Stack direction="row" sx={{ gap: 1, '& > *': { flex: 1, minWidth: 0 } }}>
        <TextField
          label="종류"
          select
          slotProps={selectOptions}
          value={draft.kind}
          onChange={(event) => change('kind', event.target.value as Booking['kind'])}
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="필요도"
          select
          slotProps={selectOptions}
          value={draft.need}
          onChange={(event) => change('need', event.target.value as Booking['need'])}
        >
          {Object.entries(NEED_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <TextField
        type="date"
        label="일정일"
        slotProps={dateOptions}
        value={draft.date ?? ''}
        onChange={(event) => change('date', event.target.value || null)}
      />
      {unlisted !== null && (
        <Box>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            일정에 없는 장소 · {library.places[unlisted]?.name.value ?? '이름을 찾을 수 없어요'}
          </Typography>
          <Button type="button" onClick={() => setChangingPlace(true)} sx={{ minHeight: 44 }}>
            바꾸기
          </Button>
          <Button type="button" onClick={() => change('placeId', null)} sx={{ minHeight: 44 }}>
            연결 끊기
          </Button>
        </Box>
      )}
      {(unlisted === null || changingPlace) && (
        <TextField
          label="장소 고르기"
          select
          slotProps={selectOptions}
          value={unlisted === null ? (draft.placeId ?? 'none') : 'none'}
          onChange={(event) => {
            change('placeId', event.target.value === 'none' ? null : event.target.value);
            setChangingPlace(false);
          }}
        >
          <MenuItem value="none">연결 안 함</MenuItem>
          {[...places].map(([value, { label, date }]) => (
            <MenuItem
              key={value}
              value={value}
              sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >
              {shortDate(date)} · {label}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Stack role="group" aria-label="예약 링크" sx={{ gap: 1 }}>
        {draft.links.map((link, i) => (
          <Stack key={i} sx={{ gap: 1 }}>
            <TextField
              label={`링크 ${i + 1} 이름`}
              value={link.label}
              onChange={(event) => linkChange(i, 'label', event.target.value)}
            />
            <TextField
              type="url"
              label={`링크 ${i + 1} 주소`}
              placeholder="https://"
              value={link.url}
              onChange={(event) => linkChange(i, 'url', event.target.value)}
            />
            <Button
              type="button"
              aria-label={`링크 ${i + 1} 빼기`}
              onClick={() =>
                change(
                  'links',
                  draft.links.filter((_, index) => index !== i),
                )
              }
              sx={{ alignSelf: 'flex-end', minHeight: 44 }}
            >
              링크 빼기
            </Button>
          </Stack>
        ))}
        <Button
          type="button"
          disabled={draft.links.length >= BOOKING_LINKS_MAX}
          onClick={() => change('links', [...draft.links, { label: '', url: '' }])}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          링크 더하기
        </Button>
      </Stack>

      <TextField
        type="datetime-local"
        label="확정 일시"
        slotProps={dateOptions}
        value={draft.at ?? ''}
        onChange={(event) => change('at', event.target.value || null)}
      />
      <Stack direction="row" sx={{ gap: 1 }}>
        <TextField
          label="예약번호"
          value={draft.code}
          onChange={(event) => change('code', event.target.value)}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Button
          type="button"
          disabled={draft.code.length === 0}
          onClick={() => void copy()}
          sx={{ minHeight: 44 }}
        >
          복사
        </Button>
      </Stack>
      <Stack direction="row" sx={{ gap: 1 }}>
        <TextField
          type="number"
          label="금액"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setSaveError(null);
          }}
          slotProps={{ htmlInput: { min: 0, step: 'any', inputMode: 'decimal' } }}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <TextField
          label="통화"
          placeholder="KRW"
          value={currency}
          onChange={(event) => {
            setCurrency(event.target.value.toUpperCase());
            setSaveError(null);
          }}
          sx={{ width: '7rem' }}
        />
      </Stack>
      <TextField
        label="예약한 곳"
        value={draft.bookedVia}
        onChange={(event) => change('bookedVia', event.target.value)}
      />
      <TextField
        type="datetime-local"
        label="무료 취소 기한"
        slotProps={dateOptions}
        value={draft.freeCancelUntil ?? ''}
        onChange={(event) => change('freeCancelUntil', event.target.value || null)}
      />
      <TextField
        type="date"
        label="이때까지 예약"
        slotProps={dateOptions}
        value={draft.bookBy ?? ''}
        onChange={(event) => change('bookBy', event.target.value || null)}
      />
      <TextField
        label="메모"
        multiline
        minRows={2}
        value={draft.note}
        onChange={(event) => change('note', event.target.value)}
      />

      {(saveError ?? validation) && <Alert severity="error">{saveError ?? validation}</Alert>}
      <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
        {initial !== null && (
          <Button
            type="button"
            disabled={busy}
            color="error"
            onClick={() => void run(() => onRemove(initial.id))}
            sx={{ minHeight: 44, mr: 'auto' }}
          >
            지우기
          </Button>
        )}
        <Button type="button" disabled={busy} onClick={close} sx={{ minHeight: 44 }}>
          닫기
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={!canSave || busy}
          sx={{ minHeight: 44 }}
        >
          저장
        </Button>
      </Stack>
    </Stack>
  );

  return mobile ? (
    <Drawer
      anchor="bottom"
      open
      onClose={close}
      slotProps={{
        paper: {
          'aria-labelledby': titleId,
          sx: {
            maxWidth: 480,
            width: '100%',
            maxHeight: 'calc(100dvh - 16px)',
            mx: 'auto',
            borderRadius: 'var(--tm-radius-xl) var(--tm-radius-xl) 0 0',
            bgcolor: 'var(--tm-bg-surface)',
            backgroundImage: 'none',
          },
        },
      }}
    >
      {content}
    </Drawer>
  ) : (
    <Dialog open onClose={close} aria-labelledby={titleId} fullWidth maxWidth="sm">
      {content}
    </Dialog>
  );
}

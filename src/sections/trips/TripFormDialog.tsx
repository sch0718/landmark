import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useAtomValue } from 'jotai';
import { useId, useState, type FormEvent } from 'react';
import { localToday } from 'src/domain/trips/query';
import { renameTrip, setOrigin, setTripDates, createTrip } from 'src/domain/trips/ops';
import type { OpResult } from 'src/domain/library/ops';
import { LIBRARY_LIMITS } from 'src/schema/library';
import { daysBetween } from 'src/schema/trip';
import { useTripUndo } from 'src/sections/trips/planner/use-trip-undo';
import { PlacePickerDialog } from 'src/sections/trips/PlacePickerDialog';
import { addDays } from 'src/sections/trips/trip-dates';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  /** 처음 채울 값. 생략하면 제목 없이 오늘~내일, 출발지 없음. 대화상자를 열 때마다 이 값으로 시작한다. */
  initial?: { title: string; startDate: string; endDate: string; origin: string | null };
  /** 만들 때 처음부터 후보로 넣을 장소(`create`에서만 쓴다). */
  candidates?: string[];
  /** 고칠 여행(`edit`에서만 쓴다). */
  tripId?: string;
  onClose(): void;
  /** 저장이 끝났을 때. 만들기면 새 여행의 id, 고치기면 그 여행의 id. */
  onDone?(tripId: string): void;
};

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** 폼에 보일 제목 문구. 문제가 없으면 null. 검사는 다듬은 값 기준이다(연산과 같다). */
function titleProblem(title: string): string | null {
  const length = title.trim().length;
  if (length === 0) return '여행 이름을 넣어 주세요';
  if (length > LIBRARY_LIMITS.tripTitleChars) return '여행 이름은 60자까지예요';
  return null;
}

/** 기간 문구. 문제가 없으면 null. */
function periodProblem(startDate: string, endDate: string): string | null {
  if (!DATE_SHAPE.test(startDate) || !DATE_SHAPE.test(endDate)) return '날짜를 골라 주세요';
  const span = daysBetween(startDate, endDate);
  if (!Number.isFinite(span) || span < 1) return '종료일은 시작일 뒤여야 해요';
  if (span > LIBRARY_LIMITS.tripMaxDays) return '여행은 30일까지 만들 수 있어요';
  return null;
}

/** 연산이 거절했을 때(폼 검사를 통과했는데도) 보일 문구. */
function rejectionMessage(error: unknown): string {
  const tag = (error as { _tag?: string } | null)?._tag;
  if (tag === 'TripTitleInvalid') {
    return (error as { reason: string }).reason === 'empty'
      ? '여행 이름을 넣어 주세요'
      : '여행 이름은 60자까지예요';
  }
  if (tag === 'TripDatesInvalid') {
    return (error as { reason: string }).reason === 'too-many-days'
      ? '여행은 30일까지 만들 수 있어요'
      : '종료일은 시작일 뒤여야 해요';
  }
  if (tag === 'NotFound') return '여행을 찾지 못했어요';
  return '저장하지 못했어요. 다시 시도해 주세요';
}

/**
 * 새 여행 만들기 / 여행 고치기. 제목(1–60자)·기간(최대 30일)·1일차 출발지(선택).
 * 기간을 줄여 Day의 장소가 후보로 돌아가면 한 번 더 확인한다. 닫을 때마다 입력은 버려진다.
 */
export function TripFormDialog({
  open,
  mode,
  initial,
  candidates = [],
  tripId,
  onClose,
  onDone,
}: Props) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  // 고치기는 되돌리기 토스트를 띄운다(기간 변경도 되돌릴 수 있다, 스펙 §2.5). 만들기에서는 쓰지 않는다.
  const { run: runEdit } = useTripUndo(tripId ?? '');
  const titleId = useId();

  const fresh = () => {
    const today = localToday();
    return {
      title: initial?.title ?? '',
      startDate: initial?.startDate ?? today,
      endDate: initial?.endDate ?? addDays(today, 1),
      origin: initial?.origin ?? null,
    };
  };
  const [form, setForm] = useState(fresh);
  const [touched, setTouched] = useState(false);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [confirmShrink, setConfirmShrink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // 닫혔다가 다시 열리면 처음 값으로 돌아간다(렌더 중 상태 맞추기).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(fresh());
      setTouched(false);
      setPickingOrigin(false);
      setConfirmShrink(false);
      setSubmitting(false);
      setFailure(null);
    }
  }

  const change = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setConfirmShrink(false);
    setFailure(null);
  };

  const titleError = titleProblem(form.title);
  const periodError = periodProblem(form.startDate, form.endDate);
  const valid = titleError === null && periodError === null;

  // 기간을 줄이면 잘리는 Day의 장소가 후보로 돌아간다. 고치기에서만 확인한다.
  const trip = mode === 'edit' && tripId !== undefined ? library.trips[tripId] : undefined;
  const shrinkNotices: string[] = [];
  if (trip !== undefined && periodError === null) {
    const span = daysBetween(form.startDate, form.endDate);
    // 잘리는 Day 중 장소가 있는 것만: 하나면 `Day 3의 4곳`, 여럿이면 `Day 3~4의 6곳`.
    const cut = trip.days
      .map((day, index) => ({ day: index + 1, count: day.stops.value.length }))
      .filter(({ day, count }) => day > span && count > 0);
    if (cut.length > 0) {
      const total = cut.reduce((sum, { count }) => sum + count, 0);
      const first = cut[0]!.day;
      const last = cut[cut.length - 1]!.day;
      const range = first === last ? `Day ${first}` : `Day ${first}~${last}`;
      shrinkNotices.push(`${range}의 ${total}곳은 후보로 돌아가요. 바꿀까요?`);
    }
  }

  const originName =
    form.origin === null ? null : (library.places[form.origin]?.name.value ?? '지운 장소');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || submitting) return;
    if (shrinkNotices.length > 0 && !confirmShrink) {
      setConfirmShrink(true);
      return;
    }
    setSubmitting(true);
    const { title, startDate, endDate, origin } = form;
    const result =
      mode === 'create'
        ? await run((lib, ctx) =>
            createTrip(lib, { title, startDate, endDate, origin, candidates }, ctx),
          )
        : await runEdit((lib, ctx): OpResult => {
            // 세 가지를 한 번에 저장한다. 하나라도 거절되면 아무것도 바뀌지 않는다.
            const id = tripId!;
            let out = renameTrip(lib, id, title, ctx);
            if (out.ok) out = setTripDates(out.lib, id, startDate, endDate, ctx);
            if (out.ok) out = setOrigin(out.lib, id, origin, ctx);
            return out;
          }, '여행 설정을 바꿨어요');
    setSubmitting(false);
    if (!result.ok) {
      setFailure(rejectionMessage(result.error));
      return;
    }
    const id = mode === 'create' ? result.createdId : tripId;
    onClose();
    if (id !== undefined) onDone?.(id);
  };

  const showTitleError = titleError !== null && (touched || form.title.trim().length > 0);
  const submitLabel = confirmShrink ? '바꾸기' : mode === 'create' ? '만들기' : '저장';

  return (
    <>
      <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={(event: FormEvent) => void submit(event)} noValidate>
          <DialogTitle id={titleId}>{mode === 'create' ? '새 여행' : '여행 고치기'}</DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="여행 이름"
              value={form.title}
              onChange={(event) => change({ title: event.target.value })}
              onBlur={() => setTouched(true)}
              autoComplete="off"
              fullWidth
              error={showTitleError}
              helperText={titleError ?? `최대 ${LIBRARY_LIMITS.tripTitleChars}자`}
              slotProps={{ htmlInput: { 'aria-invalid': titleError !== null } }}
            />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                label="시작일"
                type="date"
                value={form.startDate}
                onChange={(event) => change({ startDate: event.target.value })}
                sx={{ flex: '1 1 140px' }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="종료일"
                type="date"
                value={form.endDate}
                onChange={(event) => change({ endDate: event.target.value })}
                error={periodError !== null}
                sx={{ flex: '1 1 140px' }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
            {periodError !== null && (
              <Box role="alert" sx={{ mt: -1.5, fontSize: 12, color: 'error.main' }}>
                {periodError}
              </Box>
            )}
            <Box>
              <Box sx={{ mb: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' }}>
                1일차 출발지 (선택)
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {originName !== null && (
                  <Box
                    component="span"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 700,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {originName}
                  </Box>
                )}
                <Button
                  variant="outlined"
                  onClick={() => setPickingOrigin(true)}
                  sx={{ minHeight: 44, flex: 'none' }}
                >
                  출발지 고르기
                </Button>
                {originName !== null && (
                  <Button
                    onClick={() => change({ origin: null })}
                    sx={{ minHeight: 44, flex: 'none' }}
                    aria-label="출발지 지우기"
                  >
                    지우기
                  </Button>
                )}
              </Box>
            </Box>
            {confirmShrink &&
              shrinkNotices.map((notice) => (
                <Box key={notice} role="alert" sx={{ fontSize: 13, color: 'error.main' }}>
                  {notice}
                </Box>
              ))}
            {failure !== null && (
              <Box role="alert" sx={{ fontSize: 13, color: 'error.main' }}>
                {failure}
              </Box>
            )}
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
              {submitLabel}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <PlacePickerDialog
        open={open && pickingOrigin}
        title="출발지 고르기"
        tripId={tripId}
        onPick={(placeId) => {
          change({ origin: placeId });
          setPickingOrigin(false);
        }}
        onClose={() => setPickingOrigin(false)}
      />
    </>
  );
}

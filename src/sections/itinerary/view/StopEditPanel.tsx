import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { overlay } from 'src/domain/overlay';
import { HHmm, LIMITS } from 'src/schema/common';
import { detailAtom, stopDraftsAtom } from 'src/sections/views/store/view-session';
import { useEditActions, useTripStore } from 'src/stores/trip-store';
import { updateStop } from '../store/itinerary-actions';
import { reportSaveError } from '../store/itinerary-state';

const CHANGED = '방문 정보가 변경됐어요. 다시 선택하세요';

export function StopEditPanel({
  date,
  stopId,
  onClose,
}: {
  date: string;
  stopId: string;
  onClose(): void;
}) {
  const [drafts, setDrafts] = useAtom(stopDraftsAtom);
  const store = useStore();
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const effective = useAtomValue(ts.effectiveTripAtom);
  const { ensureAuthor, update } = useEditActions();
  const draft = drafts[stopId];
  const stop = effective?.days.find((d) => d.date === date)?.stops.find((s) => s.id === stopId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const clear = () =>
    setDrafts((all) => {
      const next = { ...all };
      delete next[stopId];
      return next;
    });
  const change = (field: 'time' | 'note', value: string) =>
    setDrafts((all) => {
      const current = all[stopId];
      return current ? { ...all, [stopId]: { ...current, [field]: value } } : all;
    });
  const resetDraft = () => {
    const current = store
      .get(ts.effectiveTripAtom)
      ?.days.find((day) => day.date === date)
      ?.stops.find((visit) => visit.id === stopId);
    if (!current) return;
    setDrafts((all) => ({
      ...all,
      [stopId]: { date, time: current.time ?? '', note: current.note ?? '' },
    }));
    setError(null);
  };
  if (!trip || !stop || !draft || draft.date !== date)
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="warning">{CHANGED}</Alert>
        <Button onClick={onClose}>돌아가기</Button>
        {trip && stop && draft && draft.date !== date && (
          <Button onClick={resetDraft}>초안 버리고 다시 편집</Button>
        )}
      </Box>
    );
  const name = trip.places[stop.placeKey]?.name ?? stop.placeKey;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const detailSession = store.get(detailAtom);
    const submitted = { date: draft.date, time: draft.time, note: draft.note };
    const t = submitted.time.trim(),
      n = submitted.note.trim();
    if (t !== '' && !HHmm.safeParse(t).success) {
      setError('시간은 HH:mm 형식으로 입력하세요');
      return;
    }
    if (n.length > LIMITS.memoChars) {
      setError(`메모는 ${LIMITS.memoChars}자까지 입력하세요`);
      return;
    }
    const exists = () =>
      store
        .get(ts.effectiveTripAtom)
        ?.days.find((d) => d.date === date)
        ?.stops.some((s) => s.id === stopId);
    if (!exists()) {
      setError(CHANGED);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!(await ensureAuthor())) return;
      const latestTrip = store.get(ts.tripAtom);
      if (!latestTrip || !exists()) {
        setError(CHANGED);
        return;
      }
      const now = ts.nowIso();
      await update((e) => {
        if (
          !overlay(latestTrip, e)
            .days.find((d) => d.date === date)
            ?.stops.some((s) => s.id === stopId)
        )
          throw new Error(CHANGED);
        return updateStop(latestTrip, e, date, stopId, { time: t || null, note: n || null }, now);
      });
      let unchanged = false;
      setDrafts((all) => {
        const detail = store.get(detailAtom);
        if (detail?.kind === 'stop' && detail.stopId === stopId && detail !== detailSession)
          return all;
        const current = all[stopId];
        if (
          current?.date === submitted.date &&
          current.time === submitted.time &&
          current.note === submitted.note
        ) {
          const next = { ...all };
          delete next[stopId];
          unchanged = true;
          return next;
        }
        return all;
      });
      if (unchanged) onClose();
      toast.success('방문을 수정했어요');
    } catch (e) {
      if (e instanceof Error && e.message === CHANGED) setError(CHANGED);
      reportSaveError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Box component="form" onSubmit={(event) => void save(event)} sx={{ p: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <TextField
        fullWidth
        label={`${name} 시간`}
        value={draft.time}
        onChange={(event) => change('time', event.target.value)}
        placeholder="HH:mm"
        sx={{ mb: 2 }}
      />
      <TextField
        fullWidth
        multiline
        label={`${name} 메모`}
        value={draft.note}
        onChange={(event) => change('note', event.target.value)}
        minRows={3}
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 2 }}>
        <Button
          disabled={saving}
          onClick={() => {
            clear();
            onClose();
          }}
        >
          취소
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          저장
        </Button>
      </Stack>
    </Box>
  );
}

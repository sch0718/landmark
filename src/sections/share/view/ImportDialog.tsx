import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSetAtom, useStore } from 'jotai';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { DayConflict, MergeSide } from 'src/domain/merge';
import {
  commitImport,
  prepareImport,
  type ImportInput,
  type PreparedImport,
} from 'src/repositories/import-flow';
import { isAbortError } from 'src/repositories/edit-layer-repo';
import { loadTrip } from 'src/repositories/trip-repo';
import type { TripData } from 'src/schema/legacy/trip-data';
import { useEditActions, useTripStore } from 'src/stores/trip-store';

export const CHANGED_NOTICE = '다른 탭에서 편집이 바뀌어 미리보기를 새로 만들었어요';
const OUTSIDE_TRIP = '여행 기간 밖 날짜';

type Preview = {
  kind: 'preview';
  prepared: PreparedImport;
  choices: Record<string, MergeSide>;
  notice: string | null;
  commitError: string | null;
  committing: boolean;
};
type Phase = { kind: 'preparing' } | { kind: 'error'; message: string } | Preview;

type Props = { input: ImportInput; onClose(): void };

/**
 * 가져오기 미리보기와 확정(§5.3). 저장은 확인 시 `commitImport`만 한다 — 닉네임 취소·검증
 * 실패·대화상자 취소·`ok: false`는 저장소를 건드리지 않는다. 입력마다 새로 마운트한다.
 */
export function ImportDialog({ input, onClose }: Props) {
  const ts = useTripStore();
  const store = useStore();
  const { prepareImportContext } = useEditActions();
  const refreshEditLayer = useSetAtom(ts.refreshEditLayerAtom);
  const setTrip = useSetAtom(ts.tripAtom);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  const closed = useRef(false);
  /** 진행 중인 확정(commit)의 중단기. 닫기·취소·언마운트 시 중단해 잠금 대기 중인 저장을 막는다. */
  const commitAbort = useRef<AbortController | null>(null);

  const close = () => {
    closed.current = true;
    commitAbort.current?.abort();
    onClose();
  };

  /** 매번 저장소를 새로 읽은 쌍으로 준비한다. null이면 닉네임 취소 등으로 중단. */
  const prepare = async (notice: string | null): Promise<Phase | null> => {
    let ctx;
    try {
      ctx = await prepareImportContext();
    } catch (e) {
      console.warn('편집 데이터를 읽지 못했어요', e);
      return { kind: 'error', message: '편집 데이터를 읽지 못했어요' };
    }
    const trip = store.get(ts.tripAtom);
    if (!ctx || !trip) return null;
    const result = await prepareImport(input, {
      trip,
      local: ctx.local,
      localSnapshot: ctx.localSnapshot,
      refetchTrip: () => loadTrip(ts.publicId, { noCache: true, fetchFn: ts.fetchFn }),
    });
    if (!result.ok) return { kind: 'error', message: result.message };
    return {
      kind: 'preview',
      prepared: result.prepared,
      choices: defaultChoices(result.prepared.plan.conflicts),
      notice,
      commitError: null,
      committing: false,
    };
  };

  const apply = (next: Phase | null) => {
    if (closed.current) return;
    if (next === null) close();
    else setPhase(next);
  };

  const prepareRef = useRef(prepare);
  const applyRef = useRef(apply);
  useEffect(() => {
    prepareRef.current = prepare;
    applyRef.current = apply;
  });

  useEffect(() => {
    let cancelled = false;
    prepareRef.current(null).then(
      (next) => {
        if (!cancelled) applyRef.current(next);
      },
      (e: unknown) => {
        console.warn('가져오기를 준비하지 못했어요', e);
        if (!cancelled)
          applyRef.current({ kind: 'error', message: '가져오기를 준비하지 못했어요' });
      },
    );
    return () => {
      cancelled = true;
      commitAbort.current?.abort();
    };
  }, []);

  const confirm = async (preview: Preview) => {
    setPhase({ ...preview, committing: true, commitError: null });
    const controller = new AbortController();
    commitAbort.current = controller;
    let result;
    try {
      result = await commitImport(preview.prepared, preview.choices, ts.nowIso(), {
        ...ts.repoDeps,
        signal: controller.signal,
      });
    } catch (e) {
      // 취소로 중단된 저장은 아무것도 쓰지 않았으므로 조용히 끝낸다(§5.3).
      if (isAbortError(e)) return;
      console.warn('가져온 편집을 저장하지 못했어요', e);
      apply({ ...preview, committing: false, commitError: '가져온 편집을 저장하지 못했어요' });
      return;
    } finally {
      if (commitAbort.current === controller) commitAbort.current = null;
    }
    if (result.ok) {
      if (preview.prepared.tripRefreshed) setTrip(preview.prepared.trip);
      refreshEditLayer();
      toast.success('편집을 가져왔어요');
      close();
      return;
    }
    if (result.reason === 'changed') {
      if (closed.current) return;
      apply(await prepare(CHANGED_NOTICE));
      return;
    }
    apply({ ...preview, committing: false, commitError: result.reason });
  };

  return (
    <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="import-title">
      <DialogTitle id="import-title">편집 가져오기</DialogTitle>
      <DialogContent>
        {phase.kind === 'preparing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }} role="status">
            <CircularProgress size={28} aria-label="미리보기 준비 중" />
          </Box>
        )}
        {phase.kind === 'error' && <Alert severity="error">{phase.message}</Alert>}
        {phase.kind === 'preview' && (
          <PreviewBody
            preview={phase}
            onChoose={(id, side) =>
              setPhase({ ...phase, choices: { ...phase.choices, [id]: side } })
            }
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{phase.kind === 'preview' ? '취소' : '닫기'}</Button>
        {phase.kind === 'preview' && (
          <Button
            variant="contained"
            disabled={phase.committing}
            onClick={() => void confirm(phase)}
          >
            가져오기
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function defaultChoices(conflicts: DayConflict[]): Record<string, MergeSide> {
  return Object.fromEntries(conflicts.map((c) => [c.id, c.defaultSide]));
}

function PreviewBody({
  preview,
  onChoose,
}: {
  preview: Preview;
  onChoose(id: string, side: MergeSide): void;
}) {
  const { trip, plan, incomingReport } = preview.prepared;
  const { summary, conflicts } = plan;
  const dayLabel = makeDayLabel(trip);
  const placeName = (key: string) => trip.places[key]?.name ?? key;
  const tags = (v: string[] | undefined) =>
    v === undefined || v.length === 0 ? '없음' : v.join(', ');
  const hidden = (v: boolean | undefined) => (v === undefined ? '없음' : v ? '숨김' : '표시');
  const category = (v: string | null | undefined) => v ?? '원본';

  const changes = [
    ...summary.tagChanges.map(
      (c) => `${placeName(c.placeKey)}: 태그 ${tags(c.from)} → ${tags(c.to)}`,
    ),
    ...summary.hiddenChanges.map(
      (c) => `${placeName(c.placeKey)}: 숨김 ${hidden(c.from)} → ${hidden(c.to)}`,
    ),
    ...summary.categoryChanges.map(
      (c) => `${placeName(c.placeKey)}: 분류: ${category(c.from)} → ${category(c.to)}`,
    ),
  ];
  const notes = [
    ...incomingReport.removedStops.map(
      (s) => `제거될 방문: ${placeName(s.placeKey)} (${dayLabel(s.date)})`,
    ),
    ...incomingReport.hiddenEditDates.map((d) => `표시되지 않을 날짜: ${d}`),
    ...incomingReport.unresolvedGroups.map((g) => `원본이 바뀐 날: ${g.map(dayLabel).join(', ')}`),
  ];

  return (
    <Stack spacing={2}>
      {preview.notice && <Alert severity="info">{preview.notice}</Alert>}
      {preview.commitError && <Alert severity="error">{preview.commitError}</Alert>}
      <Section title="메모">
        <Typography variant="body2">
          {`메모 추가 ${summary.memosAdded} · 변경 ${summary.memosChanged} · 삭제 ${summary.memosDeleted}`}
        </Typography>
      </Section>
      {changes.length > 0 && (
        <Section title="덮어써지는 태그·숨김·분류">
          {changes.map((line) => (
            <Typography key={line} variant="body2">
              {line}
            </Typography>
          ))}
        </Section>
      )}
      {summary.daysAdopted.length > 0 && (
        <Section title="받은 일정으로 바뀌는 날">
          <Typography variant="body2">{summary.daysAdopted.map(dayLabel).join(', ')}</Typography>
        </Section>
      )}
      {conflicts.length > 0 && (
        <Section title="일정 충돌 — 묶음마다 하나를 고르세요">
          {conflicts.map((c) => {
            const label = c.dates.map(dayLabel).join(', ');
            return (
              <Box key={c.id}>
                <Typography variant="body2" id={`conflict-${c.id}`} sx={{ fontWeight: 600 }}>
                  {label}
                </Typography>
                {c.promoted && (
                  <Typography variant="caption" color="text.secondary">
                    날짜별로는 겹치지 않지만 합치면 같은 방문이 두 번 나와요
                  </Typography>
                )}
                <RadioGroup
                  row
                  aria-label={label}
                  value={preview.choices[c.id] ?? c.defaultSide}
                  onChange={(_e, value) => onChoose(c.id, value as MergeSide)}
                >
                  <FormControlLabel value="local" control={<Radio size="small" />} label="내 것" />
                  <FormControlLabel
                    value="incoming"
                    control={<Radio size="small" />}
                    label="받은 것"
                  />
                </RadioGroup>
              </Box>
            );
          })}
        </Section>
      )}
      {notes.length > 0 && (
        <Section title="정리 내역">
          {notes.map((line) => (
            <Typography key={line} variant="body2">
              {line}
            </Typography>
          ))}
        </Section>
      )}
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** 여행 순서로 `Day N`. 여행에 없는 날짜는 "여행 기간 밖 날짜(YYYY-MM-DD)". */
function makeDayLabel(trip: TripData): (date: string) => string {
  const index = new Map(trip.days.map((d, i) => [d.date, i + 1]));
  return (date) => {
    const n = index.get(date);
    return n === undefined ? `${OUTSIDE_TRIP}(${date})` : `Day ${n}`;
  };
}

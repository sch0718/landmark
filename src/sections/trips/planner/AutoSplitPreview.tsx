import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { visibleStops } from 'src/domain/trips/query';
import type { Library } from 'src/schema/library';
import { libraryAtom } from 'src/stores/library-state';
import { splitPreviewAtom } from 'src/stores/trip-planner';
import type { Trip } from 'src/schema/trip';
import { planAutoSplit, useApplyAutoSplit } from 'src/sections/trips/planner/optimize-ops';

/**
 * 이 여행의 자동 나누기 미리보기(`plan[d]` = Day d에 둘 장소 id들). 없거나, 만든 뒤 여행이 바뀌었으면 null.
 * 여행 객체가 미리보기를 만들 때와 같은 동안만 유효하다 — 다른 편집을 하면 미리보기는 닫힌다.
 */
export function useSplitPlan(trip: Trip): string[][] | null {
  const preview = useAtomValue(splitPreviewAtom);
  return preview !== null && preview.tripId === trip.id && preview.base === trip
    ? preview.plan
    : null;
}

/** 계획 화면에 한 번 둔다: 낡은 미리보기를 지우고, 화면을 떠나면 닫는다. */
export function useCloseStaleSplit(trip: Trip) {
  const [preview, setPreview] = useAtom(splitPreviewAtom);
  const stale = preview !== null && (preview.tripId !== trip.id || preview.base !== trip);
  useEffect(() => {
    if (stale) setPreview(null);
  }, [stale, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);
}

/** `Day 자동 나누기` 버튼이 부른다: 지금 문서로 미리보기를 만든다. */
export function useStartAutoSplit(trip: Trip): () => void {
  const library = useAtomValue(libraryAtom);
  const [, setPreview] = useAtom(splitPreviewAtom);
  return () => setPreview({ tripId: trip.id, plan: planAutoSplit(library, trip), base: trip });
}

/** `Day 1에 4곳, Day 2에 3곳`: 새로 들어오는 장소가 있는 Day만. */
function summary(trip: Trip, plan: string[][]): string {
  const incoming = new Set(trip.candidates.value);
  return plan
    .map((ids, d) => ({ d, count: ids.filter((id) => incoming.has(id)).length }))
    .filter(({ count }) => count > 0)
    .map(({ d, count }) => `Day ${d + 1}에 ${count}곳`)
    .join(', ');
}

/**
 * 후보가 들어오거나 기존 장소의 순서가 바뀌는 Day의 새 전체 순서(스펙 §5.2).
 * `Day 1: 1 창가 자리 · 2 안목 카페거리 · 3 경포대(새)` — 후보에서 오는 곳은 `(새)`.
 */
export function splitOrderLines(lib: Library, trip: Trip, plan: string[][]): string[] {
  const incoming = new Set(trip.candidates.value);
  return plan.flatMap((ids, d) => {
    const day = trip.days[d];
    if (day === undefined) return [];
    const current = visibleStops(lib, day).map((s) => s.placeId);
    const changed =
      ids.length !== current.length || ids.some((id, i) => id !== current[i] || incoming.has(id));
    if (!changed) return [];
    const names = ids.map(
      (id, i) => `${i + 1} ${lib.places[id]?.name.value ?? ''}${incoming.has(id) ? '(새)' : ''}`,
    );
    return [`Day ${d + 1}: ${names.join(' · ')}`];
  });
}

/**
 * 후보 칸의 목록 자리에 보이는 미리보기: Day별 곳 수, 바뀌는 Day의 새 순서, `적용`·`취소`.
 * 지도는 배정될 Day 색으로 보이고, 고른 Day의 번호는 새 순서를 따른다.
 */
export function AutoSplitPreview({ trip, plan }: { trip: Trip; plan: string[][] }) {
  const library = useAtomValue(libraryAtom);
  const [, setPreview] = useAtom(splitPreviewAtom);
  const apply = useApplyAutoSplit(trip.id);
  const lines = splitOrderLines(library, trip, plan);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, px: 2, py: 2 }}>
      <Box component="p" sx={{ m: 0, fontWeight: 700, overflowWrap: 'anywhere' }}>
        {summary(trip, plan)}
      </Box>
      {lines.length > 0 && (
        <Box
          component="ul"
          aria-label="새 순서"
          sx={{
            m: 0,
            p: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            color: 'var(--tm-text-muted)',
            fontSize: 14,
            overflowWrap: 'anywhere',
          }}
        >
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          onClick={() => {
            setPreview(null);
            // 미리보기는 `trip`이 만든 때의 여행(`base`)과 같은 동안만 보이므로 `trip`이 곧 `base`다.
            void apply(plan, trip);
          }}
          sx={{ flex: 1, minHeight: 44 }}
        >
          적용
        </Button>
        <Button variant="outlined" onClick={() => setPreview(null)} sx={{ flex: 1, minHeight: 44 }}>
          취소
        </Button>
      </Box>
    </Box>
  );
}

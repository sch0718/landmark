import { expect, it } from 'vitest';
import { mergeCollabPlan, resolveCollabMerge } from 'src/domain/trip-collab/merge';
import { checkPlan, type CollabPlan } from 'src/domain/trip-collab/plan';
const stop = (id: string, placeId: string, note = '') => ({
  id,
  placeId,
  stayMin: null,
  fixedTime: null,
  note,
});
const base: CollabPlan = {
  title: 't',
  startDate: '2026-11-01',
  endDate: '2026-11-03',
  origin: null,
  candidates: [],
  legModes: {},
  days: [
    { id: 'day00001', startTime: '09:00', lodging: null, stops: [stop('stop0001', 'placeaaaaa')] },
    { id: 'day00002', startTime: '09:00', lodging: null, stops: [] },
    { id: 'day00003', startTime: '09:00', lodging: null, stops: [stop('stop0003', 'placecccc0')] },
  ],
};
it.each(['startTime', 'lodging', 'both'])('기간 줄임 대 잘린 Day의 값 수정 (%s)', (field) => {
  const mine: CollabPlan = {
    ...base,
    endDate: '2026-11-02',
    candidates: ['placecccc0'],
    days: base.days.slice(0, 2),
  };
  const theirs: CollabPlan = structuredClone(base);
  if (field !== 'lodging') theirs.days[2]!.startTime = '07:00';
  if (field !== 'startTime') theirs.days[2]!.lodging = 'placelodg0';
  const m = mergeCollabPlan(base, mine, theirs);
  expect(m.conflicts.map((c) => c.id)).toEqual(['placement.period,c,d2']);
  for (const side of ['mine', 'theirs'] as const) {
    const resolved = resolveCollabMerge(m, { 'placement.period,c,d2': side });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(checkPlan(resolved.plan)).toEqual([]);
      expect(resolved.plan.days).toEqual(side === 'mine' ? mine.days : theirs.days);
    }
  }
});
it.each(['note', 'stayMin', 'fixedTime'] as const)(
  '같은 장소를 다른 Stop id로 동시에 추가하면 값 차이를 묻는다 (%s)',
  (field) => {
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.days[1]!.stops = [
      {
        ...stop('mine0001', 'placebbbb0'),
        [field]: field === 'stayMin' ? 45 : field === 'fixedTime' ? '11:00' : '내 메모',
      },
    ];
    theirs.days[1]!.stops = [stop('thrs0001', 'placebbbb0', '')];
    const m = mergeCollabPlan(base, mine, theirs);
    const id = `stop.thrs0001.${field}`;
    expect(m.conflicts.map((c) => c.id)).toEqual([id]);
    for (const side of ['mine', 'theirs'] as const) {
      const resolved = resolveCollabMerge(m, { [id]: side });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(checkPlan(resolved.plan)).toEqual([]);
        expect(resolved.plan.days[1]!.stops[0]!.id).toBe('thrs0001');
        expect(resolved.plan.days[1]!.stops[0]![field]).toBe(
          (side === 'mine' ? mine : theirs).days[1]!.stops[0]![field],
        );
      }
    }
  },
);

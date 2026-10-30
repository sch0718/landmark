// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mergeCollabPlan, resolveCollabMerge, compareListIds } from 'src/domain/trip-collab/merge';
import { checkPlan } from 'src/domain/trip-collab/plan';
import { mkPlan, pid } from './builders';
const copy = <T>(p: T): T => structuredClone(p);
const base = () => mkPlan({ days: [['a', 'b', 'c'], ['d'], ['e', 'f']] });
describe('공동 계획 3방향 병합', () => {
  it('한쪽만 기간을 줄이고 다른 쪽은 그대로면 묻지 않는다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.endDate = '2026-11-02';
    m.candidates.push(...m.days.pop()!.stops.map((s) => s.placeId));
    const result = mergeCollabPlan(b, m, t);
    expect(result.conflicts).toEqual([]);
    expect(result.plan).toEqual(m);
  });

  it('한쪽만 바꾼 제목과 서로 다른 Day 시각을 모두 남긴다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    t.title = '새 이름';
    m.days[0]!.startTime = '10:00';
    t.days[1]!.startTime = '08:00';
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts).toEqual([]);
    expect(r.plan?.title).toBe('새 이름');
    expect(r.plan?.days.map((d) => d.startTime)).toEqual(['10:00', '08:00', '09:00']);
    expect(b).toEqual(base());
  });
  it('같은 시각이면 병합하고 다른 시각이면 값 겹침이다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.days[0]!.startTime = '10:00';
    t.days[0]!.startTime = '08:00';
    const r = mergeCollabPlan(b, m, t);
    expect(r.plan).toBeNull();
    expect(r.conflicts).toMatchObject([
      { id: 'day.0.startTime', kind: 'field', mine: '10:00', theirs: '08:00' },
    ]);
    t.days[0]!.startTime = '10:00';
    expect(mergeCollabPlan(b, m, t).conflicts).toEqual([]);
  });
  it('구간 이동 수단은 키별로 병합하고 같은 키의 다른 값은 묻는다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b),
      k = `${pid('a')}>${pid('b')}`;
    m.legModes[k] = 'walk';
    t.legModes[`${pid('b')}>${pid('c')}`] = 'car';
    expect(mergeCollabPlan(b, m, t).plan?.legModes).toEqual({ ...m.legModes, ...t.legModes });
    t.legModes[k] = 'car';
    expect(mergeCollabPlan(b, m, t).conflicts.map((c) => c.id)).toEqual([`legMode.${k}`]);
  });
  it('같은 Day 순서를 다르게 바꾸면 그 목록의 배치를 묻는다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.days[0]!.stops.reverse();
    t.days[0]!.stops.push(t.days[0]!.stops.shift()!);
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts).toMatchObject([
      {
        id: 'placement.d0',
        kind: 'placement',
        lists: ['d0'],
        mine: { lists: { d0: m.days[0]!.stops.map((s) => s.placeId) } },
        theirs: { lists: { d0: t.days[0]!.stops.map((s) => s.placeId) } },
      },
    ]);
  });
  it('장소 이동과 다른 Day 순서 변경은 둘 다 남긴다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.days[1]!.stops.push(m.days[0]!.stops.shift()!);
    t.days[2]!.stops.reverse();
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts).toEqual([]);
    expect(r.plan?.days.map((d) => d.stops.map((s) => s.placeId))).toEqual([
      [pid('b'), pid('c')],
      [pid('d'), pid('a')],
      [pid('f'), pid('e')],
    ]);
  });
  it('같은 장소를 서로 다른 Day로 옮기면 세 Day를 한 묶음으로 고른다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.days[1]!.stops.push(m.days[0]!.stops.shift()!);
    t.days[2]!.stops.push(t.days[0]!.stops.shift()!);
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts.map((c) => c.id)).toEqual(['placement.d0,d1,d2']);
    for (const side of ['mine', 'theirs'] as const) {
      const result = resolveCollabMerge(r, { 'placement.d0,d1,d2': side });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.days).toEqual((side === 'mine' ? m : t).days);
        expect(checkPlan(result.plan)).toEqual([]);
      }
    }
    expect(resolveCollabMerge(r, {})).toEqual({ ok: false, reason: 'missing' });
  });
  it('Stop을 후보로 빼는 변경과 그 Stop 메모 변경은 한 묶음이다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.candidates.push(m.days[0]!.stops.shift()!.placeId);
    t.days[0]!.stops[0]!.note = '바꿈';
    expect(mergeCollabPlan(b, m, t).conflicts.map((c) => c.id)).toEqual(['placement.c,d0']);
  });
  it('기간 단축과 잘리는 Day 수정은 기간·후보·Day를 묻는다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.endDate = '2026-11-02';
    m.candidates.push(...m.days.pop()!.stops.map((s) => s.placeId));
    t.days[2]!.stops.push(...mkPlan({ days: [['g']] }).days[0]!.stops);
    expect(mergeCollabPlan(b, m, t).conflicts.map((c) => c.id)).toEqual(['placement.period,c,d2']);
  });
  it('양쪽이 같은 새 장소를 다른 Day에 넣으면 함께 묻는다', () => {
    const b = mkPlan({ days: [[], []] }),
      m = copy(b),
      t = copy(b),
      stop = mkPlan({ days: [['a']] }).days[0]!.stops[0]!;
    m.days[0]!.stops.push(copy(stop));
    t.days[1]!.stops.push(copy(stop));
    expect(mergeCollabPlan(b, m, t).conflicts.map((c) => c.id)).toEqual(['placement.d0,d1']);
  });
  it('옮긴 Stop에는 다른 쪽의 머무는 시간 수정이 남는다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.days[1]!.stops.push(m.days[0]!.stops.shift()!);
    t.days[0]!.stops[0]!.stayMin = 45;
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts).toEqual([]);
    expect(r.plan?.days[1]!.stops[1]!.stayMin).toBe(45);
  });
  it('Day id는 공동본 것을 우선하고 새 위치는 내 것을 쓴다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    t.days[0]!.id = 'theirs00';
    m.endDate = '2026-11-04';
    m.days.push({ id: 'newday00', startTime: '09:00', lodging: null, stops: [] });
    expect(mergeCollabPlan(b, m, t).plan?.days.map((d) => d.id)).toEqual([
      'theirs00',
      b.days[1]!.id,
      b.days[2]!.id,
      'newday00',
    ]);
  });
  it('기준이 없으면 같은 값은 두고 다른 값·목록은 모두 묻는다', () => {
    const m = base(),
      t = copy(m);
    t.title = '다름';
    t.days[0]!.stops.reverse();
    t.days[2]!.stops.reverse();
    const r = mergeCollabPlan(null, m, t);
    expect(r.conflicts.map((c) => c.id).sort()).toEqual(['placement.d0,d2', 'title']);
    const result = resolveCollabMerge(r, { 'placement.d0,d2': 'theirs', title: 'mine' });
    expect(result.ok && result.plan.title).toBe(m.title);
  });
  it('중복 장소가 든 결과는 전체 배치 안전망으로 돌린다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b);
    m.candidates.push(pid('a'));
    const r = mergeCollabPlan(b, m, t);
    expect(r.conflicts.map((c) => c.id)).toEqual(['placement.all']);
    const result = resolveCollabMerge(r, { 'placement.all': 'theirs' });
    expect(result.ok && checkPlan(result.plan)).toEqual([]);
    expect(resolveCollabMerge(r, { 'placement.all': 'mine' })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
  it('겹침 id와 목록 정렬은 입력 객체 키 순서와 무관하다', () => {
    const b = base(),
      m = copy(b),
      t = copy(b),
      a = `${pid('a')}>${pid('b')}`,
      z = `${pid('b')}>${pid('c')}`;
    m.legModes = { [a]: 'walk', [z]: 'walk' };
    t.legModes = { [z]: 'car', [a]: 'car' };
    const ids = mergeCollabPlan(b, m, t).conflicts.map((c) => c.id);
    m.legModes = { [z]: 'walk', [a]: 'walk' };
    expect(mergeCollabPlan(b, m, t).conflicts.map((c) => c.id)).toEqual(ids);
    expect((['d10', 'd2', 'c'] as const).slice().sort(compareListIds)).toEqual(['c', 'd2', 'd10']);
  });
});
it('기간 축소로 옮긴 후보와 다른 쪽의 후보 추가가 겹치면 잘린 Day의 기간도 함께 고른다', () => {
  const b = mkPlan({ days: [['a'], ['b'], ['c']] }),
    m = copy(b),
    t = copy(b);
  m.endDate = '2026-11-02';
  m.candidates.push(...m.days.pop()!.stops.map((s) => s.placeId));
  t.candidates.push(pid('d'));
  const merge = mergeCollabPlan(b, m, t);
  expect(merge.conflicts.map((c) => c.id)).toEqual(['placement.period,c,d2']);
  const result = resolveCollabMerge(merge, { 'placement.period,c,d2': 'theirs' });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.plan.endDate).toBe('2026-11-03');
    expect(result.plan.days[2]!.stops.map((s) => s.placeId)).toEqual([pid('c')]);
    expect(result.plan.candidates).toEqual([pid('d')]);
  }
});

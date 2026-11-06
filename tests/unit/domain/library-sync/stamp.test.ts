import { describe, expect, it } from 'vitest';
import { decodeItem } from 'src/domain/library-sync/items';
import { stampChangedFields } from 'src/domain/library-sync/stamp';
import type { Place } from 'src/schema/library';
import type { Trip } from 'src/schema/trip';

const T0 = '2026-10-03T00:00:00.000Z';
const T1 = '2026-10-04T00:00:00.000Z';
const NOW = '2026-11-06T00:00:00.000Z';
const f = <T>(value: T, updatedAt = T0) => ({ value, updatedAt });

const place = (): Place => ({
  id: 'place00001',
  source: { kind: 'pin' },
  name: f('장소'),
  address: '주소',
  lng: 127,
  lat: 37,
  category: f(null),
  labelIds: f([]),
  memo: f('메모'),
  saved: f(true),
  createdAt: T0,
  deletedAt: null,
});
const trip = (): Trip => ({
  id: 'trip000001',
  title: f('여행'),
  startDate: f('2026-11-01'),
  endDate: f('2026-11-02'),
  origin: f(null),
  candidates: f([]),
  days: [
    { stops: f([], T1), lodging: f(null), startTime: f('09:00') },
    { stops: f([]), lodging: f(null), startTime: f('09:00') },
  ],
  legModes: f({}),
  createdAt: T0,
  deletedAt: null,
});

describe('stampChangedFields', () => {
  it('바뀐 필드만 now로 찍고 같은 값은 이전 시각을 유지한다', () => {
    const before = place();
    const after = { ...before, memo: f('새 메모', T1), name: f('장소', T1) };
    const result = stampChangedFields(before, after, NOW);
    expect(result.memo).toEqual({ value: '새 메모', updatedAt: NOW });
    expect(result.name).toEqual({ value: '장소', updatedAt: T0 });
    expect(result.saved).toEqual(before.saved);
    expect(decodeItem('place', result.id, result)).toEqual({ ok: true, doc: result });
  });

  it('before가 없으면 모든 필드 시각을 now로 찍는다', () => {
    const result = stampChangedFields(undefined, place(), NOW);
    expect(result.name.updatedAt).toBe(NOW);
    expect(result.saved.updatedAt).toBe(NOW);
    expect(result.createdAt).toBe(T0);
  });

  it('여행의 중첩 날(days) 필드도 인덱스별로 비교한다', () => {
    const before = trip();
    const base = trip();
    const [day0, day1] = base.days;
    const after: Trip = {
      ...base,
      days: [
        { ...day0!, stops: f([], '2026-12-31T00:00:00.000Z') },
        { ...day1!, startTime: f('10:00', T1) },
      ],
    };
    const result = stampChangedFields(before, after, NOW);
    expect(result.days[0]!.stops.updatedAt).toBe(T1);
    expect(result.days[1]!.startTime).toEqual({ value: '10:00', updatedAt: NOW });
    expect(result.days[1]!.stops.updatedAt).toBe(T0);
    expect(decodeItem('trip', result.id, result)).toEqual({ ok: true, doc: result });
  });

  it('날이 늘어나면 새 날의 필드는 now로 찍는다', () => {
    const before = trip();
    const base = trip();
    const after: Trip = {
      ...base,
      days: [...base.days, { stops: f([], T1), lodging: f(null, T1), startTime: f('09:00', T1) }],
    };
    const result = stampChangedFields(before, after, NOW);
    expect(result.days[2]!.stops.updatedAt).toBe(NOW);
    expect(result.days[0]!.startTime.updatedAt).toBe(T0);
  });

  it('필드에 모르는 속성이 있어도 필드로 보고 시각을 찍으며 추가 속성은 버린다', () => {
    const before = place();
    const after = {
      ...before,
      memo: { value: '새 메모', updatedAt: T1, extra: 1 },
      name: { value: '장소', updatedAt: T1, extra: 1 },
    };
    const result = stampChangedFields(before, after as unknown as Place, NOW);
    expect(result.memo).toEqual({ value: '새 메모', updatedAt: NOW });
    expect(result.name).toEqual({ value: '장소', updatedAt: T0 });
  });

  it('입력을 바꾸지 않는다', () => {
    const before = place();
    const after = { ...before, memo: f('새 메모', T1) };
    stampChangedFields(before, after, NOW);
    expect(after.memo.updatedAt).toBe(T1);
  });
});

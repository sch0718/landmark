import { describe, expect, it } from 'vitest';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const T = '2026-10-08T01:00:00.000Z';
const f = <V>(value: V) => ({ value, updatedAt: T });

function place(over: Record<string, unknown> = {}): Place {
  return {
    id: 'place00001',
    source: { kind: 'naver', sid: '1001' },
    name: f('안목해변 카페'),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T,
    deletedAt: null,
    ...over,
  } as Place;
}

const libraryWith = (p: Record<string, unknown>): Library => ({
  ...emptyLibrary(),
  places: { place00001: p as Place },
});

const ok = (over: Record<string, unknown>) =>
  safeParse(LibrarySchema, libraryWith({ ...place(), ...over })).success;

describe('PlaceSchema: 다녀옴·한 줄 평 필드(선택)', () => {
  it('두 필드가 없는 옛 장소는 통과하고 키가 생기지 않는다', () => {
    const input = libraryWith(place());
    const parsed = safeParse(LibrarySchema, input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(input));
    expect(parsed.data.places.place00001).not.toHaveProperty('visitedOn');
    expect(parsed.data.places.place00001).not.toHaveProperty('review');
  });

  it('올바른 값은 통과한다', () => {
    expect(ok({ visitedOn: f('2026-10-16') })).toBe(true);
    expect(ok({ visitedOn: f(null) })).toBe(true);
    expect(ok({ review: f('좋음') })).toBe(true);
  });

  it('visitedOn은 실제 달력 날짜(YYYY-MM-DD)만 받는다', () => {
    expect(ok({ visitedOn: f('2026-02-30') })).toBe(false);
    expect(ok({ visitedOn: f('2026-1-5') })).toBe(false);
    expect(ok({ visitedOn: f('2026-10-16T00:00:00.000Z') })).toBe(false);
  });

  it('review는 140 단위(String.length)까지만 받는다', () => {
    expect(ok({ review: f('가'.repeat(140)) })).toBe(true);
    expect(ok({ review: f('가'.repeat(141)) })).toBe(false);
    expect(ok({ review: f('😀'.repeat(70)) })).toBe(true);
    expect(ok({ review: f('😀'.repeat(71)) })).toBe(false);
    expect(ok({ review: f(5) })).toBe(false);
  });

  it('모르는 필드는 손상이 아니라 읽을 때 조용히 버려진다(스펙 §5.1)', () => {
    // 옛 버전은 새 필드를 이 경우와 똑같이 처리한다: 통과하되 결과에서 빠지고, 다시 저장하면 지워진다.
    const parsed = safeParse(LibrarySchema, libraryWith({ ...place(), futureField: 1 }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.places.place00001).not.toHaveProperty('futureField');
  });
});

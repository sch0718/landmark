import { describe, expect, it } from 'vitest';
import { setOptionalField } from 'src/domain/library/lww';
import {
  markVisited,
  markVisitedToday,
  setPlaceReview,
  setVisitedOn,
  type OpCtx,
} from 'src/domain/library/ops';
import {
  formatVisitDate,
  isVisited,
  localDateOf,
  normalizeReview,
  reviewOf,
  visitedOnOf,
} from 'src/domain/library/visit';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-16T02:00:00.000Z';
const f = <V>(value: V, updatedAt = T0) => ({ value, updatedAt });
const ctx: OpCtx = { now: NOW, newId: () => 'unused0001' };

function place(n: number, over: Partial<Place> = {}): Place {
  return {
    id: `place${String(n).padStart(5, '0')}`,
    source: { kind: 'naver', sid: String(1000 + n) },
    name: f(`장소 ${n}`),
    address: '강원 강릉시 창해로 14번길 20',
    lng: 128.95,
    lat: 37.77,
    category: f<string | null>(null),
    labelIds: f<string[]>([]),
    memo: f(''),
    saved: f(true),
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

const libOf = (...places: Place[]): Library => ({
  ...emptyLibrary(),
  places: Object.fromEntries(places.map((p) => [p.id, p])),
});

const valid = (lib: Library) => expect(safeParse(LibrarySchema, lib).success).toBe(true);
const A = 'place00001';
const B = 'place00002';

describe('visit 도우미', () => {
  it('시험 시간대가 Asia/Seoul로 고정돼 있다(vitest.config.ts의 test.env.TZ)', () => {
    expect(new Date(2026, 9, 16, 0, 30).toISOString()).toBe('2026-10-15T15:30:00.000Z');
  });

  it('visitedOnOf·isVisited·reviewOf는 필드가 없으면 비어 있다', () => {
    const p = place(1);
    expect(visitedOnOf(p)).toBeNull();
    expect(isVisited(p)).toBe(false);
    expect(reviewOf(p)).toBe('');
    const v = place(1, { visitedOn: f('2026-10-16'), review: f('좋음') });
    expect(visitedOnOf(v)).toBe('2026-10-16');
    expect(isVisited(v)).toBe(true);
    expect(reviewOf(v)).toBe('좋음');
    expect(isVisited(place(1, { visitedOn: f(null) }))).toBe(false);
  });

  it('localDateOf는 기기 시간대의 날짜를 낸다', () => {
    expect(localDateOf(new Date(2026, 9, 16, 0, 30).toISOString())).toBe('2026-10-16');
    expect(localDateOf(new Date(2026, 9, 16, 23, 59).toISOString())).toBe('2026-10-16');
  });

  it('normalizeReview는 앞뒤 공백을 지우고 연속 공백·줄바꿈을 하나로 한다', () => {
    expect(normalizeReview('  일출\n\n최고  ')).toBe('일출 최고');
  });

  it('formatVisitDate는 점으로 구분한다', () => {
    expect(formatVisitDate('2026-10-06')).toBe('2026.10.06');
  });
});

describe('setOptionalField', () => {
  it('없는 필드에 빈 값을 넣으면 그대로 없다', () => {
    expect(setOptionalField<string | null>(undefined, null, null, NOW)).toBeUndefined();
    expect(setOptionalField<string>(undefined, '', '', NOW)).toBeUndefined();
  });

  it('없는 필드에 값을 넣으면 새 필드를 만든다', () => {
    expect(setOptionalField<string | null>(undefined, '2026-10-16', null, NOW)).toEqual({
      value: '2026-10-16',
      updatedAt: NOW,
    });
  });

  it('같은 값이면 같은 참조, 다르면 새 필드', () => {
    const field = f<string | null>('2026-10-16');
    expect(setOptionalField(field, '2026-10-16', null, NOW)).toBe(field);
    expect(setOptionalField(field, null, null, NOW)).toEqual({ value: null, updatedAt: NOW });
  });
});

describe('markVisitedToday', () => {
  it('기기 시간대의 오늘 날짜를 넣고 다른 필드는 그대로 둔다', () => {
    const c = { ...ctx, now: new Date(2026, 9, 16, 0, 30).toISOString() };
    const p = place(1);
    const lib = libOf(p);
    const next = markVisitedToday(lib, [A], c);
    const got = next.places[A]!;
    expect(got.visitedOn).toEqual({ value: '2026-10-16', updatedAt: c.now });
    expect(got.name).toBe(p.name);
    expect(got.memo).toBe(p.memo);
    expect(got.saved).toBe(p.saved);
    valid(next);
  });
});

describe('markVisited', () => {
  it('이미 같거나 늦은 날짜면 그대로(같은 lib)', () => {
    const lib = libOf(place(1, { visitedOn: f('2026-10-12') }));
    const r = markVisited(lib, [A], '2026-10-10', ctx);
    expect(r).toEqual({ ok: true, lib });
    expect(r.ok && r.lib).toBe(lib);
    const same = markVisited(lib, [A], '2026-10-12', ctx);
    expect(same.ok && same.lib).toBe(lib);
  });

  it('더 이른 날짜는 새 날짜로 바꾼다', () => {
    const lib = libOf(place(1, { visitedOn: f('2026-10-01') }));
    const r = markVisited(lib, [A], '2026-10-10', ctx);
    expect(r.ok && r.lib.places[A]!.visitedOn).toEqual({ value: '2026-10-10', updatedAt: NOW });
  });

  it('visitedOn이 null이면 날짜를 넣는다', () => {
    const lib = libOf(place(1, { visitedOn: f(null) }));
    const r = markVisited(lib, [A], '2026-10-10', ctx);
    expect(r.ok && r.lib.places[A]!.visitedOn?.value).toBe('2026-10-10');
  });

  it('saved: false 장소도 바꾼다', () => {
    const lib = libOf(place(1, { saved: f(false) }));
    const r = markVisited(lib, [A], '2026-10-10', ctx);
    expect(r.ok && r.lib.places[A]!.visitedOn?.value).toBe('2026-10-10');
    if (r.ok) valid(r.lib);
  });

  it('지운 장소·없는 id는 건너뛴다', () => {
    const lib = libOf(place(1, { deletedAt: T0 }), place(2));
    const r = markVisited(lib, [A, 'nothere000', B], '2026-10-10', ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lib.places[A]).toBe(lib.places[A]);
    expect(r.lib.places[B]!.visitedOn?.value).toBe('2026-10-10');
    expect(r.lib.places['nothere000']).toBeUndefined();
  });

  it('바뀐 장소가 없으면 같은 lib', () => {
    const lib = libOf(place(1, { deletedAt: T0 }));
    const r = markVisited(lib, [A, 'nothere000'], '2026-10-10', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('틀린 날짜는 VisitDateInvalid', () => {
    const lib = libOf(place(1));
    expect(markVisited(lib, [A], '2026-02-30', ctx)).toEqual({
      ok: false,
      error: { _tag: 'VisitDateInvalid', date: '2026-02-30' },
    });
  });
});

describe('setVisitedOn', () => {
  it('장소마다 날짜를 정하거나 null로 지운다', () => {
    const lib = libOf(place(1, { visitedOn: f('2026-10-01') }), place(2));
    const r = setVisitedOn(lib, { [A]: null, [B]: '2026-10-05' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lib.places[A]!.visitedOn).toEqual({ value: null, updatedAt: NOW });
    expect(r.lib.places[B]!.visitedOn).toEqual({ value: '2026-10-05', updatedAt: NOW });
    valid(r.lib);
  });

  it('키 없는 장소에 null은 그대로(키가 생기지 않는다)', () => {
    const lib = libOf(place(1));
    const r = setVisitedOn(lib, { [A]: null }, ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('같은 값이면 그대로, 지운 장소·없는 id는 건너뛴다', () => {
    const lib = libOf(place(1, { visitedOn: f('2026-10-01') }), place(2, { deletedAt: T0 }));
    const r = setVisitedOn(lib, { [A]: '2026-10-01', [B]: '2026-10-05', nothere000: null }, ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('틀린 날짜가 하나라도 있으면 실패', () => {
    const lib = libOf(place(1), place(2));
    expect(setVisitedOn(lib, { [A]: '2026-10-01', [B]: '2026-13-01' }, ctx)).toEqual({
      ok: false,
      error: { _tag: 'VisitDateInvalid', date: '2026-13-01' },
    });
  });
});

describe('setPlaceReview', () => {
  it('공백을 정리해 저장한다', () => {
    const lib = libOf(place(1));
    const r = setPlaceReview(lib, A, '  일출\n\n최고  ', ctx);
    expect(r.ok && r.lib.places[A]!.review).toEqual({ value: '일출 최고', updatedAt: NOW });
    if (r.ok) valid(r.lib);
  });

  it('빈 문자열은 있던 평을 지운다(빈 값으로 저장)', () => {
    const lib = libOf(place(1, { review: f('좋음') }));
    const r = setPlaceReview(lib, A, '   ', ctx);
    expect(r.ok && r.lib.places[A]!.review).toEqual({ value: '', updatedAt: NOW });
  });

  it('키 없는 장소에 빈 평은 그대로', () => {
    const lib = libOf(place(1));
    const r = setPlaceReview(lib, A, '', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('같은 평이면 그대로', () => {
    const lib = libOf(place(1, { review: f('좋음') }));
    const r = setPlaceReview(lib, A, ' 좋음 ', ctx);
    expect(r.ok && r.lib).toBe(lib);
  });

  it('140자는 되고 141자는 ReviewTooLong', () => {
    const lib = libOf(place(1));
    const okR = setPlaceReview(lib, A, '가'.repeat(140), ctx);
    expect(okR.ok).toBe(true);
    expect(setPlaceReview(lib, A, '가'.repeat(141), ctx)).toEqual({
      ok: false,
      error: { _tag: 'ReviewTooLong', length: 141 },
    });
  });

  it('지운 장소·없는 id는 NotFound', () => {
    const lib = libOf(place(1, { deletedAt: T0 }));
    expect(setPlaceReview(lib, A, '평', ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: A },
    });
    expect(setPlaceReview(lib, 'nothere000', '평', ctx)).toEqual({
      ok: false,
      error: { _tag: 'NotFound', id: 'nothere000' },
    });
  });
});

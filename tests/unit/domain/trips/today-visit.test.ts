import { describe, expect, it } from 'vitest';
import type { OpCtx, OpResult } from 'src/domain/library/ops';
import { visitedOnOf } from 'src/domain/library/visit';
import { markVisit, revertVisit } from 'src/domain/trips/today-visit';
import { emptyLibrary, LibrarySchema, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';

const T0 = '2026-10-08T01:00:00.000Z';
const NOW = '2026-10-24T01:00:00.000Z';
const ctx: OpCtx = { now: NOW, newId: () => 'unused0001' };
const P1 = 'place00001';

function place(visitedOn?: string | null): Place {
  return {
    id: P1,
    source: { kind: 'naver', sid: '1001' },
    name: { value: '중앙시장 닭강정', updatedAt: T0 },
    address: '강원 강릉시 금성로 21',
    lng: 128.9,
    lat: 37.75,
    category: { value: null, updatedAt: T0 },
    labelIds: { value: [], updatedAt: T0 },
    memo: { value: '', updatedAt: T0 },
    saved: { value: true, updatedAt: T0 },
    createdAt: T0,
    deletedAt: null,
    ...(visitedOn === undefined ? {} : { visitedOn: { value: visitedOn, updatedAt: T0 } }),
  };
}

const library = (visitedOn?: string | null): Library =>
  Object.freeze({ ...emptyLibrary(), places: { [P1]: place(visitedOn) } });

/** 성공 결과의 문서. 검증까지 통과해야 한다. */
function ok(result: OpResult): Extract<OpResult, { ok: true }> {
  if (!result.ok) throw new Error(`실패: ${JSON.stringify(result.error)}`);
  const parsed = safeParse(LibrarySchema, result.lib);
  expect(parsed.success ? [] : parsed.issues).toEqual([]);
  return result;
}

const visitedOf = (lib: Library) => visitedOnOf(lib.places[P1]!);

describe('markVisit', () => {
  it('다녀온 날을 쓰고, null이면 지운다', () => {
    const checked = ok(markVisit(P1, '2026-10-24')(library(), ctx));
    expect(visitedOf(checked.lib)).toBe('2026-10-24');
    expect(checked.lib.places[P1]!.visitedOn!.updatedAt).toBe(NOW);

    const cleared = ok(markVisit(P1, null)(checked.lib, ctx));
    expect(visitedOf(cleared.lib)).toBeNull();
  });

  it('옛 여행의 날짜도 이번 날짜로 덮어쓴다(늦은 날 유지 규칙이 아니다)', () => {
    const later = ok(markVisit(P1, '2026-10-24')(library('2027-01-01'), ctx));
    expect(visitedOf(later.lib)).toBe('2026-10-24');
  });

  it('틀린 날짜는 거절한다', () => {
    const result = markVisit(P1, '2026-13-40')(library(), ctx);
    expect(result).toEqual({ ok: false, error: { _tag: 'VisitDateInvalid', date: '2026-13-40' } });
  });
});

describe('revertVisit', () => {
  it('지금 값이 내가 쓴 값이면 이전 값(옛 날짜 포함)으로 되쓴다', () => {
    const result = ok(revertVisit(P1, '2026-10-24', '2025-05-01')(library('2026-10-24'), ctx));
    expect(visitedOf(result.lib)).toBe('2025-05-01');
    expect(result.summary?.merged ?? 0).toBe(0);
  });

  it('풀기를 되돌리면 지운 날짜로 돌아온다', () => {
    const result = ok(revertVisit(P1, null, '2026-10-24')(library(null), ctx));
    expect(visitedOf(result.lib)).toBe('2026-10-24');
  });

  it('이전 값이 없었으면 다시 지운다', () => {
    const result = ok(revertVisit(P1, '2026-10-24', null)(library('2026-10-24'), ctx));
    expect(visitedOf(result.lib)).toBeNull();
  });

  it('그사이 다른 곳이 값을 바꿨으면 문서를 그대로 두고 merged 1', () => {
    const cleared = library(null); // 다른 탭이 풀었다.
    const result = ok(revertVisit(P1, '2026-10-24', '2025-05-01')(cleared, ctx));
    expect(result.lib).toBe(cleared);
    expect(result.summary).toEqual({ created: 0, merged: 1, restored: 0 });

    const redated = library('2026-10-25'); // 다른 탭이 다른 날로 바꿨다.
    const other = ok(revertVisit(P1, '2026-10-24', null)(redated, ctx));
    expect(other.lib).toBe(redated);
    expect(other.summary).toEqual({ created: 0, merged: 1, restored: 0 });
  });

  it('장소가 지워졌거나 없으면 그대로 두고 merged 1', () => {
    const base = library('2026-10-24');
    const deleted: Library = {
      ...base,
      places: { [P1]: { ...base.places[P1]!, deletedAt: NOW } },
    };
    expect(ok(revertVisit(P1, '2026-10-24', null)(deleted, ctx)).summary?.merged).toBe(1);
    const missing: Library = { ...base, places: {} };
    expect(ok(revertVisit(P1, '2026-10-24', null)(missing, ctx)).summary?.merged).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  countsText,
  earliestCreatedAt,
  formatLocalDateTime,
  hasAnyEntry,
  hasLiveContent,
  latestChangeAt,
  libraryCounts,
} from 'src/domain/backup/summary';
import { emptyLibrary } from 'src/schema/library';
import { f, label, makeLibrary, place, T0, trip } from './fixtures';

const DEL = '2026-10-09T00:00:00.000Z';

describe('libraryCounts', () => {
  it('묘비는 세지 않는다', () => {
    const lib = makeLibrary({
      places: [place(1), place(2), place(3, { deletedAt: DEL })],
      labels: [label(1), label(2, { deletedAt: DEL })],
      trips: [trip(1, 1), trip(2, 2, { deletedAt: DEL })],
    });
    expect(libraryCounts(lib)).toEqual({ places: 2, labels: 1, trips: 1 });
  });
});

describe('countsText', () => {
  it('수 문구', () => {
    expect(countsText({ places: 30, labels: 6, trips: 2 })).toBe('장소 30곳 · 라벨 6개 · 여행 2개');
    expect(countsText({ places: 0, labels: 0, trips: 0 })).toBe('장소 0곳 · 라벨 0개 · 여행 0개');
  });
});

describe('hasAnyEntry / hasLiveContent', () => {
  it('빈 보관함은 둘 다 거짓', () => {
    expect(hasAnyEntry(emptyLibrary())).toBe(false);
    expect(hasLiveContent(emptyLibrary())).toBe(false);
  });

  it('묘비만 있으면 항목은 있고 살아 있는 내용은 없다', () => {
    const lib = makeLibrary({ places: [place(1, { deletedAt: DEL })] });
    expect(hasAnyEntry(lib)).toBe(true);
    expect(hasLiveContent(lib)).toBe(false);
  });

  it('라벨·여행만 있어도 센다', () => {
    expect(hasLiveContent(makeLibrary({ labels: [label(1)] }))).toBe(true);
    expect(hasLiveContent(makeLibrary({ places: [place(1)], trips: [trip(1, 1)] }))).toBe(true);
    expect(hasAnyEntry(makeLibrary({ trips: [trip(1, 1, { deletedAt: DEL })] }))).toBe(true);
  });
});

describe('latestChangeAt', () => {
  it('빈 보관함은 null', () => {
    expect(latestChangeAt(emptyLibrary())).toBeNull();
  });

  it('Day 안 stops.updatedAt까지 고른다', () => {
    const base = trip(1, 1);
    const late = '2026-10-15T09:00:00.000Z';
    const t = { ...base, days: [{ ...base.days[0]!, stops: f(base.days[0]!.stops.value, late) }] };
    expect(latestChangeAt(makeLibrary({ places: [place(1)], trips: [t] }))).toBe(late);
  });

  it('deletedAt도 변경 시각이다', () => {
    const lib = makeLibrary({ places: [place(1, { deletedAt: DEL })] });
    expect(latestChangeAt(lib)).toBe(DEL);
  });

  it('필드 이름을 모르는 새 필드의 updatedAt도 센다', () => {
    const p = { ...place(1), futureField: f(1, '2026-11-01T00:00:00.000Z') };
    const lib = { ...makeLibrary(), places: { [p.id]: p } };
    expect(latestChangeAt(lib)).toBe('2026-11-01T00:00:00.000Z');
  });

  it('createdAt만 있어도 센다', () => {
    const lib = makeLibrary({ labels: [label(1, { createdAt: '2026-10-12T00:00:00.000Z' })] });
    expect(latestChangeAt(lib)).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('earliestCreatedAt', () => {
  it('빈 보관함은 null, 아니면 묘비 포함 가장 이른 createdAt', () => {
    expect(earliestCreatedAt(emptyLibrary())).toBeNull();
    const early = '2026-09-01T00:00:00.000Z';
    const lib = makeLibrary({
      places: [place(1), place(2, { createdAt: early, deletedAt: DEL })],
      labels: [label(1)],
    });
    expect(earliestCreatedAt(lib)).toBe(early);
    expect(earliestCreatedAt(makeLibrary({ places: [place(1)] }))).toBe(T0);
  });
});

describe('formatLocalDateTime', () => {
  it('이 기기 시간으로 YYYY.MM.DD HH:mm', () => {
    const iso = '2026-10-16T05:30:00.000Z';
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(formatLocalDateTime(iso)).toBe(
      `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    );
  });
});

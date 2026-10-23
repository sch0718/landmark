import { describe, expect, it } from 'vitest';
import {
  countsText,
  earliestCreatedAt,
  calendarDaysAgo,
  formatLocalDateTime,
  hasAnyEntry,
  hasLiveContent,
  latestChangeAt,
  libraryCounts,
} from 'src/domain/backup/summary';
import { emptyLibrary, type FolderLink } from 'src/schema/library';
import { f, label, makeLibrary, place, T0, trip } from './fixtures';
import { buildMeeting } from '../../../fixtures/builders';

const DEL = '2026-10-09T00:00:00.000Z';

function folderLink(over: Partial<FolderLink> = {}): FolderLink {
  return {
    shareId: 'abc123',
    name: f('폴더'),
    labelId: f(label(1).id),
    seenSids: f<string[]>(['1001']),
    checkedAt: T0,
    createdAt: T0,
    deletedAt: null,
    ...over,
  };
}

const withFolder = (folder: FolderLink) => ({
  ...makeLibrary({ labels: [label(1)] }),
  folders: { [folder.shareId]: folder },
});

describe('libraryCounts', () => {
  it('묘비는 세지 않는다', () => {
    const lib = makeLibrary({
      places: [place(1), place(2), place(3, { deletedAt: DEL })],
      labels: [label(1), label(2, { deletedAt: DEL })],
      trips: [trip(1, 1), trip(2, 2, { deletedAt: DEL })],
    });
    expect(libraryCounts(lib)).toEqual({ places: 2, labels: 1, trips: 1, meetings: 0 });
  });
  it('약속도 살아 있는 항목만 세고 요약에 넣는다', () => {
    const meeting = buildMeeting();
    const lib = {
      ...emptyLibrary(),
      meetings: {
        [meeting.id]: meeting,
        deleted001: { ...meeting, id: 'deleted001', deletedAt: DEL },
      },
    };
    expect(libraryCounts(lib)).toEqual({ places: 0, labels: 0, trips: 0, meetings: 1 });
    expect(countsText(libraryCounts(lib))).toBe('장소 0곳 · 라벨 0개 · 여행 0개 · 약속 1개');
  });
});

describe('countsText', () => {
  it('수 문구', () => {
    expect(countsText({ places: 30, labels: 6, trips: 2, meetings: 0 })).toBe(
      '장소 30곳 · 라벨 6개 · 여행 2개 · 약속 0개',
    );
    expect(countsText({ places: 0, labels: 0, trips: 0, meetings: 0 })).toBe(
      '장소 0곳 · 라벨 0개 · 여행 0개 · 약속 0개',
    );
  });
});

describe('hasAnyEntry / hasLiveContent', () => {
  it.each([null, DEL])(
    '약속만 있어도 항목이며 삭제 여부(%s)로 살아 있는 내용을 가린다',
    (deletedAt) => {
      const meeting = buildMeeting({ deletedAt });
      const lib = { ...emptyLibrary(), meetings: { [meeting.id]: meeting } };
      expect(hasAnyEntry(lib)).toBe(true);
      expect(hasLiveContent(lib)).toBe(deletedAt === null);
    },
  );
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
  it('약속의 생성·삭제 시각도 요약에 반영한다', () => {
    const meeting = buildMeeting({ createdAt: '2026-09-01T00:00:00.000Z', deletedAt: DEL });
    const lib = { ...emptyLibrary(), meetings: { [meeting.id]: meeting } };
    expect(earliestCreatedAt(lib)).toBe(meeting.createdAt);
    expect(latestChangeAt(lib)).toBe(DEL);
  });
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

describe('latestChangeAt: 네이버 폴더 연결', () => {
  it('연결을 끊은 시각(deletedAt)도 변경 시각이다', () => {
    const late = '2026-10-14T00:00:00.000Z';
    expect(latestChangeAt(withFolder(folderLink({ deletedAt: late })))).toBe(late);
  });

  it('확인했어요로 바뀌는 checkedAt도 변경 시각이다', () => {
    const late = '2026-10-15T00:00:00.000Z';
    expect(latestChangeAt(withFolder(folderLink({ checkedAt: late })))).toBe(late);
  });

  it('연결을 만든 시각(createdAt)과 필드 updatedAt도 센다', () => {
    const created = '2026-10-12T00:00:00.000Z';
    expect(latestChangeAt(withFolder(folderLink({ createdAt: created })))).toBe(created);
    const edited = '2026-10-13T00:00:00.000Z';
    expect(latestChangeAt(withFolder(folderLink({ seenSids: f(['1001'], edited) })))).toBe(edited);
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

describe('calendarDaysAgo', () => {
  it('이 기기 시간의 달력 날짜 차이: 같은 날 0, 자정을 넘기면 1', () => {
    const then = new Date(2026, 9, 15, 23, 50).toISOString();
    expect(calendarDaysAgo(then, new Date(2026, 9, 15, 23, 59))).toBe(0);
    expect(calendarDaysAgo(then, new Date(2026, 9, 16, 0, 10))).toBe(1);
  });

  it('경과 시간의 내림과 다르다: 7일 2시간 경과가 8일 차이', () => {
    const then = new Date(2026, 9, 8, 23, 0).toISOString();
    expect(calendarDaysAgo(then, new Date(2026, 9, 16, 1, 0))).toBe(8);
  });

  it('미래 시각은 0으로 막는다', () => {
    const then = new Date(2026, 9, 17, 9, 0).toISOString();
    expect(calendarDaysAgo(then, new Date(2026, 9, 16, 9, 0))).toBe(0);
  });
});

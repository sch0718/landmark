import { describe, expect, it } from 'vitest';
import { preselectHubs, rankRows, scoreRow, transitDeparture } from 'src/domain/meeting/rank';
import { HUBS, type Hub } from 'src/domain/meeting/hubs';

const rows = [
  { id: 'b', values: [10, 30] },
  { id: 'a', values: [20, 20] },
  { id: 'c', values: [0, 40] },
];
describe('약속 순위', () => {
  it.each([
    ['max', ['a', 'b', 'c']],
    ['avg', ['a', 'b', 'c']],
    ['spread', ['a', 'b', 'c']],
  ] as const)('%s 순위와 동점', (rank, ids) => {
    expect(rankRows(rows, rank).map((r) => r.id)).toEqual(ids);
    expect(rows[0]!.id).toBe('b');
  });
  it.each([
    [
      'max',
      [
        [10, 30],
        [20, 30],
      ],
    ],
    [
      'avg',
      [
        [20, 20],
        [10, 30],
      ],
    ],
    [
      'spread',
      [
        [10, 20],
        [20, 30],
      ],
    ],
  ] as const)('%s의 두 번째 기준', (rank, values) => {
    expect(
      rankRows(
        [
          { id: 'z', values: [...values[0]] },
          { id: 'a', values: [...values[1]] },
        ],
        rank,
      )[0]!.id,
    ).toBe('z');
  });
  it('모든 기준이 같으면 id 순이다', () => {
    expect(
      rankRows(
        [
          { id: 'z', values: [10, 20] },
          { id: 'a', values: [10, 20] },
        ],
        'max',
      ).map((r) => r.id),
    ).toEqual(['a', 'z']);
  });
  it.each(['max', 'avg', 'spread'] as const)('미완료·빈 행은 %s의 아래로 간다', (rank) => {
    expect(
      rankRows(
        [
          { id: 'empty', values: [null, null] },
          { id: 'partial', values: [1, null] },
          { id: 'complete', values: [100, 100] },
        ],
        rank,
      ).map((r) => r.id),
    ).toEqual(['complete', 'partial', 'empty']);
  });
  it('두 명과 열 명, 빈 칸을 집계한다', () => {
    expect(scoreRow([10, 30])).toEqual({ max: 30, avg: 20, spread: 20, complete: true });
    expect(scoreRow(Array.from({ length: 10 }, (_, i) => i))).toEqual({
      max: 9,
      avg: 4.5,
      spread: 9,
      complete: true,
    });
    expect(scoreRow([null, 10, 30])).toEqual({ max: 30, avg: 20, spread: 20, complete: false });
    expect(scoreRow([null])).toBeNull();
    expect(scoreRow([])).toBeNull();
  });
  it('실제 역에서 강남·홍대·잠실 사이 역을 8곳에 넣는다', () => {
    const hubs = preselectHubs(
      [
        [127.0276, 37.4979],
        [126.9245, 37.5572],
        [127.1002, 37.5133],
      ],
      HUBS,
    );
    expect(hubs).toHaveLength(8);
    expect(hubs.some((h) => /시청|서울역|고속터미널/.test(h.name))).toBe(true);
  });
  it('최장 거리·평균·id로 사전 선별하고 원본을 유지한다', () => {
    const hub = (id: string, lng: number): Hub => ({ id, lng, lat: 37, name: id, region: '서울' });
    const hubs = [hub('far', 129), hub('z', 127), hub('a', 127)];
    expect(
      preselectHubs(
        [
          [126, 37],
          [128, 37],
        ],
        hubs,
        2,
      ).map((h) => h.id),
    ).toEqual(['a', 'z']);
    expect(hubs[0]!.id).toBe('far');
    expect(preselectHubs([], hubs)).toEqual([]);
  });
  it('자정 전날과 연도 경계를 넘겨 한 시간 뺀다', () => {
    expect(transitDeparture({ date: '2026-10-31', time: '00:30' }, new Date())).toBe(
      '2026-10-30T23:30',
    );
    expect(transitDeparture({ date: '2026-01-01', time: '00:00' }, new Date())).toBe(
      '2025-12-31T23:00',
    );
  });
  it('일시가 없으면 현재 한국 시각이다', () => {
    expect(transitDeparture(null, new Date('2026-10-24T16:23:00Z'))).toBe('2026-10-25T01:23');
  });
});

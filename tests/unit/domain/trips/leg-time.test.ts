import { describe, expect, it } from 'vitest';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { fixedLegTime } from 'src/domain/trips/leg-time';
import { legBetween, type Leg } from 'src/domain/trips/query';

function leg(over: Partial<Leg> = {}): Leg {
  const lib = buildLiveLibrary();
  return {
    ...legBetween(lib.trips.trip000001!, lib.places.place00001!, lib.places.place00002!),
    straightM: 10_000,
    ...over,
  };
}
const plain = { tollFare: null, queriedAt: null, path: [] };

describe('경로 조회가 필요 없는 구간 시간', () => {
  it('국내 자동차·도보는 경로를 묻는다', () => {
    expect(fixedLegTime(leg({ mode: 'car' }))).toBeNull();
    expect(fixedLegTime(leg({ mode: 'walk' }))).toBeNull();
  });

  it('같은 지점은 직접 입력·대중교통보다 먼저 0으로 정한다', () => {
    expect(fixedLegTime(leg({ straightM: 9.9, mode: 'transit', minutes: 30 }))).toEqual({
      ...plain,
      durationS: 0,
      distanceM: 0,
      status: 'same-point',
    });
  });

  it('유효하지 않은 거리도 기존 같은 지점 판정처럼 0으로 처리한다', () => {
    expect(fixedLegTime(leg({ straightM: NaN }))).toMatchObject({
      status: 'same-point',
      durationS: 0,
      distanceM: 0,
    });
  });

  it.each(['car', 'walk', 'transit'] as const)(
    '%s 직접 입력은 분×60, 거리는 직선×1.3이다',
    (mode) => {
      expect(fixedLegTime(leg({ mode, minutes: 30 }))).toEqual({
        ...plain,
        durationS: 1800,
        distanceM: 13_000,
        status: 'manual',
      });
    },
  );

  it('해외 직접 입력도 적용하며, 분이 없으면 대중교통도 0초다', () => {
    const domestic = leg({ mode: 'transit' });
    const abroad = { ...domestic, to: { ...domestic.to, lng: 2.3, lat: 48.8 } };
    expect(fixedLegTime({ ...abroad, minutes: 30 })).toMatchObject({
      status: 'manual',
      durationS: 1800,
    });
    expect(fixedLegTime(abroad)).toEqual({
      ...plain,
      status: 'estimated',
      durationS: 0,
      distanceM: 10_000,
    });
  });

  it('국내 대중교통은 시속 20km에 대기 10분을 더한다', () => {
    expect(fixedLegTime(leg({ mode: 'transit' }))).toEqual({
      ...plain,
      status: 'estimated',
      durationS: 49 * 60,
      distanceM: 13_000,
    });
  });
});

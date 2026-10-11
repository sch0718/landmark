import { describe, expect, it } from 'vitest';
import { it as effectIt } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { formatReverseGeocode, ReverseGeocoder } from 'src/services/reverse-geocoder';

// (37.5494047, 126.9833092)를 geocoder 하위 모듈로 조회했을 때의, 문서화된 v2 응답 모양.
const ROAD_AND_JIBUN = {
  v2: {
    status: { code: 0, name: 'ok', message: 'done' },
    results: [
      {
        name: 'addr',
        code: { id: '1117010200', type: 'L', mappingId: '09170102' },
        region: {
          area0: { name: 'kr' },
          area1: { name: '서울특별시', alias: '서울' },
          area2: { name: '용산구' },
          area3: { name: '후암동' },
          area4: { name: '' },
        },
        land: { type: '1', number1: '123', number2: '4', name: '' },
      },
      {
        name: 'roadaddr',
        code: { id: '111703189011', type: 'S', mappingId: '09170001' },
        region: {
          area0: { name: 'kr' },
          area1: { name: '서울특별시', alias: '서울' },
          area2: { name: '용산구' },
          area3: { name: '후암동' },
          area4: { name: '' },
        },
        land: {
          type: '1',
          number1: '45',
          number2: '',
          name: '두텁바위로60길',
          addition0: { type: 'building', value: '' },
        },
      },
    ],
  },
};

describe('formatReverseGeocode', () => {
  it('실제 응답에서 도로명 주소를 조립한다(results 순서와 상관없이 도로명 우선)', () => {
    expect(formatReverseGeocode(ROAD_AND_JIBUN)).toBe('서울특별시 용산구 후암동 두텁바위로60길 45');
  });

  it('도로명 결과가 없으면 지번 주소(번지-호)를 쓴다', () => {
    const jibunOnly = { v2: { results: [ROAD_AND_JIBUN.v2.results[0]] } };
    expect(formatReverseGeocode(jibunOnly)).toBe('서울특별시 용산구 후암동 123-4');
  });

  it('도로명 건물번호에 number2가 있으면 -로 잇는다', () => {
    const response = {
      v2: {
        results: [
          {
            name: 'roadaddr',
            region: {
              area1: { name: '강원특별자치도' },
              area2: { name: '속초시' },
              area3: { name: '동명동' },
            },
            land: { name: '중앙로', number1: '10', number2: '2' },
          },
        ],
      },
    };
    expect(formatReverseGeocode(response)).toBe('강원특별자치도 속초시 동명동 중앙로 10-2');
  });

  it('지번의 리(area4)를 포함한다', () => {
    const response = {
      v2: {
        results: [
          {
            name: 'addr',
            region: {
              area1: { name: '강원특별자치도' },
              area2: { name: '홍천군' },
              area3: { name: '내촌면' },
              area4: { name: '물걸리' },
            },
            land: { number1: '7', number2: '' },
          },
        ],
      },
    };
    expect(formatReverseGeocode(response)).toBe('강원특별자치도 홍천군 내촌면 물걸리 7');
  });

  it('도로명 결과가 있어도 도로 이름이 비면 지번으로 내려간다', () => {
    const response = {
      v2: {
        results: [
          {
            name: 'roadaddr',
            region: { area1: { name: '서울특별시' } },
            land: { name: '', number1: '' },
          },
          ROAD_AND_JIBUN.v2.results[0],
        ],
      },
    };
    expect(formatReverseGeocode(response)).toBe('서울특별시 용산구 후암동 123-4');
  });

  it.each([
    ['빈 응답', {}],
    ['null', null],
    ['undefined', undefined],
    ['문자열', 'x'],
    ['v2 없음', { v2: {} }],
    ['빈 results', { v2: { results: [] } }],
    ['지역 없는 결과', { v2: { results: [{ name: 'addr', region: {}, land: {} }] } }],
  ])('%s → null', (_label, response) => {
    expect(formatReverseGeocode(response)).toBeNull();
  });
});

describe('ReverseGeocoder.layerWith', () => {
  effectIt.effect('reverse 함수를 (lng, lat) 순서로 부르고 결과를 돌려준다', () =>
    Effect.gen(function* () {
      const calls: Array<readonly [number, number]> = [];
      const result = yield* Effect.gen(function* () {
        const geocoder = yield* ReverseGeocoder;
        return yield* geocoder.reverse(126.9833092, 37.5494047);
      }).pipe(
        Effect.provide(
          ReverseGeocoder.layerWith({
            reverse: async (lng, lat) => {
              calls.push([lng, lat]);
              return '주소';
            },
          }),
        ),
      );
      expect(result).toBe('주소');
      expect(calls).toEqual([[126.9833092, 37.5494047]]);
    }),
  );

  effectIt.effect('reverse가 거부해도 실패하지 않고 null을 돌려준다', () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const geocoder = yield* ReverseGeocoder;
        return yield* geocoder.reverse(1, 2);
      }).pipe(
        Effect.provide(
          ReverseGeocoder.layerWith({ reverse: () => Promise.reject(new Error('boom')) }),
        ),
      );
      expect(result).toBeNull();
    }),
  );

  effectIt.effect('5초 안에 끝나지 않으면 null을 돌려준다', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.gen(function* () {
        const geocoder = yield* ReverseGeocoder;
        return yield* geocoder.reverse(1, 2);
      }).pipe(
        Effect.provide(ReverseGeocoder.layerWith({ reverse: () => new Promise(() => {}) })),
        Effect.forkChild,
      );
      yield* TestClock.adjust('4999 millis');
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust('1 millis');
      expect(yield* Fiber.join(fiber)).toBeNull();
    }),
  );
});

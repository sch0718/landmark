import { Context, Effect, Layer } from 'effect';
import { loadNaverSdk } from 'src/components/map/load-naver-sdk';

/** SDK 로드와 변환을 합쳐 기다리는 시한. */
const REVERSE_TIMEOUT_MS = 5000;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const areaName = (region: unknown, key: string): string =>
  isObject(region) && isObject(region[key]) ? text(region[key].name) : '';

/** 건물번호·번지: `number1`, `number2`가 있으면 `number1-number2`. */
function houseNumber(land: Json): string {
  const first = text(land.number1);
  const second = text(land.number2);
  if (first === '') return '';
  return second === '' ? first : `${first}-${second}`;
}

/** `kind` 결과 하나를 주소 문자열로. 지역(시도·시군구·읍면동)이 하나도 없으면 빈 문자열. */
function formatResult(result: Json, kind: 'roadaddr' | 'addr'): string {
  const land = isObject(result.land) ? result.land : {};
  const areas = ['area1', 'area2', 'area3', ...(kind === 'addr' ? ['area4'] : [])].map((key) =>
    areaName(result.region, key),
  );
  const tail = kind === 'roadaddr' ? [text(land.name), houseNumber(land)] : [houseNumber(land)];
  // 도로명은 도로 이름이 없으면 주소가 아니다.
  if (kind === 'roadaddr' && tail[0] === '') return '';
  return [...areas, ...tail].filter((part) => part !== '').join(' ');
}

/**
 * `naver.maps.Service.reverseGeocode` 콜백의 응답(`{ v2: { results: […] } }`)에서 주소 한 줄을 만든다.
 * 도로명(`roadaddr`: 시도 시군구 읍면동 도로명 건물번호)을 먼저 보고, 없으면 지번(`addr`)을 쓴다.
 * 쓸 수 있는 결과가 없으면 null.
 */
export function formatReverseGeocode(response: unknown): string | null {
  if (!isObject(response) || !isObject(response.v2) || !Array.isArray(response.v2.results)) {
    return null;
  }
  const results = response.v2.results.filter(isObject);
  for (const kind of ['roadaddr', 'addr'] as const) {
    const found = results.find((result) => result.name === kind);
    if (found === undefined) continue;
    const address = formatResult(found, kind);
    if (address !== '') return address;
  }
  return null;
}

type NaverGeocoderMaps = {
  LatLng: new (lat: number, lng: number) => unknown;
  Service?: {
    Status: { OK: number };
    reverseGeocode(
      options: { coords: unknown; orders: string },
      callback: (status: number, response: unknown) => void,
    ): void;
  };
};

const sdkMaps = (): NaverGeocoderMaps | undefined =>
  (window as unknown as { naver?: { maps?: NaverGeocoderMaps } }).naver?.maps;

/** 네이버 지도 SDK(geocoder 하위 모듈)로 좌표를 주소로 바꾼다. 실패·빈 결과·SDK 없음은 null. */
async function reverseWithSdk(lng: number, lat: number): Promise<string | null> {
  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
  if (!clientId) return null;
  await loadNaverSdk(clientId);
  const maps = sdkMaps();
  const service = maps?.Service;
  if (maps === undefined || service === undefined) return null;
  return new Promise<string | null>((resolve) => {
    service.reverseGeocode(
      { coords: new maps.LatLng(lat, lng), orders: 'roadaddr,addr' },
      (status, response) => {
        resolve(status === service.Status.OK ? formatReverseGeocode(response) : null);
      },
    );
  });
}

/** 좌표(경도, 위도)를 주소 한 줄로. 못 찾으면 null이고 실패로 다루지 않는다(스펙 §5 "주소를 찾지 못했어요"). */
export class ReverseGeocoder extends Context.Service<
  ReverseGeocoder,
  { reverse(lng: number, lat: number): Effect.Effect<string | null> }
>()('tripmap/ReverseGeocoder') {
  static layerWith(options: { reverse: (lng: number, lat: number) => Promise<string | null> }) {
    return Layer.succeed(
      ReverseGeocoder,
      ReverseGeocoder.of({
        reverse: (lng, lat) =>
          Effect.tryPromise({ try: () => options.reverse(lng, lat), catch: (e) => e }).pipe(
            Effect.timeout(REVERSE_TIMEOUT_MS),
            Effect.catch(() => Effect.succeed(null)),
          ),
      }),
    );
  }

  static readonly layer = Layer.suspend(() =>
    ReverseGeocoder.layerWith({ reverse: (lng, lat) => reverseWithSdk(lng, lat) }),
  );
}

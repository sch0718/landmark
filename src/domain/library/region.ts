import type { Place } from 'src/schema/library';

const METRO_SUFFIX = /(특별자치시|특별시|광역시)$/;
const CITY_COUNTY_SUFFIX = /[시군]$/;
const OTHER = '기타';
/** 주소가 없는 장소가 이웃의 지역을 빌려 올 수 있는 최대 거리. */
const BORROW_RADIUS_KM = 10;
const EARTH_RADIUS_KM = 6371;

/**
 * 주소에서 지역 이름을 뽑는다.
 * 첫 토큰이 특별시·광역시·특별자치시면 그 접미사를 뗀 이름, 아니면 두 번째 토큰에서
 * 시·군을 뗀 이름, 둘 다 아니면 `기타`.
 */
export function regionOf(address: string): string {
  const [first, second] = address.trim().split(/\s+/);
  if (first !== undefined && METRO_SUFFIX.test(first)) {
    const name = first.replace(METRO_SUFFIX, '');
    if (name !== '') return name;
  }
  if (second !== undefined && CITY_COUNTY_SUFFIX.test(second)) {
    const name = second.replace(CITY_COUNTY_SUFFIX, '');
    if (name !== '') return name;
  }
  return '기타';
}

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const PROVINCE_ALIASES = [
  ['서울', '서울특별시'],
  ['부산', '부산광역시'],
  ['대구', '대구광역시'],
  ['인천', '인천광역시'],
  ['광주', '광주광역시'],
  ['대전', '대전광역시'],
  ['울산', '울산광역시'],
  ['세종', '세종특별자치시'],
  ['경기', '경기도'],
  ['강원', '강원도', '강원특별자치도'],
  ['충북', '충청북도'],
  ['충남', '충청남도'],
  ['전북', '전라북도', '전북특별자치도'],
  ['전남', '전라남도'],
  ['경북', '경상북도'],
  ['경남', '경상남도'],
  ['제주', '제주도', '제주특별자치도'],
];
const PROVINCES = new Map(
  PROVINCE_ALIASES.flatMap((tokens) => tokens.map((t) => [t, tokens[0]!] as const)),
);
const METROS = new Set(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종']);

/** 주소의 첫 토큰을 17개 시·도의 짧은 이름으로 맞춘다. */
export function provinceOf(address: string): string {
  return PROVINCES.get(address.trim().split(/\s+/)[0] ?? '') ?? OTHER;
}

/** 새 거르기용 지역 경로. 광역시는 구를 나누지 않는다. */
export function regionPathOf(address: string): string {
  const province = provinceOf(address);
  if (province === OTHER || METROS.has(province)) return province;
  const second = address.trim().split(/\s+/)[1];
  const city = second?.replace(CITY_COUNTY_SUFFIX, '');
  return second && CITY_COUNTY_SUFFIX.test(second) && city ? `${province}/${city}` : province;
}

type Known = { region: string; place: Place; order: number };
const CELL = 0.1;
const COLUMNS = 3600;
const longitudeCell = (lng: number) => Math.floor(((((lng + 180) % 360) + 360) % 360) / CELL);
const cellKey = (x: number, y: number) => `${(x + COLUMNS) % COLUMNS}:${y}`;

/** 격자로 후보를 좁힌 뒤 이전과 같은 거리식과 입력 순서 동률 규칙으로 결정한다. */
function computeRegions(places: Place[], parse: (address: string) => string): Map<string, string> {
  const result = new Map<string, string>();
  const known: Known[] = [];
  const unknown: Place[] = [];
  const grid = new Map<string, Known[]>();
  for (const [order, place] of places.entries()) {
    const region = parse(place.address);
    result.set(place.id, region);
    if (region === OTHER) unknown.push(place);
    else {
      const entry = { region, place, order };
      known.push(entry);
      const key = cellKey(longitudeCell(place.lng), Math.floor(place.lat / CELL));
      const cell = grid.get(key) ?? [];
      cell.push(entry);
      grid.set(key, cell);
    }
  }
  const radius = BORROW_RADIUS_KM / EARTH_RADIUS_KM;
  const latDelta = (radius * 180) / Math.PI;
  for (const place of unknown) {
    let best = OTHER;
    let bestKm = BORROW_RADIUS_KM;
    let bestOrder = -1;
    const consider = (entry: Known) => {
      const km = haversineKm(place.lng, place.lat, entry.place.lng, entry.place.lat);
      if (km < bestKm || (km === bestKm && entry.order > bestOrder)) {
        bestKm = km;
        bestOrder = entry.order;
        best = entry.region;
      }
    };
    // 극을 포함하는 원은 모든 경도에 닿는다. 드문 경우에만 전체 후보를 쓴다.
    if (Math.abs(place.lat) + latDelta >= 90) known.forEach(consider);
    else {
      const lngDelta =
        (Math.asin(Math.sin(radius) / Math.cos((place.lat * Math.PI) / 180)) * 180) / Math.PI;
      const center = longitudeCell(place.lng);
      const span = Math.ceil(lngDelta / CELL) + 1;
      const bottom = Math.floor((place.lat - latDelta) / CELL);
      const top = Math.floor((place.lat + latDelta) / CELL);
      for (let x = center - span; x <= center + span; x++) {
        for (let y = bottom; y <= top; y++) grid.get(cellKey(x, y))?.forEach(consider);
      }
    }
    result.set(place.id, best);
  }
  return result;
}

const legacyCache = new WeakMap<Place[], Map<string, string>>();
const pathCache = new WeakMap<Place[], Map<string, string>>();

/** 옛 거르기·목록의 지역. 입력 배열마다 한 번 계산하며 빌리기 결과도 그대로 보존한다. */
export function regionsByPlace(places: Place[]): ReadonlyMap<string, string> {
  let result = legacyCache.get(places);
  if (!result) {
    result = computeRegions(places, regionOf);
    legacyCache.set(places, result);
  }
  return result;
}

/** 시·도 → 시·군 경로도 같은 입력 배열에서 공유한다. */
export function regionPathsByPlace(places: Place[]): ReadonlyMap<string, string> {
  let result = pathCache.get(places);
  if (!result) {
    result = computeRegions(places, regionPathOf);
    pathCache.set(places, result);
  }
  return result;
}

/** 새 계층값과 옛 단일 지역값을 모두 받는다. */
export function matchesRegionValue(selected: string, path: string, legacy: string): boolean {
  if (selected.endsWith('/전체')) {
    const province = selected.slice(0, -3);
    return path === province || path.startsWith(`${province}/`);
  }
  return selected.includes('/') ? selected === path : selected === legacy;
}

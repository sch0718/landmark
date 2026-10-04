import type { Stop } from 'src/schema/trip-data';

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64비트. 문자열을 UTF-8 바이트로 보고 BigInt로 계산해 Node와 브라우저에서 같은 값을 낸다. */
function fnv1a64(text: string): string {
  let hash = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

type StopTuple = [string, string, string | null, string | null];

/** 비교·해시에 쓰는 stop의 정규형. `time`/`note`가 없으면 null이다. */
function canonicalStops(stops: Stop[]): StopTuple[] {
  return stops.map((s) => [s.id, s.placeKey, s.time ?? null, s.note ?? null]);
}

/**
 * 그날 stops의 내용 해시. `baseDayHash`로 원본 변경을 **감지**하는 데만 쓴다.
 * 데이터를 버리는 동일성 판정에는 쓰지 말고 `sameDayStops`를 쓴다.
 */
export function hashDayStops(stops: Stop[]): string {
  return fnv1a64(JSON.stringify(canonicalStops(stops)));
}

/** 두 stops가 정규형(id, placeKey, time, note)으로 정확히 같은지. 해시를 쓰지 않는다. */
export function sameDayStops(a: Stop[], b: Stop[]): boolean {
  if (a.length !== b.length) return false;
  const ca = canonicalStops(a);
  const cb = canonicalStops(b);
  return ca.every((tuple, i) => tuple.every((value, j) => value === cb[i]![j]));
}

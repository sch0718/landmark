// Google Plus Code(Open Location Code) 해석. 전역 코드(8자 + '+')만 다룬다.
// Cloudflare 서버 함수에서도 쓰므로 import 없이 순수 함수로 둔다.

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const MAX_DIGITS = 15;
const PAIR_DIGITS = 10;
// 쌍 자리(위도·경도 한 쌍) 해상도(도). 8자리 코드의 셀 크기는 0.0025도.
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];
const GRID_ROWS = 5;
const GRID_COLUMNS = 4;

export function decodePlusCode(code: string): { lat: number; lng: number } | null {
  const upper = code.trim().toUpperCase();
  if (upper.indexOf(SEPARATOR) !== SEPARATOR_POSITION) return null;
  if (upper.lastIndexOf(SEPARATOR) !== SEPARATOR_POSITION) return null;

  const digits = upper.replace(SEPARATOR, '');
  // '+' 뒤는 없거나 두 자리 이상, 전체는 15자리까지.
  if (digits.length === SEPARATOR_POSITION + 1 || digits.length > MAX_DIGITS) return null;

  const values: number[] = [];
  for (const ch of digits) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    values.push(value);
  }
  // 첫 쌍이 지구 밖(위도 90 이상, 경도 180 이상)이면 잘못된 코드.
  if (values[0]! * PAIR_RESOLUTIONS[0]! >= 180 || values[1]! * PAIR_RESOLUTIONS[0]! >= 360) {
    return null;
  }

  let lat = -90;
  let lng = -180;
  const pairDigits = Math.min(values.length, PAIR_DIGITS);
  for (let i = 0; i < pairDigits; i += 2) {
    const resolution = PAIR_RESOLUTIONS[i / 2]!;
    lat += values[i]! * resolution;
    lng += values[i + 1]! * resolution;
  }
  let latSize = PAIR_RESOLUTIONS[pairDigits / 2 - 1]!;
  let lngSize = latSize;

  // 10자리를 넘는 자리는 한 글자가 5행×4열 격자의 한 칸을 가리킨다.
  if (values.length > PAIR_DIGITS) {
    latSize = PAIR_RESOLUTIONS[4]!;
    lngSize = PAIR_RESOLUTIONS[4]!;
    for (let i = PAIR_DIGITS; i < values.length; i += 1) {
      const value = values[i]!;
      latSize /= GRID_ROWS;
      lngSize /= GRID_COLUMNS;
      lat += Math.floor(value / GRID_COLUMNS) * latSize;
      lng += (value % GRID_COLUMNS) * lngSize;
    }
  }

  return { lat: lat + latSize / 2, lng: lng + lngSize / 2 };
}

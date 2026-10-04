import { TripDataSchema, type TripData } from 'src/schema/trip-data';

export type TripLoadResult =
  | { ok: true; trip: TripData }
  | { ok: false; kind: 'not-found' | 'invalid'; message: string; schemaVersion?: unknown };

const NOT_FOUND_MESSAGE = '링크가 잘못되었거나 만료된 여행입니다';

/** `GET /data/<publicId>.json`을 받아 TripData 스키마로 검증한다(§6). */
export async function loadTrip(
  publicId: string,
  opts: { noCache?: boolean; fetchFn?: typeof fetch } = {},
): Promise<TripLoadResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const init: RequestInit = opts.noCache ? { cache: 'no-cache' } : {};

  let response: Response;
  try {
    response = await fetchFn(`/data/${publicId}.json`, init);
  } catch (e) {
    return { ok: false, kind: 'invalid', message: `여행 데이터를 받지 못했어요: ${errorText(e)}` };
  }
  if (response.status === 404) return { ok: false, kind: 'not-found', message: NOT_FOUND_MESSAGE };
  // Cloudflare Pages SPA 모드는 없는 `/data/<id>.json`에 index.html을 200으로 돌려준다.
  if (response.ok && !isJsonContentType(response.headers.get('content-type'))) {
    return { ok: false, kind: 'not-found', message: NOT_FOUND_MESSAGE };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: 'invalid',
      message: `여행 데이터를 받지 못했어요: HTTP ${response.status}`,
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    return {
      ok: false,
      kind: 'invalid',
      message: `여행 데이터를 해석하지 못했어요: ${errorText(e)}`,
    };
  }

  const parsed = TripDataSchema.safeParse(raw);
  if (parsed.success) return { ok: true, trip: parsed.data };

  const first = parsed.error.issues[0];
  const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  const failure: TripLoadResult = {
    ok: false,
    kind: 'invalid',
    message: `${where}${first?.message ?? '검증에 실패했습니다'}`,
  };
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    failure.schemaVersion = (raw as { schemaVersion: unknown }).schemaVersion;
  }
  return failure;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mime = value.split(';')[0]!.trim().toLowerCase();
  return mime === 'application/json' || mime.endsWith('+json');
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

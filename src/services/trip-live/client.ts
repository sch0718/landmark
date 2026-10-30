import { Schema } from 'effect';
import {
  LIVE_ID_PATTERN,
  LIVE_TOKEN_PATTERN,
  parseLiveDoc,
  type LiveTripDoc,
} from 'src/domain/trip-live/live-doc';
import { safeParse } from 'src/schema/parse';
export type TripLiveError =
  | 'offline'
  | 'unauthorized'
  | 'version'
  | 'conflict'
  | 'taken'
  | 'ended'
  | 'not-found'
  | 'rate-limited'
  | 'unavailable'
  | 'switched-off'
  | 'invalid'
  | 'turnstile'
  | 'too-big';
export type LiveResult<A> =
  { ok: true; value: A } | { ok: false; error: TripLiveError; rev?: number };
export type LiveState = {
  rev: number;
  updatedAt: string;
  expiresAt: string;
  role: 'owner' | 'view';
  doc: LiveTripDoc;
  viewToken?: string;
  sourceTripId?: string;
};
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const id = Schema.String.check(Schema.isPattern(LIVE_ID_PATTERN));
const token = Schema.String.check(Schema.isPattern(LIVE_TOKEN_PATTERN));
const createSchema = Schema.Struct({
  id,
  rev: revision,
  expiresAt: Schema.String,
  created: Schema.Boolean,
});
const updateSchema = Schema.Struct({ rev: revision, expiresAt: Schema.String });
const rotateSchema = Schema.Struct({ rev: revision });
const stateSchema = Schema.Struct({
  rev: revision,
  updatedAt: Schema.String,
  expiresAt: Schema.String,
  role: Schema.Literals(['owner', 'view']),
  doc: Schema.Unknown,
  viewToken: Schema.optionalKey(token),
  sourceTripId: Schema.optionalKey(id),
});
const errorSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  reason: Schema.optionalKey(Schema.String),
  rev: Schema.optionalKey(revision),
});
function failure(status: number, body: unknown): LiveResult<never> {
  const parsed = safeParse(errorSchema, body, { onExcessProperty: 'error' }),
    fields = parsed.success ? parsed.data : undefined,
    reason = fields?.reason;
  const error: TripLiveError =
    status === 400
      ? reason === 'turnstile'
        ? 'turnstile'
        : 'invalid'
      : status === 401
        ? 'unauthorized'
        : status === 404
          ? 'not-found'
          : status === 409
            ? reason === 'version'
              ? 'version'
              : reason === 'taken'
                ? 'taken'
                : 'conflict'
            : status === 410
              ? 'ended'
              : status === 413
                ? 'too-big'
                : status === 429
                  ? 'rate-limited'
                  : status === 503 && reason === 'off'
                    ? 'switched-off'
                    : status >= 500
                      ? 'unavailable'
                      : 'invalid';
  return { ok: false, error, ...(fields?.rev === undefined ? {} : { rev: fields.rev }) };
}
async function request<S extends Schema.Decoder<unknown>, Empty = never>(
  path: string,
  method: string,
  schema: S,
  opts: {
    body?: unknown;
    token?: string;
    empty?: { status: number; value: Empty };
    remove?: boolean;
  } = {},
): Promise<LiveResult<S['Type'] | Empty>> {
  const headers = new Headers();
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/trip-live${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      cache: 'no-store',
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (
    response.status === opts.empty?.status ||
    (opts.remove && [404, 410].includes(response.status))
  )
    return { ok: true, value: opts.empty!.value };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return response.ok ? { ok: false, error: 'invalid' } : failure(response.status, null);
  }
  if (!response.ok) return failure(response.status, body);
  const parsed = safeParse(schema, body, { onExcessProperty: 'error' });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'invalid' };
}
const path = (id: string) => `/${encodeURIComponent(id)}`;
export const tripLiveApi = {
  create(input: {
    id: string;
    sourceTripId: string;
    ownerToken: string;
    viewToken: string;
    doc: LiveTripDoc;
    turnstile: string;
  }) {
    return request('', 'POST', createSchema, { body: input });
  },
  async get(
    id: string,
    since: number | null,
    token: string,
  ): Promise<LiveResult<LiveState | 'unchanged'>> {
    const result = await request(
      `${path(id)}${since === null ? '' : `?since=${since}`}`,
      'GET',
      stateSchema,
      { token, empty: { status: 304, value: 'unchanged' as const } },
    );
    if (!result.ok) return result;
    if (result.value === 'unchanged') return { ok: true, value: 'unchanged' };
    const doc = parseLiveDoc(result.value.doc),
      state = result.value;
    if (
      !doc ||
      (state.role === 'owner' && (!state.viewToken || !state.sourceTripId)) ||
      (state.role === 'view' && (state.viewToken !== undefined || state.sourceTripId !== undefined))
    )
      return { ok: false, error: 'invalid' };
    return { ok: true, value: { ...state, doc } };
  },
  update(id: string, doc: LiveTripDoc, baseRev: number, ownerToken: string) {
    return request(path(id), 'PUT', updateSchema, { body: { doc, baseRev }, token: ownerToken });
  },
  rotate(id: string, body: { view: string } | { owner: string }, ownerToken: string) {
    return request(`${path(id)}/rotate`, 'POST', rotateSchema, { body, token: ownerToken });
  },
  remove(id: string, ownerToken: string): Promise<LiveResult<void>> {
    return request(path(id), 'DELETE', Schema.Never, {
      token: ownerToken,
      empty: { status: 204, value: undefined },
      remove: true,
    });
  },
};

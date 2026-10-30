import { Schema } from 'effect';
import {
  COLLAB_DEVICE_ID_PATTERN,
  COLLAB_INVITE_KEY_PATTERN,
  COLLAB_STOP_ID_PATTERN,
  OWNER_DEVICE,
} from 'src/domain/trip-collab/constants';
import type { NextOp, ProgressOp, SharedProgress } from 'src/domain/trip-collab/progress';
import { parseLiveDoc, type LiveTripDoc } from 'src/domain/trip-live/live-doc';
import { safeParse } from 'src/schema/parse';
import type { TripLiveError } from '../trip-live/client';
export type TripCollabError = TripLiveError | 'invite' | 'full' | 'upgrade';
export type CollabResult<A> =
  { ok: true; value: A } | { ok: false; error: TripCollabError; rev?: number };
export type CollabState = {
  rev: number;
  updatedAt: string;
  expiresAt: string;
  role: 'owner' | 'editor';
  deviceId: string | null;
  members: number;
  editedBy: string | null;
  doc?: LiveTripDoc;
  progress?: SharedProgress;
};
export type CollabDevice = { deviceId: string; label: string; createdAt: string; seenAt: string };
export type CollabInvite = {
  key: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
};
const integer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const patterned = (pattern: RegExp) => Schema.String.check(Schema.isPattern(pattern));
const deviceId = patterned(COLLAB_DEVICE_ID_PATTERN),
  stopId = patterned(COLLAB_STOP_ID_PATTERN),
  key = patterned(COLLAB_INVITE_KEY_PATTERN);
export const sharedProgressSchema = Schema.Struct({
  prev: integer,
  marks: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        stopId,
        date: Schema.String,
        at: Schema.String,
        by: Schema.Struct({
          device: Schema.Union([deviceId, Schema.Literal(OWNER_DEVICE)]),
          label: Schema.String,
        }),
      }),
    ),
  ),
  next: Schema.NullOr(
    Schema.Struct({ stopId, date: Schema.String, at: Schema.String, label: Schema.String }),
  ),
});
const stateSchema = Schema.Struct({
  rev: revision,
  updatedAt: Schema.String,
  expiresAt: Schema.String,
  role: Schema.Literals(['owner', 'editor']),
  deviceId: Schema.NullOr(deviceId),
  members: integer,
  editedBy: Schema.NullOr(Schema.String),
  doc: Schema.optionalKey(Schema.Unknown),
  progress: Schema.optionalKey(sharedProgressSchema),
});
const errorSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  reason: Schema.optionalKey(Schema.String),
  rev: Schema.optionalKey(revision),
});
function failure(status: number, body: unknown): CollabResult<never> {
  const r = safeParse(errorSchema, body, { onExcessProperty: 'error' }),
    fields = r.success ? r.data : undefined,
    reason = fields?.reason;
  const error: TripCollabError =
    status === 401
      ? reason === 'invite'
        ? 'invite'
        : 'unauthorized'
      : status === 409
        ? reason === 'full'
          ? 'full'
          : reason === 'upgrade'
            ? 'upgrade'
            : reason === 'version'
              ? 'version'
              : 'conflict'
        : status === 404
          ? 'not-found'
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
  token: string,
  schema: S,
  body?: unknown,
  empty?: { status: number; value: Empty; remove?: boolean },
): Promise<CollabResult<S['Type'] | Empty>> {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/trip-collab/${path}`, {
      method,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (response.status === empty?.status || (empty?.remove && [404, 410].includes(response.status)))
    return { ok: true, value: empty!.value };
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return response.ok ? { ok: false, error: 'invalid' } : failure(response.status, null);
  }
  if (!response.ok) return failure(response.status, value);
  const parsed = safeParse(schema, value, { onExcessProperty: 'error' });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'invalid' };
}
const path = (id: string, part: string) => `${encodeURIComponent(id)}/${part}`;
export const tripCollabApi = {
  createInvite(id: string, token: string, body: { token: string; label: string | null }) {
    return request(
      path(id, 'invites'),
      'POST',
      token,
      Schema.Struct({ key, expiresAt: Schema.String, created: Schema.Boolean }),
      body,
    );
  },
  cancelInvite(id: string, token: string, key: string): Promise<CollabResult<void>> {
    return request(
      path(id, `invites/${encodeURIComponent(key)}`),
      'DELETE',
      token,
      Schema.Never,
      undefined,
      { status: 204, value: undefined, remove: true },
    );
  },
  previewInvite(id: string, token: string) {
    return request(
      path(id, 'invite'),
      'GET',
      token,
      Schema.Struct({
        title: Schema.String,
        startDate: Schema.String,
        endDate: Schema.String,
        expiresAt: Schema.String,
      }),
    );
  },
  accept(id: string, token: string, body: { deviceToken: string; label: string }) {
    return request(
      path(id, 'accept'),
      'POST',
      token,
      Schema.Struct({ deviceId, rev: revision }),
      body,
    );
  },
  async state(
    id: string,
    token: string,
    since: { rev: number | null; prev: number | null },
  ): Promise<CollabResult<CollabState | 'unchanged'>> {
    const params = new URLSearchParams();
    if (since.rev !== null) params.set('rev', String(since.rev));
    if (since.prev !== null) params.set('prev', String(since.prev));
    const result = await request(
      path(id, 'state') + (params.size ? `?${params}` : ''),
      'GET',
      token,
      stateSchema,
      undefined,
      { status: 304, value: 'unchanged' as const },
    );
    if (!result.ok) return result;
    if (result.value === 'unchanged') return { ok: true, value: 'unchanged' };
    const state = result.value,
      doc = state.doc === undefined ? undefined : parseLiveDoc(state.doc);
    if (
      doc === null ||
      (state.role === 'owner' ? state.deviceId !== null : state.deviceId === null)
    )
      return { ok: false, error: 'invalid' };
    const { doc: _rawDoc, ...rest } = state;
    void _rawDoc;
    return { ok: true, value: { ...rest, ...(doc ? { doc } : {}) } };
  },
  putDoc(id: string, token: string, doc: LiveTripDoc, baseRev: number) {
    return request(
      path(id, 'doc'),
      'PUT',
      token,
      Schema.Struct({ rev: revision, expiresAt: Schema.String }),
      { doc, baseRev },
    );
  },
  progress(
    id: string,
    token: string,
    body: { ops: ProgressOp[]; next?: NextOp },
  ): Promise<CollabResult<SharedProgress>> {
    return request(path(id, 'progress'), 'POST', token, sharedProgressSchema, body);
  },
  members(
    id: string,
    token: string,
  ): Promise<CollabResult<{ devices: CollabDevice[]; invites: CollabInvite[] }>> {
    return request(
      path(id, 'members'),
      'GET',
      token,
      Schema.Struct({
        devices: Schema.mutable(
          Schema.Array(
            Schema.Struct({
              deviceId,
              label: Schema.String,
              createdAt: Schema.String,
              seenAt: Schema.String,
            }),
          ),
        ),
        invites: Schema.mutable(
          Schema.Array(
            Schema.Struct({
              key,
              label: Schema.NullOr(Schema.String),
              createdAt: Schema.String,
              expiresAt: Schema.String,
            }),
          ),
        ),
      }),
    );
  },
  removeMember(id: string, token: string, device: string): Promise<CollabResult<void>> {
    return request(
      path(id, `members/${encodeURIComponent(device)}`),
      'DELETE',
      token,
      Schema.Never,
      undefined,
      { status: 204, value: undefined, remove: true },
    );
  },
};

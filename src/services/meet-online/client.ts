import { Schema } from 'effect';
import {
  OnlineStateSchema,
  type MeetingDoc,
  type OnlineState,
  type ReplyInput,
} from 'src/domain/meeting/online-doc';
import { MeetingId, MeetingMemberId } from 'src/schema/meeting';
import { safeParse } from 'src/schema/parse';

export type OnlineError = {
  code:
    | 'offline'
    | 'unauthorized'
    | 'conflict'
    | 'ended'
    | 'not-found'
    | 'rate-limited'
    | 'unavailable'
    | 'switched-off'
    | 'invalid'
    | 'turnstile'
    | 'taken'
    | 'host'
    | 'full';
  rev?: number;
  docRev?: number;
};
type Result<A> = { ok: true; value: A } | { ok: false; error: OnlineError };
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const token = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));
const revSchema = Schema.Struct({ rev: revision });
const updateSchema = Schema.Struct({ rev: revision, docRev: revision });
const createSchema = Schema.Struct({
  id: MeetingId,
  rev: revision,
  docRev: revision,
  hostToken: token,
});
const claimSchema = Schema.Struct({
  participantId: MeetingMemberId,
  guestToken: token,
  rev: revision,
});
const releaseSchema = Schema.Struct({ rev: revision, hostToken: Schema.optionalKey(token) });
const errorSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
  reason: Schema.optionalKey(Schema.String),
  rev: Schema.optionalKey(revision),
  docRev: Schema.optionalKey(revision),
});

function responseError(status: number, body: unknown): OnlineError {
  const parsed = safeParse(errorSchema, body);
  const fields = parsed.success ? parsed.data : undefined;
  const reason = fields?.reason;
  let code: OnlineError['code'];
  switch (status) {
    case 400:
      code = reason === 'turnstile' ? 'turnstile' : 'invalid';
      break;
    case 401:
      code = 'unauthorized';
      break;
    case 404:
      code = 'not-found';
      break;
    case 409:
      code = reason === 'taken' || reason === 'host' || reason === 'full' ? reason : 'conflict';
      break;
    case 410:
      code = 'ended';
      break;
    case 429:
      code = 'rate-limited';
      break;
    case 503:
      code = reason === 'off' ? 'switched-off' : 'unavailable';
      break;
    default:
      code = status >= 500 ? 'unavailable' : 'invalid';
  }
  return {
    code,
    ...(fields?.rev === undefined ? {} : { rev: fields.rev }),
    ...(fields?.docRev === undefined ? {} : { docRev: fields.docRev }),
  };
}

async function request<S extends Schema.Decoder<unknown>, Empty = never>(
  path: string,
  method: string,
  schema: S,
  options: {
    body?: unknown;
    token?: string | null;
    noBody?: { status: number; value: Empty };
  } = {},
): Promise<Result<S['Type'] | Empty>> {
  const headers = new Headers();
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/meet${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    return { ok: false, error: { code: 'offline' } };
  }
  if (response.status === options.noBody?.status) return { ok: true, value: options.noBody.value };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: response.ok ? { code: 'invalid' } : responseError(response.status, null),
    };
  }
  if (!response.ok) return { ok: false, error: responseError(response.status, body) };
  const result = safeParse(schema, body, { onExcessProperty: 'error' });
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: { code: 'invalid' } };
}

const pathFor = (id: string) => `/${encodeURIComponent(id)}`;
export const meetApi = {
  create(doc: MeetingDoc, turnstile: string) {
    return request('', 'POST', createSchema, { body: { doc, turnstile } });
  },
  get(
    id: string,
    since: number | null,
    token: string | null,
  ): Promise<Result<OnlineState | 'unchanged'>> {
    return request(
      `${pathFor(id)}${since === null ? '' : `?since=${since}`}`,
      'GET',
      OnlineStateSchema,
      { token, noBody: { status: 304, value: 'unchanged' as const } },
    );
  },
  update(id: string, doc: MeetingDoc, baseDocRev: number, hostToken: string) {
    return request(pathFor(id), 'PUT', updateSchema, {
      body: { doc, baseRev: baseDocRev },
      token: hostToken,
    });
  },
  remove(id: string, hostToken: string): Promise<Result<void>> {
    return request(pathFor(id), 'DELETE', Schema.Never, {
      token: hostToken,
      noBody: { status: 204, value: undefined },
    });
  },
  claim(id: string, who: { participantId: string } | { newName: string }) {
    return request(`${pathFor(id)}/claim`, 'POST', claimSchema, { body: who });
  },
  reply(id: string, input: ReplyInput, token: string) {
    return request(`${pathFor(id)}/reply`, 'PUT', revSchema, { body: input, token });
  },
  release(id: string, body: { participantId: string } | { host: true }, hostToken: string) {
    return request(`${pathFor(id)}/release`, 'POST', releaseSchema, { body, token: hostToken });
  },
};

import { Schema } from 'effect';
import { SHORT_ID_PATTERN, type ShortLinkKind } from 'src/domain/share/short-link';
import { safeParse } from 'src/schema/parse';

export type ShortLinkError =
  | 'offline'
  | 'rate-limited'
  | 'switched-off'
  | 'turnstile'
  | 'unavailable'
  | 'not-found'
  | 'unauthorized'
  | 'invalid';
type Result<A> = { ok: true; value: A } | { ok: false; error: ShortLinkError };

const createSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(SHORT_ID_PATTERN)),
  expiresAt: Schema.String,
  created: Schema.Boolean,
});
const errorSchema = Schema.Struct({ reason: Schema.optionalKey(Schema.String) });

function responseError(status: number, body: unknown): ShortLinkError {
  const parsed = safeParse(errorSchema, body);
  const reason = parsed.success ? parsed.data.reason : undefined;
  if (status === 400 && reason === 'turnstile') return 'turnstile';
  if (status === 401) return 'unauthorized';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 503 && reason === 'off') return 'switched-off';
  return status >= 500 ? 'unavailable' : 'invalid';
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const shareApi = {
  async create(input: {
    body: string;
    kind: ShortLinkKind;
    keepUntil: string | null;
    turnstile: string;
    deleteToken: string;
  }): Promise<Result<{ id: string; expiresAt: string }>> {
    const { keepUntil, ...rest } = input;
    let response: Response;
    try {
      response = await fetch('/api/share', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keepUntil === null ? rest : { ...rest, keepUntil }),
      });
    } catch {
      return { ok: false, error: 'offline' };
    }
    const body = await readBody(response);
    if (!response.ok) return { ok: false, error: responseError(response.status, body) };
    const parsed = safeParse(createSchema, body, { onExcessProperty: 'error' });
    if (!parsed.success || !Number.isFinite(new Date(parsed.data.expiresAt).getTime())) {
      return { ok: false, error: 'invalid' };
    }
    return { ok: true, value: { id: parsed.data.id, expiresAt: parsed.data.expiresAt } };
  },
  /** 이미 없는 링크(`404`·`410`)도 지운 것으로 본다. */
  async remove(id: string, deleteToken: string): Promise<Result<void>> {
    let response: Response;
    try {
      response = await fetch(`/api/share/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${deleteToken}` },
      });
    } catch {
      return { ok: false, error: 'offline' };
    }
    if (response.status === 204 || response.status === 404 || response.status === 410) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: responseError(response.status, await readBody(response)) };
  },
};

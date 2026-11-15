import { validateShareValue } from 'src/domain/share/read-share';
import { CalendarDate } from 'src/schema/common';
import { safeParse } from 'src/schema/parse';
import type { ShareDocV1 } from 'src/schema/share';
import type { SyncApi } from 'src/services/library-sync/api';
import { toBackupFailure } from 'src/services/server-backup/api';
import type { RecommendationMeta } from 'src/server/library-sync/recommend';
export type { RecommendationMeta };
export type Recommendation = Omit<RecommendationMeta, 'createdAt'> & { doc: ShareDocV1 };
export type RecommendFailure =
  'not-admin' | 'auth' | 'invalid' | 'too-large' | 'limit' | 'off' | 'offline' | 'server';
export type RecommendResult<T> = { ok: true; data: T } | { ok: false; reason: RecommendFailure };
export type RecommendPublishBody = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  doc?: ShareDocV1;
};
export async function fetchRecommendations(
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; items: Recommendation[] } | { ok: false }> {
  try {
    const response = await fetchImpl('/api/sync/v1/recommendations', {
      signal: AbortSignal.timeout(8000),
      credentials: 'same-origin',
    });
    if (response.status !== 200) return { ok: false };
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items))
      return { ok: false };
    const items: Recommendation[] = [];
    for (const value of body.items) {
      if (!value || typeof value !== 'object') return { ok: false };
      const item = value as Record<string, unknown>;
      if (
        typeof item.id !== 'string' ||
        !/^[a-z0-9]{8}$/.test(item.id) ||
        typeof item.title !== 'string' ||
        typeof item.description !== 'string' ||
        !safeParse(CalendarDate, item.startDate).success ||
        !safeParse(CalendarDate, item.endDate).success ||
        typeof item.places !== 'number' ||
        !Number.isInteger(item.places) ||
        typeof item.updatedAt !== 'number' ||
        !Number.isFinite(item.updatedAt)
      )
        return { ok: false };
      const result = validateShareValue(item.doc, 500);
      if (!result.ok || result.doc.version !== 1) continue;
      items.push({ ...(item as Recommendation), doc: result.doc });
    }
    return { ok: true, items };
  } catch {
    return { ok: false };
  }
}
export function createRecommendAdminApi(api: Pick<SyncApi, 'client'>) {
  async function send<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: RecommendPublishBody,
  ): Promise<RecommendResult<T>> {
    const r =
      body === undefined
        ? await api.client.send<T>(method, path)
        : await api.client.send<T>(method, path, { body });
    if (r.ok) return { ok: true, data: r.data };
    if (('status' in r && r.status === 403) || r.kind === 'not-allowed')
      return { ok: false, reason: 'not-admin' };
    if ('status' in r && r.status === 413) return { ok: false, reason: 'too-large' };
    const reason = toBackupFailure(r);
    return {
      ok: false,
      reason:
        reason === 'auth' ||
        reason === 'invalid' ||
        reason === 'too-large' ||
        reason === 'limit' ||
        reason === 'off' ||
        reason === 'offline'
          ? reason
          : 'server',
    };
  }
  return {
    list: () => send<{ items: RecommendationMeta[] }>('GET', '/v1/admin/recommendations'),
    publish: (id: string, body: RecommendPublishBody) =>
      send<{ item: RecommendationMeta }>(
        'POST',
        '/v1/admin/recommendations/' + encodeURIComponent(id),
        body,
      ),
    remove: (id: string) =>
      send<null>('DELETE', '/v1/admin/recommendations/' + encodeURIComponent(id)),
  };
}

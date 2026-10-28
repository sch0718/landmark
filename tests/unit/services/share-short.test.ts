import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { shareApi } from 'src/services/share-short/client';
import { newDeleteToken } from 'src/services/share-short/crypto';
import {
  createSentLinksStore,
  SHARE_LINKS_KEY,
  SHARE_LINKS_MAX,
  type SentShortLink,
} from 'src/services/share-short/store';

afterEach(() => {
  vi.unstubAllGlobals();
});

const link = (patch: Partial<SentShortLink> = {}): SentShortLink => ({
  id: 'AAAAAAAAAAAAAAAA',
  deleteToken: 'a'.repeat(43),
  title: '강릉',
  kind: 'places',
  createdAt: '2026-10-28T00:00:00.000Z',
  expiresAt: '2026-11-27T00:00:00.000Z',
  ...patch,
});
const NOW = new Date('2026-10-28T03:00:00.000Z');

describe('shareApi.create', () => {
  it('기준일이 없으면 빼고 보내고, 응답을 검사해 돌려준다', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { id: 'AAAAAAAAAAAAAAAA', expiresAt: '2026-11-27T00:00:00.000Z', created: true },
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const token = newDeleteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      await shareApi.create({
        body: 'AAAA',
        kind: 'places',
        keepUntil: null,
        turnstile: 'dev',
        deleteToken: token,
      }),
    ).toEqual({
      ok: true,
      value: { id: 'AAAAAAAAAAAAAAAA', expiresAt: '2026-11-27T00:00:00.000Z' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/share');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      body: 'AAAA',
      kind: 'places',
      turnstile: 'dev',
      deleteToken: token,
    });
  });

  it.each([
    [400, { reason: 'turnstile' }, 'turnstile'],
    [400, {}, 'invalid'],
    [413, {}, 'invalid'],
    [429, {}, 'rate-limited'],
    [503, { reason: 'off' }, 'switched-off'],
    [503, { reason: 'config' }, 'unavailable'],
    [500, null, 'unavailable'],
  ] as const)('%i %j → %s', async (status, body, error) => {
    vi.stubGlobal('fetch', async () =>
      body === null ? new Response('오류', { status }) : Response.json(body, { status }),
    );
    expect(
      await shareApi.create({
        body: 'A',
        kind: 'trip',
        keepUntil: '2027-01-10',
        turnstile: 'x',
        deleteToken: 'x',
      }),
    ).toEqual({ ok: false, error });
  });

  it('연결이 끊기면 offline, 모양이 틀린 응답은 invalid', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('끊김');
    });
    const input = {
      body: 'A',
      kind: 'places',
      keepUntil: null,
      turnstile: 'x',
      deleteToken: 'x',
    } as const;
    expect(await shareApi.create(input)).toEqual({ ok: false, error: 'offline' });
    vi.stubGlobal('fetch', async () =>
      Response.json({ id: 'short', expiresAt: 'x', created: true }),
    );
    expect(await shareApi.create(input)).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('shareApi.remove', () => {
  it('토큰을 Bearer로 보내고 204·404·410은 지운 것으로 본다', async () => {
    for (const status of [204, 404, 410]) {
      const fetchMock = vi.fn(async () => new Response(null, { status }));
      vi.stubGlobal('fetch', fetchMock);
      expect(await shareApi.remove('AAAAAAAAAAAAAAAA', 'tok')).toEqual({
        ok: true,
        value: undefined,
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/share/AAAAAAAAAAAAAAAA');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    }
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 401 }));
    expect(await shareApi.remove('AAAAAAAAAAAAAAAA', 'tok')).toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });
});

describe('보낸 짧은 링크 기록', () => {
  it('새것부터 보이고 기한이 지난 것은 빼며 키는 저장하지 않는다', () => {
    const storage = createMemoryStorage();
    const store = createSentLinksStore(
      () => storage,
      () => NOW,
    );
    store.add(link({ id: 'old0000000000000', createdAt: '2026-10-01T00:00:00.000Z' }));
    store.add(link({ id: 'new0000000000000', createdAt: '2026-10-28T00:00:00.000Z' }));
    store.add(link({ id: 'gone000000000000', expiresAt: '2026-10-27T00:00:00.000Z' }));
    expect(store.list().map((item) => item.id)).toEqual(['new0000000000000', 'old0000000000000']);
    expect(storage.getItem(SHARE_LINKS_KEY)).not.toContain('#k=');
    store.remove('new0000000000000');
    expect(store.list().map((item) => item.id)).toEqual(['old0000000000000']);
  });

  it(`최대 ${SHARE_LINKS_MAX}개만 남기고 오래된 것부터 버린다`, () => {
    const storage = createMemoryStorage();
    const bounded = createSentLinksStore(
      () => storage,
      () => NOW,
    );
    const id = (i: number) => `id${String(i).padStart(14, '0')}`;
    for (let i = 0; i < SHARE_LINKS_MAX + 5; i++) {
      bounded.add(link({ id: id(i), createdAt: new Date(NOW.getTime() - 1000 + i).toISOString() }));
    }
    expect(JSON.parse(storage.getItem(SHARE_LINKS_KEY)!)).toHaveLength(SHARE_LINKS_MAX);
    const ids = bounded.list().map((item) => item.id);
    expect(ids[0]).toBe(id(SHARE_LINKS_MAX + 4));
    expect(ids).not.toContain(id(4));
    expect(ids).toContain(id(5));
  });

  it.each(['broken', '{}', '[1]', `[${JSON.stringify({ ...link(), id: 'bad' })}]`])(
    '손상된 값 %s는 무시한다',
    (value) => {
      const storage = createMemoryStorage();
      storage.setItem(SHARE_LINKS_KEY, value);
      expect(
        createSentLinksStore(
          () => storage,
          () => NOW,
        ).list(),
      ).toEqual([]);
    },
  );

  it('저장소가 막히면 이번 로드 동안 메모리에만 둔다', () => {
    const store = createSentLinksStore(
      () => {
        throw new Error('막힘');
      },
      () => NOW,
    );
    store.add(link());
    expect(store.list()).toEqual([link()]);
  });

  it('구독하지 않는 동안 다른 탭이 더한 링크도 다음 읽기에 보이고, 그대로면 같은 배열을 준다', () => {
    const storage = createMemoryStorage();
    const store = createSentLinksStore(
      () => storage,
      () => NOW,
    );
    store.add(link());
    const first = store.list();
    expect(store.list()).toBe(first);
    const other = createSentLinksStore(
      () => storage,
      () => NOW,
    );
    other.add(link({ id: 'BBBBBBBBBBBBBBBB' }));
    expect(
      store
        .list()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB']);
  });

  it('열어 둔 사이 기한이 지나면 다음 읽기에서 뺀다', () => {
    let at = NOW;
    const storage = createMemoryStorage();
    const store = createSentLinksStore(
      () => storage,
      () => at,
    );
    store.add(link({ expiresAt: '2026-10-29T00:00:00.000Z' }));
    store.add(link({ id: 'BBBBBBBBBBBBBBBB', expiresAt: '2026-11-27T00:00:00.000Z' }));
    expect(store.list()).toHaveLength(2);
    at = new Date('2026-10-29T00:00:00.000Z');
    expect(store.list().map((item) => item.id)).toEqual(['BBBBBBBBBBBBBBBB']);
  });

  it('바뀌면 구독자에게 알리고, 다른 탭의 변경도 알린다', () => {
    const storage = createMemoryStorage();
    const store = createSentLinksStore(
      () => storage,
      () => NOW,
    );
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.add(link());
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: SHARE_LINKS_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.remove(link().id);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

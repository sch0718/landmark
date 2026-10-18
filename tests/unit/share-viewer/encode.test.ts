import { afterEach, describe, expect, it, vi } from 'vitest';
import { readShareHash, SHARE_IMPORT_LIMITS } from 'src/domain/share/read-share';
import type { ShareDoc, SharePlace } from 'src/schema/share';
import {
  appUrl,
  DEFAULT_APP_URL,
  encodeShareHash,
  hashDoc,
  importLink,
  MAX_HASH_CHARS,
} from 'src/share-viewer/encode';
import { makeShareV2Doc } from '../helpers/share-v2-doc';

function place(i: number, over: Partial<SharePlace> = {}): SharePlace {
  return {
    id: `p${i}`,
    name: `장소 ${i}`,
    address: '경기 성남시 분당구 정자동 1',
    lng: 127.1,
    lat: 37.36,
    labelIds: [],
    ...over,
  };
}

function makeDoc(places: SharePlace[]): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '정자역 카페',
    createdAt: '2026-10-11T03:00:00.000Z',
    labels: [{ id: 'l1', name: '카페', color: 'orange', order: 0 }],
    places,
  };
}

/** 압축이 안 되는 무작위 base36 문자열(시드 고정). */
function randomText(next: () => number, length: number): string {
  let s = '';
  while (s.length < length) s += Math.floor(next() * 36 ** 6).toString(36);
  return s.slice(0, length);
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('MAX_HASH_CHARS는 앱의 해시 한도와 같다', () => {
  expect(MAX_HASH_CHARS).toBe(SHARE_IMPORT_LIMITS.hashChars);
});

describe('appUrl', () => {
  it('비면 기본값', () => {
    expect(appUrl(undefined)).toBe(DEFAULT_APP_URL);
    expect(appUrl('')).toBe(DEFAULT_APP_URL);
  });

  it('끝의 /를 뗀다', () => {
    expect(appUrl('http://localhost:5174/')).toBe('http://localhost:5174');
    expect(appUrl('http://localhost:5174')).toBe('http://localhost:5174');
  });
});

describe('encodeShareHash', () => {
  it('readShareHash로 같은 문서가 돌아온다(한글·이모지·<)', async () => {
    const doc = makeDoc([
      place(1, { name: '서혜커피 ☕', memo: '크로플 <b>맛집</b> 🥐\n두 번째 줄', kakaoId: 'k1' }),
      place(2, { naverSid: '123', googleId: 'g1', labelIds: ['l1'] }),
    ]);
    const value = await encodeShareHash(doc);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    const result = await readShareHash(value);
    expect(result).toEqual({ ok: true, doc });
  });
});

describe('importLink', () => {
  it('작은 문서는 direct', async () => {
    const link = await importLink(makeDoc([place(1)]), 'https://x.test');
    expect(link.kind).toBe('direct');
    if (link.kind !== 'direct') return;
    expect(link.href.startsWith('https://x.test/import#d=')).toBe(true);
    const result = await readShareHash(link.href.slice('https://x.test/import#d='.length));
    expect(result.ok).toBe(true);
  });

  it('압축해도 32,000자가 넘으면 too-big(해시 없는 주소)', async () => {
    const next = seeded(7);
    const places = Array.from({ length: 1000 }, (_, i) =>
      place(i, {
        lng: 124 + next() * 8,
        lat: 33 + next() * 6,
        memo: randomText(next, 60),
      }),
    );
    const doc = makeDoc(places);
    expect((await encodeShareHash(doc)).length).toBeGreaterThan(MAX_HASH_CHARS);
    expect(await importLink(doc, 'https://x.test')).toEqual({
      kind: 'too-big',
      href: 'https://x.test/import',
    });
  });

  it('CompressionStream이 없으면 unsupported', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(await importLink(makeDoc([place(1)]), 'https://x.test')).toEqual({
      kind: 'unsupported',
    });
  });
});

describe('hashDoc', () => {
  it('v2는 모든 구간의 path를 비운 사본을 돌려주고 원본은 그대로다', () => {
    const doc = makeShareV2Doc();
    const before = JSON.stringify(doc);
    const out = hashDoc(doc);
    if (out.version !== 2) throw new Error('v2여야 해요');
    const legs = out.trips.flatMap((t) => t.days.flatMap((d) => d.legs));
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => l.path.length === 0)).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.trips[0]!.days[0]!.legs[0]!.path.length).toBeGreaterThan(0);
    // 시간·조회 시각은 남는다.
    expect(legs[0]).toMatchObject({ durationS: 600, queriedAt: '2026-10-16T04:58:00.000Z' });
  });

  it('v1은 그대로 돌려준다', () => {
    const doc = makeDoc([place(1)]);
    expect(hashDoc(doc)).toBe(doc);
  });
});

describe('importLink v2', () => {
  it('경로선 없는 문서로 풀리며 앱 readShareHash가 받아들인다', async () => {
    const link = await importLink(makeShareV2Doc(), 'https://x.test');
    expect(link.kind).toBe('direct');
    if (link.kind !== 'direct') return;
    const result = await readShareHash(link.href.slice('https://x.test/import#d='.length));
    expect(result.ok).toBe(true);
    if (!result.ok || result.doc.version !== 2) return;
    expect(result.doc.trips[0]!.days.every((d) => d.legs.every((l) => l.path.length === 0))).toBe(
      true,
    );
  });
});

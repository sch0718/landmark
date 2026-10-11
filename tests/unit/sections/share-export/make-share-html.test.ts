import { describe, expect, it as test, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect, Result } from 'effect';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { makeShareHtml, renderShareHtml } from 'src/sections/share-export/make-share-html';
import { ShareDocInvalid, ShareTemplateUnavailable } from 'src/services/errors';
import { ShareTemplate } from 'src/services/share-template';
import { sampleLibrary } from '../library/fixtures';

const TEMPLATE = `<html><script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script></html>`;
const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const opts = { title: '정자역 카페', includeMemo: true, now: new Date(2026, 9, 11, 12) };

const layerOf = (body: string | Error) =>
  ShareTemplate.layerWith({
    fetch: vi.fn(async () => {
      if (body instanceof Error) throw body;
      return new Response(body);
    }) as unknown as typeof fetch,
    url: '/share-viewer.html',
  });

describe('makeShareHtml', () => {
  it.effect('injects the data block and names the file', () =>
    Effect.gen(function* () {
      const result = yield* makeShareHtml(sampleLibrary(), [id(1), id(2)], opts).pipe(
        Effect.provide(layerOf(TEMPLATE)),
      );
      expect(result.fileName).toBe('정자역-카페-20261011.html');
      expect(result.count).toBe(2);
      expect(result.html).not.toContain(SHARE_DATA_PLACEHOLDER);
      const m = /<script type="application\/json" id="tripmap-share">(.*)<\/script>/s.exec(
        result.html,
      );
      const doc = JSON.parse(m![1]!) as { format: string; title: string; places: unknown[] };
      expect(doc.format).toBe('tripmap-share');
      expect(doc.title).toBe('정자역 카페');
      expect(doc.places).toHaveLength(2);
    }),
  );

  it.effect('succeeds with zero places (count 0)', () =>
    Effect.gen(function* () {
      const result = yield* makeShareHtml(sampleLibrary(), [], opts).pipe(
        Effect.provide(layerOf(TEMPLATE)),
      );
      expect(result.count).toBe(0);
      expect(result.html).toContain('"places":[]');
    }),
  );

  it.effect('drops unknown ids from the count', () =>
    Effect.gen(function* () {
      const result = yield* makeShareHtml(sampleLibrary(), [id(1), 'zzzzzzzzzz'], opts).pipe(
        Effect.provide(layerOf(TEMPLATE)),
      );
      expect(result.count).toBe(1);
    }),
  );

  it.effect('fails with ShareTemplateUnavailable when the template cannot load', () =>
    Effect.gen(function* () {
      const err = yield* makeShareHtml(sampleLibrary(), [id(1)], opts).pipe(
        Effect.provide(layerOf(new TypeError('offline'))),
        Effect.flip,
      );
      expect(err).toBeInstanceOf(ShareTemplateUnavailable);
    }),
  );

  it.effect('fails with ShareDocInvalid (typed failure) when the doc breaks the schema', () =>
    Effect.gen(function* () {
      // createdAt 형식이 맞지 않는 now는 만들 수 없으므로, 잘못된 좌표를 가진 장소로 검증 실패를 만든다.
      const lib = sampleLibrary();
      const broken = {
        ...lib,
        places: { ...lib.places, [id(1)]: { ...lib.places[id(1)]!, lng: 999 } },
      };
      const err = yield* makeShareHtml(broken, [id(1)], opts).pipe(
        Effect.provide(layerOf(TEMPLATE)),
        Effect.flip,
      );
      expect(err).toBeInstanceOf(ShareDocInvalid);
      expect((err as ShareDocInvalid).message).not.toBe('');
      expect((err as ShareDocInvalid).userMessage).toBe(
        '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요',
      );
    }),
  );
});

describe('renderShareHtml', () => {
  test('builds the file from a template string synchronously, without the service', () => {
    const result = renderShareHtml(TEMPLATE, sampleLibrary(), [id(1), id(2)], opts);
    expect(Result.isSuccess(result)).toBe(true);
    const made = Result.getOrThrow(result);
    expect(made.fileName).toBe('정자역-카페-20261011.html');
    expect(made.count).toBe(2);
    expect(made.html).not.toContain(SHARE_DATA_PLACEHOLDER);
  });

  test('returns ShareDocInvalid as a failure when the doc breaks the schema', () => {
    const lib = sampleLibrary();
    const broken = {
      ...lib,
      places: { ...lib.places, [id(1)]: { ...lib.places[id(1)]!, lng: 999 } },
    };
    const result = renderShareHtml(TEMPLATE, broken, [id(1)], opts);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ShareDocInvalid);
  });
});

import { describe, expect, vi } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { ShareTemplateUnavailable } from 'src/services/errors';
import { ShareTemplate } from 'src/services/share-template';

const URL = '/share-viewer.html';
const GOOD = `<html><script id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script></html>`;

const textResponse = (body: string, status = 200) => new Response(body, { status });

describe('ShareTemplate', () => {
  it.effect('loads the template body and caches it within the layer', () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => textResponse(GOOD));
      const program = Effect.gen(function* () {
        const t = yield* ShareTemplate;
        const first = yield* t.load;
        const second = yield* t.load;
        return [first, second] as const;
      }).pipe(
        Effect.provide(ShareTemplate.layerWith({ fetch: fetchFn as typeof fetch, url: URL })),
      );
      const [first, second] = yield* program;
      expect(first).toBe(GOOD);
      expect(second).toBe(GOOD);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledWith(URL);
    }),
  );

  const failures: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
    ['a rejected fetch', async () => Promise.reject(new TypeError('network down'))],
    ['a 404 response', async () => textResponse('nope', 404)],
    ['a body without the placeholder', async () => textResponse('<html></html>')],
    [
      'a body with two placeholders',
      async () => textResponse(`${SHARE_DATA_PLACEHOLDER}${SHARE_DATA_PLACEHOLDER}`),
    ],
  ];

  for (const [name, respond] of failures) {
    it.effect(`fails with ShareTemplateUnavailable and re-fetches after ${name}`, () =>
      Effect.gen(function* () {
        let calls = 0;
        const fetchFn = vi.fn(async () => {
          calls += 1;
          return respond();
        });
        const program = Effect.gen(function* () {
          const t = yield* ShareTemplate;
          const first = yield* t.load.pipe(Effect.flip);
          const second = yield* t.load.pipe(Effect.flip);
          return [first, second] as const;
        }).pipe(
          Effect.provide(ShareTemplate.layerWith({ fetch: fetchFn as typeof fetch, url: URL })),
        );
        const [first, second] = yield* program;
        expect(first).toBeInstanceOf(ShareTemplateUnavailable);
        expect(second).toBeInstanceOf(ShareTemplateUnavailable);
        expect(first.reason).not.toBe('');
        expect(first.userMessage).toBe(
          '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요',
        );
        expect(calls).toBe(2);
      }),
    );
  }

  it.effect('does not cache a failure: a later success is returned and then cached', () =>
    Effect.gen(function* () {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(textResponse('x', 500))
        .mockResolvedValue(textResponse(GOOD));
      const program = Effect.gen(function* () {
        const t = yield* ShareTemplate;
        yield* t.load.pipe(Effect.flip);
        const ok = yield* t.load;
        yield* t.load;
        return ok;
      }).pipe(Effect.provide(ShareTemplate.layerWith({ fetch: fetchFn, url: URL })));
      expect(yield* program).toBe(GOOD);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    }),
  );
});

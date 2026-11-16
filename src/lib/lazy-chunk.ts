/** 나눠 받는 `import()`가 실패했을 때(새 배포로 옛 파일이 없는 경우 등) 던지는 오류. 원래 오류는 `cause`에 둔다. */
export class ChunkLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ChunkLoadError';
  }
}

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof ChunkLoadError;
}

/** `import()`를 감싸 실패를 `ChunkLoadError`로 바꿔 던진다. 성공하면 모듈을 그대로 돌려준다. */
export function lazyChunk<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch (cause) {
      throw new ChunkLoadError('화면 파일을 받지 못했어요', { cause });
    }
  };
}

/**
 * 나눠 받은 파일을 HTTP 캐시를 건너뛰고 다시 받아 둔 뒤 새로고침한다.
 * 배포 직후 없는 파일을 물으면 Cloudflare Pages가 앱 HTML을 200으로 돌려주고 브라우저가 이를 몇 시간 캐시한다.
 * 그러면 그냥 새로고침해도 같은 HTML을 다시 써서 안내 화면이 되풀이된다. 이 페이지가 받은 `/assets/*.js`를
 * `cache: 'reload'`로 다시 받아 캐시를 새 응답으로 덮은 뒤 새로고침한다(실패해도 새로고침은 한다).
 */
export async function reloadWithFreshChunks(
  win: Pick<Window, 'location' | 'performance' | 'fetch'> = window,
): Promise<void> {
  const prefix = `${win.location.origin}/assets/`;
  const urls = [
    ...new Set(
      win.performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(prefix) && url.endsWith('.js')),
    ),
  ];
  await Promise.allSettled(urls.map((url) => win.fetch(url, { cache: 'reload' })));
  win.location.reload();
}

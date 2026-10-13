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

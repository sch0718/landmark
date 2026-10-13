import { describe, expect, it } from 'vitest';
import { ChunkLoadError, isChunkLoadError, lazyChunk } from 'src/lib/lazy-chunk';

describe('lazyChunk', () => {
  it('성공하면 같은 모듈을 돌려준다', async () => {
    const mod = { default: 'x' };
    await expect(lazyChunk(() => Promise.resolve(mod))()).resolves.toBe(mod);
  });

  it('import가 실패하면 원래 오류를 cause로 담은 ChunkLoadError를 던진다', async () => {
    const cause = new TypeError('Failed to fetch dynamically imported module');
    const load = lazyChunk<never>(() => Promise.reject(cause));
    const error = await load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChunkLoadError);
    expect((error as ChunkLoadError).name).toBe('ChunkLoadError');
    expect((error as ChunkLoadError).cause).toBe(cause);
  });

  it('load가 동기로 던져도 ChunkLoadError로 바뀐다', async () => {
    const load = lazyChunk<never>(() => {
      throw new Error('sync');
    });
    await expect(load()).rejects.toBeInstanceOf(ChunkLoadError);
  });
});

describe('isChunkLoadError', () => {
  it('ChunkLoadError만 true', () => {
    expect(isChunkLoadError(new ChunkLoadError('x'))).toBe(true);
    expect(isChunkLoadError(new Error('x'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError('ChunkLoadError')).toBe(false);
  });
});

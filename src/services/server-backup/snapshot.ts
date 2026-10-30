import { buildBackupText } from 'src/domain/backup/build-backup';
import { readBackupText, type BackupReadResult } from 'src/domain/backup/read-backup';
import { libraryCounts, type LibraryCounts } from 'src/domain/backup/summary';
import { hashItem } from 'src/domain/library-sync/items';
import type { Library } from 'src/schema/library';
import type { Prefs } from 'src/schema/prefs';
export const SNAPSHOT_MAX_STORED_BYTES = 1_048_576;
export const SNAPSHOT_MAX_RAW_BYTES = 16_777_216;
export type SnapshotInput = {
  rawLibrary: unknown;
  library: Library;
  prefs: Prefs | null;
  now: Date;
};
export type BuiltSnapshot = {
  data: string;
  storedBytes: number;
  rawBytes: number;
  contentHash: string;
  counts: LibraryCounts;
  exportedAt: string;
};
export type BuildFailure = 'too-large' | 'unsupported';
export function compressionSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}
export async function gzipBytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
}
export async function gunzipLimited(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | 'too-big' | 'invalid'> {
  try {
    const reader = new Blob([new Uint8Array(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
      .getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        return 'too-big';
      }
      chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    return 'invalid';
  }
}
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function fromBase64(text: string): Uint8Array | null {
  if (!text.length || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
export function libraryContentHash(lib: Library): string {
  return hashItem(lib);
}
export async function buildSnapshot(
  input: SnapshotInput,
): Promise<{ ok: true; snapshot: BuiltSnapshot } | { ok: false; reason: BuildFailure }> {
  if (!compressionSupported()) return { ok: false, reason: 'unsupported' };
  const text = buildBackupText(input);
  const rawBytes = new TextEncoder().encode(text).length;
  if (rawBytes > SNAPSHOT_MAX_RAW_BYTES) return { ok: false, reason: 'too-large' };
  const bytes = await gzipBytes(text);
  if (bytes.length > SNAPSHOT_MAX_STORED_BYTES) return { ok: false, reason: 'too-large' };
  return {
    ok: true,
    snapshot: {
      data: toBase64(bytes),
      storedBytes: bytes.length,
      rawBytes,
      contentHash: libraryContentHash(input.library),
      counts: libraryCounts(input.library),
      exportedAt: input.now.toISOString(),
    },
  };
}
export async function readSnapshotData(data: string): Promise<BackupReadResult> {
  const bytes = fromBase64(data);
  if (!bytes) return { ok: false, error: 'invalid' };
  const raw = await gunzipLimited(bytes, SNAPSHOT_MAX_RAW_BYTES);
  if (typeof raw === 'string') return { ok: false, error: raw };
  try {
    return readBackupText(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return { ok: false, error: 'invalid' };
  }
}

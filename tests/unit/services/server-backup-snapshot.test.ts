// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import {
  buildSnapshot,
  readSnapshotData,
  libraryContentHash,
} from 'src/services/server-backup/snapshot';
import { buildBackupText } from 'src/domain/backup/build-backup';
import { hashItem } from 'src/domain/library-sync/items';
import { DEFAULT_PREFS } from 'src/schema/prefs';
import { makeLibrary, place } from '../domain/backup/fixtures';
const library = makeLibrary({ places: [place(1)] });
const input = {
  rawLibrary: library,
  library,
  prefs: DEFAULT_PREFS,
  now: new Date('2026-10-29T00:00:00Z'),
};
afterEach(() => vi.unstubAllGlobals());
it('백업 원문과 설정을 gzip·base64로 왕복한다', async () => {
  const result = await buildSnapshot(input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const s = result.snapshot;
  const text = buildBackupText(input);
  expect(s.data.startsWith('H4sI')).toBe(true);
  expect(gunzipSync(Buffer.from(s.data, 'base64')).toString()).toBe(text);
  expect(s.rawBytes).toBe(Buffer.byteLength(text));
  expect(s.storedBytes).toBe(Buffer.from(s.data, 'base64').length);
  expect(s.contentHash).toBe(hashItem(library));
  expect(s.counts.places).toBe(1);
  const read = await readSnapshotData(s.data);
  expect(read.ok).toBe(true);
  if (read.ok) {
    expect(read.backup.library).toEqual(library);
    expect(read.backup.prefs).toEqual(DEFAULT_PREFS);
  }
  expect(libraryContentHash({ ...library, places: library.places })).toBe(
    libraryContentHash(library),
  );
});
it('압축 미지원이면 만들지 않는다', async () => {
  vi.stubGlobal('CompressionStream', undefined);
  expect(await buildSnapshot(input)).toEqual({ ok: false, reason: 'unsupported' });
});
it('압축과 원문 크기 상한을 각각 지킨다', async () => {
  for (const junk of [randomBytes(1100000).toString('hex'), '가'.repeat(6000000)])
    expect(await buildSnapshot({ ...input, rawLibrary: { ...library, junk } })).toEqual({
      ok: false,
      reason: 'too-large',
    });
});
it.each([
  ['!!!', 'invalid'],
  [Buffer.from('hello').toString('base64'), 'invalid'],
  [gzipSync('not json').toString('base64'), 'not-backup'],
  [gzipSync(Buffer.alloc(17000000)).toString('base64'), 'too-big'],
])('깨진 자료와 풀기 상한을 검사한다: %s', async (data, error) => {
  expect(await readSnapshotData(data)).toEqual({ ok: false, error });
});

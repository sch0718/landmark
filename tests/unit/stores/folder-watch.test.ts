import { expect, it } from 'vitest';
import { folderNotice, folderNoticeText, labelNoticeText } from 'src/stores/folder-watch';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { makeLibrary, label } from '../domain/backup/fixtures';
const now = Date.parse('2026-10-30T00:00:00Z');
const link = recordFolderLink(
  makeLibrary({ labels: [label(1)] }),
  { shareId: 'a'.repeat(32), folderName: '폴더', labelId: label(1).id, seenSids: [] },
  { now: new Date(now - 1000).toISOString(), newId: () => '' },
).folders!['a'.repeat(32)]!;
const entry = {
  checkedAt: now,
  fresh: 2,
  missing: 1,
  signature: 'abc',
  notified: 'abc',
  error: null,
};
it('기록과 연결의 시각, 빈 결과를 검사한다', () => {
  expect(folderNotice(link, undefined)).toBeNull();
  expect(folderNotice(link, { ...entry, checkedAt: now - 1000 })).toBeNull();
  expect(folderNotice(link, { ...entry, fresh: 0, missing: 0 })).toBeNull();
  expect(folderNotice(link, entry)).toMatchObject({ fresh: 2, missing: 1, notFound: false });
});
it('라벨 꼬리에서 수를 합치고 찾지 못함은 숨긴다', () => {
  const n = folderNotice(link, entry)!;
  expect(labelNoticeText([n, n])).toBe(' · 새로 저장한 곳 4곳');
  expect(labelNoticeText([{ ...n, fresh: 0 }])).toBe(' · 폴더에서 빠진 곳 1곳');
  expect(labelNoticeText([{ ...n, fresh: 0, missing: 0, notFound: true }])).toBeNull();
});
it('고치기 문구 네 모양을 만든다', () => {
  const n = folderNotice(link, entry)!;
  expect(folderNoticeText(n)).toContain('네이버에 새로 저장한 곳 2곳 · 빠진 곳 1곳 (10.30 확인)');
  expect(folderNoticeText({ ...n, missing: 0 })).toContain('네이버에 새로 저장한 곳 2곳');
  expect(folderNoticeText({ ...n, fresh: 0 })).toContain('네이버 폴더에서 빠진 곳 1곳');
  expect(folderNoticeText({ ...n, notFound: true })).toContain(
    '마지막 확인 때 폴더를 찾지 못했어요',
  );
});

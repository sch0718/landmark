import type { OpCtx } from 'src/domain/library/ops';
import { setField } from 'src/domain/library/lww';
import { LIBRARY_LIMITS, type FolderLink, type Library } from 'src/schema/library';

// 네이버 공유 폴더와 라벨의 연결을 읽고 쓰는 곳(스펙 §3). 모두 입력을 바꾸지 않는 순수 함수다.
// 첫 화면 번들인 `ops.ts`는 이 파일을 import하지 않는다(라벨 연산이 쓰는 도우미는 `ops.ts`에 따로 있다).

const SID = /^\d+$/;

/** 문서에 담긴 모든 연결(지운 것 포함). `folders` 키가 없는 옛 문서는 빈 레코드다. */
export function folderLinks(lib: Library): Readonly<Record<string, FolderLink>> {
  return lib.folders ?? {};
}

/** 지우지 않았고 가리키는 라벨도 살아 있는 연결. 아니면 `undefined`. */
export function liveFolderLink(lib: Library, shareId: string): FolderLink | undefined {
  const link = folderLinks(lib)[shareId];
  if (link === undefined || link.deletedAt !== null) return undefined;
  const label = lib.labels[link.labelId.value];
  return label !== undefined && label.deletedAt === null ? link : undefined;
}

/** 라벨에 연결된 살아 있는 폴더를 이름(`ko`) 순으로. */
export function folderLinksOfLabel(lib: Library, labelId: string): FolderLink[] {
  return Object.keys(folderLinks(lib))
    .map((shareId) => liveFolderLink(lib, shareId))
    .filter((l): l is FolderLink => l !== undefined && l.labelId.value === labelId)
    .sort((a, b) => a.name.value.localeCompare(b.name.value, 'ko'));
}

export type FolderLinkInput = {
  shareId: string;
  folderName: string;
  labelId: string;
  seenSids: readonly string[];
};

/** 순서를 유지한 채 숫자 sid만 중복 없이 앞에서 한도까지. */
function normalizeSids(sids: readonly string[]): string[] {
  return [...new Set(sids.filter((s) => SID.test(s)))].slice(0, LIBRARY_LIMITS.folderSids);
}

/**
 * 폴더를 라벨에 연결하고 확인한 `sid` 목록을 기록한다. 이미 있는 연결(지운 것 포함)이면
 * 값이 바뀐 필드만 `ctx.now`로 갱신하고 `createdAt`은 유지하며, 지웠다면 되살린다.
 */
export function recordFolderLink(lib: Library, input: FolderLinkInput, ctx: OpCtx): Library {
  const name = input.folderName.trim().slice(0, LIBRARY_LIMITS.folderNameChars);
  const seenSids = normalizeSids(input.seenSids);
  const prev = folderLinks(lib)[input.shareId];
  const next: FolderLink =
    prev === undefined
      ? {
          shareId: input.shareId,
          name: { value: name, updatedAt: ctx.now },
          labelId: { value: input.labelId, updatedAt: ctx.now },
          seenSids: { value: seenSids, updatedAt: ctx.now },
          checkedAt: ctx.now,
          createdAt: ctx.now,
          deletedAt: null,
        }
      : {
          ...prev,
          name: setField(prev.name, name, ctx.now),
          labelId: setField(prev.labelId, input.labelId, ctx.now),
          seenSids: setField(prev.seenSids, seenSids, ctx.now),
          checkedAt: ctx.now,
          deletedAt: null,
        };
  return { ...lib, folders: { ...lib.folders, [input.shareId]: next } };
}

/** 연결을 끊는다(삭제 표시). 라벨과 장소는 그대로다. 살아 있지 않으면 `lib` 그대로. */
export function unlinkFolder(lib: Library, shareId: string, ctx: OpCtx): Library {
  const link = folderLinks(lib)[shareId];
  if (link === undefined || link.deletedAt !== null) return lib;
  return { ...lib, folders: { ...lib.folders, [shareId]: { ...link, deletedAt: ctx.now } } };
}

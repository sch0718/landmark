import { defaultTitleLabel } from 'src/domain/library/import-share';
import { importSharedTrip } from 'src/domain/library/import-share-trip';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { emptyLibrary, type Library } from 'src/schema/library';
import type { ShareDocV2 } from 'src/schema/share';

/** 장소·라벨·여행의 키 정렬 JSON이 동기화 항목 상한을 넘는지 본다. */
export function oversizedItems(lib: Library, max: number): string[] {
  return (
    [
      ['place', lib.places],
      ['label', lib.labels],
      ['trip', lib.trips],
    ] as const
  ).flatMap(([kind, items]) =>
    Object.entries(items).flatMap(([id, item]) =>
      stableStringify(item).length > max ? [`${kind}:${id}`] : [],
    ),
  );
}

/** 기본 미리보기 설정으로 가져온 항목이 다른 기기에도 동기화될 수 있는지 본다. */
export function importedItemProblem(doc: ShareDocV2): 'import' | 'item-too-large' | null {
  let sequence = 0;
  const imported = importSharedTrip(
    emptyLibrary(),
    doc,
    { titleLabel: defaultTitleLabel(doc.title), appendMemo: true },
    {
      now: '2000-01-01T00:00:00.000Z',
      // 실제 앱과 같은 길이의 id로, 실행마다 같은 크기의 항목을 만든다.
      newId: (kind) =>
        (++sequence).toString(36).padStart(kind === 'label' || kind === 'stop' ? 8 : 10, '0'),
    },
  );
  if (!imported.ok) return 'import';
  return oversizedItems(imported.lib, ITEM_DOC_MAX_CHARS).length > 0 ? 'item-too-large' : null;
}

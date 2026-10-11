import type { LibraryQuery } from 'src/domain/library/query';
import type { Label, Place } from 'src/schema/library';

/** 내보낼 장소 id(목록 순서)와 창에 보일 대상 문구, 제목 기본값. */
export type ExportTargets = { ids: string[]; summary: string; defaultTitle: string };

/** 라벨 칩 줄의 "미분류" 칩 이름. */
const UNLABELED_NAME = '미분류';

/**
 * 내보낼 대상을 정한다(스펙 §3.2·§3.3). 고른 장소가 있으면 지금 보이는 목록 중 고른 것만,
 * 없으면 보이는 전부를 목록 순서대로 담는다. 보이지 않는(지웠거나 필터로 빠진) 선택 id는
 * 조용히 빼고, 그래서 0곳이 되어도 보이는 전부로 바꾸지 않는다(창에서 버튼을 막는다).
 */
export function exportTargets(
  visible: Place[],
  selectedIds: readonly string[],
  query: LibraryQuery,
  labels: Label[],
): ExportTargets {
  // 필터 라벨은 보관함의 라벨 순서로, 살아 있는 것만 센다.
  const filterNames = query.unlabeled
    ? [UNLABELED_NAME]
    : labels.filter((l) => query.labelIds.includes(l.id)).map((l) => l.name.value);

  let ids: string[];
  let summary: string;
  if (selectedIds.length > 0) {
    const chosen = new Set(selectedIds);
    ids = visible.filter((p) => chosen.has(p.id)).map((p) => p.id);
    summary = `선택한 ${ids.length}곳을 내보냅니다`;
  } else {
    ids = visible.map((p) => p.id);
    summary = `지금 보이는 ${ids.length}곳을 내보냅니다`;
    if (filterNames.length > 0) summary += ` (라벨: ${filterNames.join(', ')})`;
    const text = query.text.trim();
    if (text !== '') summary += ` (검색: ${text})`;
  }

  const defaultTitle =
    !query.unlabeled && filterNames.length === 1 ? filterNames[0]! : `장소 ${ids.length}곳`;
  return { ids, summary, defaultTitle };
}

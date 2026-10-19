import { liveLabels, livePlaces } from 'src/domain/library/query';
import { normalizeLabelName, type Label, type Library } from 'src/schema/library';

/**
 * 라벨마다 붙은 보관함 장소 수(라벨 고르기 창의 `N곳`). 살아 있는 장소(`livePlaces`)에 붙은 살아 있는 라벨만 센다.
 * 필터 칩 숫자(`labelCounts`)와 달리 검색·지역을 따지지 않아 장소마다 지역을 읽지 않는다.
 */
export function countLabelUses(lib: Library): Map<string, number> {
  const live = new Set(liveLabels(lib).map((label) => label.id));
  const counts = new Map<string, number>();
  for (const place of livePlaces(lib)) {
    for (const id of new Set(place.labelIds.value)) {
      if (live.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * 라벨 고르기 창의 줄 순서(스펙 §5.2): ① 이 장소에 붙은 라벨 ② 많이 쓴 순 ③ 원래 라벨 순서(`labels`의 순서).
 * 창을 열 때 한 번 계산해 두고 창이 열려 있는 동안 고정한다(체크할 때마다 줄이 움직이지 않게).
 */
export function orderLabelsForPicker(
  labels: readonly Label[],
  attachedIds: readonly string[],
  counts: ReadonlyMap<string, number>,
): string[] {
  const attached = new Set(attachedIds);
  const index = new Map(labels.map((label, i) => [label.id, i]));
  return [...labels]
    .sort(
      (x, y) =>
        Number(attached.has(y.id)) - Number(attached.has(x.id)) ||
        (counts.get(y.id) ?? 0) - (counts.get(x.id) ?? 0) ||
        index.get(x.id)! - index.get(y.id)!,
    )
    .map((label) => label.id);
}

/** 고정해 둔 순서(`order`)로 라벨을 늘어놓는다. 순서에 없는(창을 연 뒤 만든) 라벨은 맨 앞에 둔다. */
export function arrangeLabels(labels: readonly Label[], order: readonly string[]): Label[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...labels].sort((x, y) => (rank.get(x.id) ?? -1) - (rank.get(y.id) ?? -1));
}

/** 검색용으로 접는다. 새 라벨 중복 판정(`normalizeLabelName`)과 같게 하고 NFC로 맞춘다(맥에서 붙여 넣은 NFD 글자). */
function fold(text: string): string {
  return normalizeLabelName(text.normalize('NFC'));
}

/** 이름에 검색어가 든 라벨만 남긴다. 검색어가 비면 전부. */
export function filterLabels(labels: readonly Label[], text: string): Label[] {
  const needle = fold(text);
  if (needle === '') return [...labels];
  return labels.filter((label) => fold(label.name.value).includes(needle));
}

/** 검색어로 새 라벨을 만들 수 있는가: 비어 있지 않고 같은 이름(`normalizeLabelName`)의 라벨이 없다. */
export function canCreateLabel(labels: readonly Label[], text: string): boolean {
  const wanted = normalizeLabelName(text);
  return wanted !== '' && !labels.some((label) => normalizeLabelName(label.name.value) === wanted);
}

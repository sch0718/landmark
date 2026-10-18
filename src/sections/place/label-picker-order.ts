import { normalizeLabelName, type Label } from 'src/schema/library';

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

function fold(text: string): string {
  return text.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
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

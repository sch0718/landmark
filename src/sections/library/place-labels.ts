import type { Label, Place } from 'src/schema/library';

/** 장소에 붙은 살아 있는 라벨. `labelIds` 순서를 따르므로 첫 번째가 대표 라벨이다. */
export function placeLabels(place: Place, byId: ReadonlyMap<string, Label>): Label[] {
  const labels: Label[] = [];
  for (const id of place.labelIds.value) {
    const label = byId.get(id);
    if (label !== undefined) labels.push(label);
  }
  return labels;
}

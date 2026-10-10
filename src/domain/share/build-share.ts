import type { Library } from 'src/schema/library';
import type { ShareDoc, ShareLabel, SharePlace } from 'src/schema/share';

export type BuildShareOptions = { title: string; includeMemo: boolean; now: Date };

/**
 * 보관함에서 고른 장소로 공유 데이터를 만든다.
 * 지웠거나 없는 장소 id는 조용히 빼고, 순서는 넘겨 받은 순서를 지킨다.
 * 라벨은 살아 있고 내보내는 장소가 쓰는 것만 `order` 오름차순으로 담는다.
 */
export function buildShareDoc(
  lib: Library,
  placeIds: readonly string[],
  opts: BuildShareOptions,
): ShareDoc {
  const usedLabelIds = new Set<string>();
  const places: SharePlace[] = [];

  for (const id of placeIds) {
    const place = lib.places[id];
    if (place === undefined || place.deletedAt !== null) continue;

    // 장소의 라벨은 원래 순서에서 살아 있는 것만 남긴다.
    const labelIds = place.labelIds.value.filter((labelId) => {
      const label = lib.labels[labelId];
      return label !== undefined && label.deletedAt === null;
    });
    for (const labelId of labelIds) usedLabelIds.add(labelId);

    const out: SharePlace = {
      id: place.id,
      name: place.name.value,
      address: place.address,
      lng: place.lng,
      lat: place.lat,
      labelIds,
    };
    if (opts.includeMemo && place.memo.value !== '') out.memo = place.memo.value;
    if (place.source.kind === 'naver') out.naverSid = place.source.sid;
    places.push(out);
  }

  const labels: ShareLabel[] = [...usedLabelIds]
    .map((labelId) => lib.labels[labelId]!)
    .sort((a, b) => a.order.value - b.order.value)
    .map((label) => ({
      id: label.id,
      name: label.name.value,
      color: label.color.value,
      order: label.order.value,
    }));

  return {
    format: 'tripmap-share',
    version: 1,
    title: opts.title.trim(),
    createdAt: opts.now.toISOString(),
    labels,
    places,
  };
}

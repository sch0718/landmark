import type { Library, Place } from 'src/schema/library';
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
    const out = toSharePlace(place, lib, opts.includeMemo);
    for (const labelId of out.labelIds) usedLabelIds.add(labelId);
    places.push(out);
  }

  return {
    format: 'tripmap-share',
    version: 1,
    title: opts.title.trim(),
    createdAt: opts.now.toISOString(),
    labels: toShareLabels(lib, usedLabelIds),
    places,
  };
}

/**
 * 장소 하나를 공유 문서의 장소로 바꾼다. 라벨은 살아 있는 것만 원래 순서로 남긴다.
 * `includeReview`는 v2 문서를 만들 때만 켠다: v1 스키마는 `review`를 거절하므로 v1은 늘 끈다.
 * 한 줄 평은 `includeMemo`와 함께 `includeReview`가 켜져 있고 비어 있지 않을 때만 담는다.
 */
export function toSharePlace(
  place: Place,
  lib: Library,
  includeMemo: boolean,
  includeReview = false,
): SharePlace {
  const labelIds = place.labelIds.value.filter((labelId) => {
    const label = lib.labels[labelId];
    return label !== undefined && label.deletedAt === null;
  });
  const out: SharePlace = {
    id: place.id,
    name: place.name.value,
    address: place.address,
    lng: place.lng,
    lat: place.lat,
    labelIds,
  };
  if (includeMemo && place.memo.value !== '') out.memo = place.memo.value;
  if (place.source.kind === 'naver') out.naverSid = place.source.sid;
  else if (place.source.kind === 'kakao') out.kakaoId = place.source.kakaoId;
  else if (place.source.kind === 'google') out.googleId = place.source.googleId;
  const review = place.review?.value;
  if (includeMemo && includeReview && review !== undefined && review !== '') out.review = review;
  return out;
}

/** 쓰이는 라벨 id 가운데 살아 있는 것만 `order` 오름차순으로 담는다. */
export function toShareLabels(lib: Library, usedLabelIds: ReadonlySet<string>): ShareLabel[] {
  return [...usedLabelIds]
    .map((labelId) => lib.labels[labelId]!)
    .sort((a, b) => a.order.value - b.order.value)
    .map((label) => ({
      id: label.id,
      name: label.name.value,
      color: label.color.value,
      order: label.order.value,
    }));
}

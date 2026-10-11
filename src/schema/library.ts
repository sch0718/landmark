import { Schema } from 'effect';
import { IsoDateTime, Lat, Lng, PlaceKey, PublicId } from 'src/schema/common';
import { LABEL_COLORS } from 'src/schema/label-colors';

// 기존 import 경로가 그대로 동작하도록 다시 내보낸다.
export { LABEL_COLORS };

export const LIBRARY_LIMITS = {
  memoChars: 10_000,
  labelNameChars: 30,
  /** 직렬화한 JSON의 `String.length` 상한. */
  libraryChars: 4_000_000,
} as const;

export const LABEL_ICONS = [
  'utensils',
  'soup',
  'coffee',
  'croissant',
  'beer',
  'wine',
  'ice-cream-cone',
  'fish',
  'beef',
  'salad',
  'waves',
  'mountain',
  'trees',
  'tent',
  'camera',
  'landmark',
  'castle',
  'church',
  'shopping-bag',
  'store',
  'bed',
  'hotel',
  'car',
  'train-front',
  'footprints',
  'baby',
  'dog',
  'music',
  'palette',
  'star',
  'heart',
  'flag',
] as const;

export const PlaceId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{10}$/, { message: 'PlaceId는 영숫자 소문자 10자입니다' }),
);
export const LabelId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{8}$/, { message: 'LabelId는 영숫자 소문자 8자입니다' }),
);
export const LabelColor = Schema.Literals(LABEL_COLORS);
export const LabelIcon = Schema.Literals(LABEL_ICONS);
export type LabelColor = typeof LabelColor.Type;
export type LabelIcon = typeof LabelIcon.Type;

/** 필드 단위 최신값 우선(LWW)을 위한 `{ value, updatedAt }` 묶음. */
export const FieldSchema = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({ value: schema, updatedAt: IsoDateTime });

export const PlaceSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('naver'),
    sid: Schema.String.check(Schema.isPattern(/^\d+$/, { message: 'sid는 숫자입니다' })),
  }),
  Schema.Struct({
    kind: Schema.Literal('pin'),
    legacy: Schema.optional(Schema.Struct({ publicId: PublicId, placeKey: PlaceKey })),
  }),
]);
export type PlaceSource = typeof PlaceSource.Type;

export const PlaceSchema = Schema.Struct({
  id: PlaceId,
  source: PlaceSource,
  name: FieldSchema(Schema.String),
  address: Schema.String,
  lng: Lng,
  lat: Lat,
  category: FieldSchema(Schema.NullOr(Schema.String)),
  labelIds: FieldSchema(Schema.Array(LabelId)),
  memo: FieldSchema(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.memoChars))),
  saved: FieldSchema(Schema.Boolean),
  createdAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

export const LabelSchema = Schema.Struct({
  id: LabelId,
  name: FieldSchema(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(LIBRARY_LIMITS.labelNameChars)),
  ),
  color: FieldSchema(LabelColor),
  icon: FieldSchema(LabelIcon),
  order: FieldSchema(Schema.Finite),
  createdAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});

/** 라벨 이름 비교용 정규형: 앞뒤 공백 제거 → 연속 공백을 하나로 → 소문자. */
export function normalizeLabelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

export const LibrarySchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  // 키에 `PlaceId`/`LabelId`를 걸면 Effect가 형식이 틀린 항목을 오류 없이 버린다(데이터 손실).
  // 키는 `Schema.String`으로 받고, 아래 필터에서 `키 === id`를 검사한다(id는 값 스키마가 검증한다).
  places: Schema.Record(Schema.String, PlaceSchema),
  labels: Schema.Record(Schema.String, LabelSchema),
  /** 3번 하위 프로젝트에서 정의한다. 1번에서는 빈 객체만 허용한다. */
  trips: Schema.Record(Schema.String, Schema.Never),
}).check(
  Schema.makeFilter((library) => {
    const issues: Schema.FilterIssue[] = [];
    for (const [key, place] of Object.entries(library.places)) {
      if (key !== place.id) {
        issues.push({ path: ['places', key], issue: `키와 id가 다릅니다: ${key}` });
      }
    }
    for (const [key, label] of Object.entries(library.labels)) {
      if (key !== label.id) {
        issues.push({ path: ['labels', key], issue: `키와 id가 다릅니다: ${key}` });
      }
    }
    const livePlaces = Object.entries(library.places).filter(([, p]) => p.deletedAt === null);
    const liveLabels = Object.entries(library.labels).filter(([, l]) => l.deletedAt === null);

    const seenSid = new Set<string>();
    for (const [id, place] of livePlaces) {
      if (place.source.kind !== 'naver') continue;
      if (seenSid.has(place.source.sid)) {
        issues.push({
          path: ['places', id],
          issue: `네이버 장소가 중복됩니다: ${place.source.sid}`,
        });
      }
      seenSid.add(place.source.sid);
    }

    const seenLegacy = new Set<string>();
    for (const [id, place] of livePlaces) {
      if (place.source.kind !== 'pin' || place.source.legacy === undefined) continue;
      const { publicId, placeKey } = place.source.legacy;
      const key = `${publicId}/${placeKey}`;
      if (seenLegacy.has(key)) {
        issues.push({
          path: ['places', id],
          issue: `옛 사용자 지정 장소가 중복됩니다: ${key}`,
        });
      }
      seenLegacy.add(key);
    }

    const seenName = new Set<string>();
    for (const [id, label] of liveLabels) {
      const normalized = normalizeLabelName(label.name.value);
      if (seenName.has(normalized)) {
        issues.push({ path: ['labels', id], issue: `라벨 이름이 중복됩니다: ${normalized}` });
      }
      seenName.add(normalized);
    }

    for (const [id, place] of livePlaces) {
      for (const labelId of place.labelIds.value) {
        const label = library.labels[labelId];
        if (label === undefined || label.deletedAt !== null) {
          issues.push({ path: ['places', id], issue: `없는 라벨입니다: ${labelId}` });
        }
      }
    }
    return issues;
  }),
);

export type Place = typeof PlaceSchema.Type;
export type Label = typeof LabelSchema.Type;
export type Library = typeof LibrarySchema.Type;

export function emptyLibrary(): Library {
  return { schemaVersion: 2, places: {}, labels: {}, trips: {} };
}

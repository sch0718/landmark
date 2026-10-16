import { Schema } from 'effect';
import { CalendarDate, IsoDateTime, Lat, Lng, PlaceKey, PublicId } from 'src/schema/common';
import { LABEL_COLORS } from 'src/schema/label-colors';
import { FieldSchema, LIBRARY_LIMITS, PlaceId } from 'src/schema/library-base';
import { checkTrip, TripSchema } from 'src/schema/trip';

// 기존 import 경로가 그대로 동작하도록 다시 내보낸다.
export { FieldSchema, LABEL_COLORS, LIBRARY_LIMITS, PlaceId };

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

export const LabelId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{8}$/, { message: 'LabelId는 영숫자 소문자 8자입니다' }),
);
export const LabelColor = Schema.Literals(LABEL_COLORS);
export const LabelIcon = Schema.Literals(LABEL_ICONS);
export type LabelColor = typeof LabelColor.Type;
export type LabelIcon = typeof LabelIcon.Type;

export const PlaceSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('naver'),
    sid: Schema.String.check(Schema.isPattern(/^\d+$/, { message: 'sid는 숫자입니다' })),
  }),
  Schema.Struct({
    kind: Schema.Literal('kakao'),
    kakaoId: Schema.String.check(Schema.isPattern(/^\d+$/, { message: 'kakaoId는 숫자입니다' })),
  }),
  Schema.Struct({
    kind: Schema.Literal('google'),
    googleId: Schema.String.check(
      Schema.isPattern(/^0x[0-9a-f]+:0x[0-9a-f]+$/, {
        message: 'googleId는 0x…:0x… 형식입니다',
      }),
    ),
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
  // 선택 필드: 옛 문서에는 키가 없고, 처음 쓸 때 생긴다. `visitedOn: null`은 "다녀옴 취소"를 LWW로 전하는 값이다.
  visitedOn: Schema.optional(FieldSchema(Schema.NullOr(CalendarDate))),
  review: Schema.optional(
    FieldSchema(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.reviewChars))),
  ),
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

/** 라벨 이름의 문제. 앞뒤 공백을 지운 길이로 판단한다. */
export type LabelNameIssue = 'empty' | 'too-long';

export function labelNameIssue(name: string): LabelNameIssue | null {
  const length = name.trim().length;
  if (length === 0) return 'empty';
  return length > LIBRARY_LIMITS.labelNameChars ? 'too-long' : null;
}

/** 라벨 이름이 1–최대 글자 수가 아닐 때 보일 문구. */
export const LABEL_NAME_RANGE_MESSAGE = `1–${LIBRARY_LIMITS.labelNameChars}자로 입력하세요`;

export const LibrarySchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  // 키에 `PlaceId`/`LabelId`를 걸면 Effect가 형식이 틀린 항목을 오류 없이 버린다(데이터 손실).
  // 키는 `Schema.String`으로 받고, 아래 필터에서 `키 === id`를 검사한다(id는 값 스키마가 검증한다).
  places: Schema.Record(Schema.String, PlaceSchema),
  labels: Schema.Record(Schema.String, LabelSchema),
  trips: Schema.Record(Schema.String, TripSchema),
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
    for (const [key, trip] of Object.entries(library.trips)) {
      if (key !== trip.id) {
        issues.push({ path: ['trips', key], issue: `키와 id가 다릅니다: ${key}` });
      }
      // 묘비인 장소도 참조할 수 있어 `library.places` 전체를 넘긴다.
      issues.push(...checkTrip(trip, library.places, ['trips', key]));
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

    const seenKakao = new Set<string>();
    for (const [id, place] of livePlaces) {
      if (place.source.kind !== 'kakao') continue;
      if (seenKakao.has(place.source.kakaoId)) {
        issues.push({
          path: ['places', id],
          issue: `카카오 장소가 중복됩니다: ${place.source.kakaoId}`,
        });
      }
      seenKakao.add(place.source.kakaoId);
    }

    const seenGoogle = new Set<string>();
    for (const [id, place] of livePlaces) {
      if (place.source.kind !== 'google') continue;
      if (seenGoogle.has(place.source.googleId)) {
        issues.push({
          path: ['places', id],
          issue: `구글 장소가 중복됩니다: ${place.source.googleId}`,
        });
      }
      seenGoogle.add(place.source.googleId);
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

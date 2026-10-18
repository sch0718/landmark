import { Schema } from 'effect';
import { LABEL_COLORS, type LabelColorName } from 'src/schema/label-colors';
import { CalendarDate, HHmm, IsoDateTime, Lat, Lng } from 'src/schema/common';
import { LIBRARY_LIMITS } from 'src/schema/library-base';

/**
 * 내보낸 HTML 파일에 들어가는 데이터. 보기 화면은 타입만 `import type`으로 가져다 쓴다
 * (Effect가 보기 화면 번들에 들어가지 않게).
 */
export type ShareLabel = { id: string; name: string; color: LabelColorName; order: number };
export type SharePlace = {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  labelIds: string[];
  /** 메모 포함을 켰고 비어 있지 않을 때만 있다. */
  memo?: string;
  /** 네이버 장소일 때만 있다. */
  naverSid?: string;
  /** 카카오 장소일 때만 있다. */
  kakaoId?: string;
  /** 구글 장소일 때만 있다. */
  googleId?: string;
  /** v2 문서에만 있다. 메모 포함을 켰고 한 줄 평이 있을 때만 있다. */
  review?: string;
};
export type ShareStop = {
  placeId: string;
  stayMin: number | null;
  fixedTime: string | null;
  /** 비면 뺀다. */
  note?: string;
};
export type ShareLegStatus = 'routed' | 'estimated' | 'no-route' | 'same-point';
export type ShareLeg = {
  from: string;
  to: string;
  mode: 'car' | 'walk';
  durationS: number;
  distanceM: number;
  tollFare: number | null;
  status: ShareLegStatus;
  /** `routed`일 때만 ISO 시각, 그 밖은 `null`. */
  queriedAt: string | null;
  /** `routed`가 아니면 `[]`. 점은 `[경도, 위도]`. */
  path: [number, number][];
};
export type ShareDay = {
  startTime: string;
  lodgingId: string | null;
  stops: ShareStop[];
  legs: ShareLeg[];
};
export type ShareTrip = {
  title: string;
  startDate: string;
  endDate: string;
  originId: string | null;
  candidateIds: string[];
  days: ShareDay[];
  legModes: Record<string, 'car' | 'walk'>;
};
export type ShareDocV1 = {
  format: 'tripmap-share';
  version: 1;
  title: string;
  createdAt: string;
  labels: ShareLabel[];
  places: SharePlace[];
};
export type ShareDocV2 = Omit<ShareDocV1, 'version'> & { version: 2; trips: ShareTrip[] };
export type ShareDoc = ShareDocV1 | ShareDocV2;

const ShareLabelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.Literals(LABEL_COLORS),
  order: Schema.Finite,
});

const sharePlaceFields = {
  id: Schema.String,
  name: Schema.String,
  address: Schema.String,
  lng: Lng,
  lat: Lat,
  labelIds: Schema.mutable(Schema.Array(Schema.String)),
  memo: Schema.optionalKey(Schema.String),
  naverSid: Schema.optionalKey(Schema.String),
  kakaoId: Schema.optionalKey(Schema.String),
  googleId: Schema.optionalKey(Schema.String),
};

const SharePlaceSchema = Schema.Struct(sharePlaceFields);

/** v2 장소: v1 필드 + 한 줄 평. v1 스키마에는 `review`를 더하지 않는다. */
const SharePlaceV2Schema = Schema.Struct({
  ...sharePlaceFields,
  review: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.reviewChars))),
});

/** 검증할 때는 `onExcessProperty: 'error'`로 모르는 필드를 거절한다. */
export const ShareDocSchema = Schema.Struct({
  format: Schema.Literal('tripmap-share'),
  version: Schema.Literal(1),
  title: Schema.String,
  createdAt: IsoDateTime,
  labels: Schema.mutable(Schema.Array(ShareLabelSchema)),
  places: Schema.mutable(Schema.Array(SharePlaceSchema)),
});

const ShareStopSchema = Schema.Struct({
  placeId: Schema.String,
  stayMin: Schema.NullOr(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 0, maximum: LIBRARY_LIMITS.stayMaxMin }),
    ),
  ),
  fixedTime: Schema.NullOr(HHmm),
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(LIBRARY_LIMITS.stopNoteChars))),
});

const ShareLegSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  mode: Schema.Literals(['car', 'walk']),
  durationS: Schema.Finite,
  distanceM: Schema.Finite,
  tollFare: Schema.NullOr(Schema.Finite),
  status: Schema.Literals(['routed', 'estimated', 'no-route', 'same-point']),
  queriedAt: Schema.NullOr(IsoDateTime),
  path: Schema.mutable(Schema.Array(Schema.mutable(Schema.Tuple([Schema.Finite, Schema.Finite])))),
});

const ShareDaySchema = Schema.Struct({
  startTime: HHmm,
  lodgingId: Schema.NullOr(Schema.String),
  stops: Schema.mutable(Schema.Array(ShareStopSchema)),
  legs: Schema.mutable(Schema.Array(ShareLegSchema)),
});

const ShareTripSchema = Schema.Struct({
  title: Schema.String,
  startDate: CalendarDate,
  endDate: CalendarDate,
  originId: Schema.NullOr(Schema.String),
  candidateIds: Schema.mutable(Schema.Array(Schema.String)),
  days: Schema.mutable(Schema.Array(ShareDaySchema)),
  // 키 형식("<id>><id>")은 `checkShareTrip`이 본다. 키에 패턴을 걸면 Effect가 틀린 항목을
  // 오류 없이 버리기 때문이다(library.ts 참고).
  legModes: Schema.Record(Schema.String, Schema.Literals(['car', 'walk'])),
});

/** v2: v1 필드 + `places[].review` + `trips`(정확히 1개). 관계 규칙은 `checkShareTrip`이 본다. */
export const ShareDocV2Schema = Schema.Struct({
  format: Schema.Literal('tripmap-share'),
  version: Schema.Literal(2),
  title: Schema.String,
  createdAt: IsoDateTime,
  labels: Schema.mutable(Schema.Array(ShareLabelSchema)),
  places: Schema.mutable(Schema.Array(SharePlaceV2Schema)),
  trips: Schema.mutable(Schema.Array(ShareTripSchema)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1),
  ),
});

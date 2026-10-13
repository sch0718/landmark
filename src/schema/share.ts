import { Schema } from 'effect';
import { LABEL_COLORS, type LabelColorName } from 'src/schema/label-colors';
import { IsoDateTime, Lat, Lng } from 'src/schema/common';

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
};
export type ShareDoc = {
  format: 'tripmap-share';
  version: 1;
  title: string;
  createdAt: string;
  labels: ShareLabel[];
  places: SharePlace[];
};

const ShareLabelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.Literals(LABEL_COLORS),
  order: Schema.Finite,
});

const SharePlaceSchema = Schema.Struct({
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

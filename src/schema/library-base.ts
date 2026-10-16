import { Schema } from 'effect';
import { IsoDateTime } from 'src/schema/common';

// library.ts와 trip.ts가 함께 쓰는 기초 정의. 둘이 서로를 import하면 순환이라 따로 둔다.
// 바깥에서는 계속 `src/schema/library`에서 가져다 쓴다(거기서 다시 내보낸다).

export const LIBRARY_LIMITS = {
  memoChars: 10_000,
  /** 한 줄 평의 `String.length` 상한(이모지는 2로 센다). */
  reviewChars: 140,
  labelNameChars: 30,
  /** 직렬화한 JSON의 `String.length` 상한. */
  libraryChars: 4_000_000,
  tripTitleChars: 60,
  tripMaxDays: 30,
  stopNoteChars: 500,
  stayMaxMin: 1440,
  /** 네이버 폴더 이름의 `String.length` 상한. */
  folderNameChars: 100,
  /** 폴더 연결 하나가 기억하는 본 장소(sid)의 최대 개수. */
  folderSids: 1000,
} as const;

export const PlaceId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{10}$/, { message: 'PlaceId는 영숫자 소문자 10자입니다' }),
);
/** 필드 단위 최신값 우선(LWW)을 위한 `{ value, updatedAt }` 묶음. */
export const FieldSchema = <S extends Schema.Constraint>(schema: S) =>
  Schema.Struct({ value: schema, updatedAt: IsoDateTime });

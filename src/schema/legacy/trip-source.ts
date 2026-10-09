import { Effect, Schema } from 'effect';
import { MutableArray, MutableStruct } from 'src/schema/mutable';
import {
  CalendarDate,
  HHmm,
  Lat,
  Lng,
  PublicId,
  StopId,
  checkPeriodAndDays,
  checkUniqueStopIds,
} from 'src/schema/common';

const CustomPlaceSchema = MutableStruct({
  key: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]+$/, { message: 'key는 영숫자·_·-만 쓸 수 있습니다' }),
  ),
  name: Schema.String.check(Schema.isMinLength(1)),
  lng: Lng,
  lat: Lat,
});

const SourceStopSchema = MutableStruct({
  id: Schema.optional(StopId),
  place: Schema.String.check(Schema.isMinLength(1)),
  time: Schema.optional(HHmm),
  note: Schema.optional(Schema.String),
});

const SourceDaySchema = MutableStruct({
  date: CalendarDate,
  stops: MutableArray(SourceStopSchema),
});

export const TripSourceSchema = MutableStruct({
  schemaVersion: Schema.Literal(1).pipe(Schema.withDecodingDefault(Effect.succeed(1 as const))),
  publicId: Schema.optional(PublicId),
  title: Schema.String.check(Schema.isMinLength(1)),
  startDate: CalendarDate,
  endDate: CalendarDate,
  folders: MutableArray(Schema.String.check(Schema.isMinLength(1))),
  // 저장 폴더 없이 네이버 장소 ID(sid)로 장소를 지정한다. collect가 장소 API로 이름·좌표·분류를 가져온다.
  naverPlaces: MutableArray(
    Schema.String.check(Schema.isPattern(/^\d+$/, { message: '네이버 장소 ID는 숫자여야 합니다' })),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  publish: MutableStruct({
    naverMemo: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({ naverMemo: true }))),
  customPlaces: MutableArray(CustomPlaceSchema).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  days: MutableArray(SourceDaySchema),
}).check(
  Schema.makeFilter((trip) => {
    const issues: Schema.FilterIssue[] = [...checkPeriodAndDays(trip)];
    const keys = new Set<string>();
    trip.customPlaces.forEach((p, i) => {
      if (/^\d+$/.test(p.key)) {
        issues.push({
          path: ['customPlaces', i, 'key'],
          issue: '숫자만으로 된 key는 네이버 sid와 구분되지 않습니다',
        });
      }
      if (keys.has(p.key)) {
        issues.push({ path: ['customPlaces', i, 'key'], issue: `key가 중복됩니다: ${p.key}` });
      }
      keys.add(p.key);
    });
    const sids = new Set<string>();
    trip.naverPlaces.forEach((sid, i) => {
      if (sids.has(sid)) {
        issues.push({ path: ['naverPlaces', i], issue: `네이버 장소 ID가 중복됩니다: ${sid}` });
      }
      sids.add(sid);
    });
    issues.push(...checkUniqueStopIds(trip.days));
    return issues;
  }),
);

export type TripSource = typeof TripSourceSchema.Type;

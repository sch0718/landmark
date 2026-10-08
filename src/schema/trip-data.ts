import { Schema } from 'effect';
import {
  CalendarDate,
  HHmm,
  IsoDateTime,
  Lat,
  Lng,
  PlaceKey,
  PublicId,
  StopId,
  checkPeriodAndDays,
  checkUniqueStopIds,
} from 'src/schema/common';
import { MutableArray, MutableRecord, MutableStruct } from 'src/schema/mutable';
import type { ParseOpts } from 'src/schema/parse';

/**
 * Folder·Place·ResetDay는 알 수 없는 키를 거부해야 한다(수집 결과에 shareId 같은 비공개 필드가 새어 나가면
 * validate가 잡는다). Effect는 알 수 없는 키를 기본으로 버리므로, TripDataSchema를 디코드하는
 * 모든 호출부가 이 옵션을 넘긴다.
 */
export const TRIP_DATA_PARSE: ParseOpts = { onExcessProperty: 'error' };

const FolderIdSchema = Schema.String.check(
  Schema.isPattern(/^f\d+$/, { message: 'folderId는 f1, f2 … 형식입니다' }),
);

const FolderSchema = MutableStruct({
  id: FolderIdSchema,
  name: Schema.String,
  count: Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

const PlaceSchema = MutableStruct({
  name: Schema.String,
  address: Schema.String,
  lng: Lng,
  lat: Lat,
  category: Schema.NullOr(Schema.String),
  folderIds: MutableArray(FolderIdSchema),
  savedAt: Schema.NullOr(IsoDateTime),
  sid: Schema.optional(Schema.String),
  naverMemos: Schema.optional(
    MutableArray(MutableStruct({ folderId: FolderIdSchema, memo: Schema.String })),
  ),
});

const StopSchema = MutableStruct({
  id: StopId,
  placeKey: PlaceKey,
  time: Schema.optional(HHmm),
  note: Schema.optional(Schema.String),
});

const LngLat = Schema.mutable(Schema.Tuple([Schema.Finite, Schema.Finite]));

const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const LegSchema = MutableStruct({
  fromStopId: StopId,
  toStopId: StopId,
  fromPlaceKey: PlaceKey,
  toPlaceKey: PlaceKey,
  status: Schema.Literals(['routed', 'failed']),
  distanceM: NonNegative,
  distanceKind: Schema.Literals(['road', 'straight']),
  durationMs: Schema.NullOr(NonNegative),
  staticDurationMs: Schema.NullOr(NonNegative),
  tollFare: Schema.NullOr(NonNegative),
  path: MutableArray(LngLat),
  queriedAt: Schema.NullOr(IsoDateTime),
});

const DaySchema = MutableStruct({
  date: CalendarDate,
  stops: MutableArray(StopSchema),
  legs: MutableArray(LegSchema),
});

export const TripDataSchema = MutableStruct({
  schemaVersion: Schema.Literal(1),
  publicId: PublicId,
  title: Schema.String,
  startDate: CalendarDate,
  endDate: CalendarDate,
  dataVersion: IsoDateTime,
  folders: MutableArray(FolderSchema),
  places: MutableRecord(PlaceKey, PlaceSchema),
  days: MutableArray(DaySchema),
}).check(
  Schema.makeFilter((trip) => {
    const issues: Schema.FilterIssue[] = [
      ...checkPeriodAndDays(trip),
      ...checkUniqueStopIds(trip.days),
    ];
    const add = (path: ReadonlyArray<PropertyKey>, issue: string) => {
      issues.push({ path, issue });
    };

    const folderIds = new Set<string>();
    trip.folders.forEach((f, i) => {
      if (folderIds.has(f.id)) add(['folders', i, 'id'], `folder id가 중복됩니다: ${f.id}`);
      folderIds.add(f.id);
    });

    for (const [key, place] of Object.entries(trip.places)) {
      place.folderIds.forEach((fid, i) => {
        if (!folderIds.has(fid)) add(['places', key, 'folderIds', i], `없는 folderId: ${fid}`);
      });
      place.naverMemos?.forEach((m, i) => {
        if (!folderIds.has(m.folderId)) {
          add(['places', key, 'naverMemos', i, 'folderId'], `없는 folderId: ${m.folderId}`);
        }
      });
    }

    trip.days.forEach((day, di) => {
      day.stops.forEach((stop, si) => {
        if (!(stop.placeKey in trip.places)) {
          add(['days', di, 'stops', si, 'placeKey'], `없는 placeKey: ${stop.placeKey}`);
        }
      });

      const expected = Math.max(0, day.stops.length - 1);
      if (day.legs.length !== expected) {
        add(['days', di, 'legs'], `legs는 ${expected}개여야 하는데 ${day.legs.length}개입니다`);
        return;
      }
      day.legs.forEach((leg, li) => {
        const from = day.stops[li]!;
        const to = day.stops[li + 1]!;
        const at = (field: string) => ['days', di, 'legs', li, field];
        if (leg.fromStopId !== from.id) add(at('fromStopId'), 'fromStopId가 stops와 맞지 않습니다');
        if (leg.toStopId !== to.id) add(at('toStopId'), 'toStopId가 stops와 맞지 않습니다');
        if (leg.fromPlaceKey !== from.placeKey)
          add(at('fromPlaceKey'), 'fromPlaceKey가 stops와 맞지 않습니다');
        if (leg.toPlaceKey !== to.placeKey)
          add(at('toPlaceKey'), 'toPlaceKey가 stops와 맞지 않습니다');

        if (leg.status === 'failed') {
          if (leg.distanceKind !== 'straight')
            add(at('distanceKind'), 'failed 구간은 distanceKind가 straight여야 합니다');
          if (leg.path.length !== 2)
            add(at('path'), 'failed 구간의 path는 두 점(직선)이어야 합니다');
          for (const f of ['durationMs', 'staticDurationMs', 'tollFare', 'queriedAt'] as const) {
            if (leg[f] !== null) add(at(f), `failed 구간의 ${f}는 null이어야 합니다`);
          }
        } else {
          if (leg.distanceKind !== 'road')
            add(at('distanceKind'), 'routed 구간은 distanceKind가 road여야 합니다');
          if (leg.durationMs === null)
            add(at('durationMs'), 'routed 구간은 durationMs가 필요합니다');
          if (leg.queriedAt === null) add(at('queriedAt'), 'routed 구간은 queriedAt이 필요합니다');
        }
      });
    });
    return issues;
  }),
);

export type TripData = typeof TripDataSchema.Type;
export type Place = typeof PlaceSchema.Type;
export type Day = typeof DaySchema.Type;
export type Stop = typeof StopSchema.Type;
export type Leg = typeof LegSchema.Type;

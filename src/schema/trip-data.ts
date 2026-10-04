import { z } from 'zod';
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

const FolderIdSchema = z.string().regex(/^f\d+$/, { message: 'folderId는 f1, f2 … 형식입니다' });

// Folder·Place는 알 수 없는 키를 거부한다: 수집 결과에 shareId 같은 비공개 필드가 새어 나가면
// validate가 잡는다.
const FolderSchema = z.strictObject({
  id: FolderIdSchema,
  name: z.string(),
  count: z.number().int().nonnegative(),
});

const PlaceSchema = z.strictObject({
  name: z.string(),
  address: z.string(),
  lng: Lng,
  lat: Lat,
  category: z.string().nullable(),
  folderIds: z.array(FolderIdSchema),
  savedAt: IsoDateTime.nullable(),
  sid: z.string().optional(),
  naverMemos: z.array(z.object({ folderId: FolderIdSchema, memo: z.string() })).optional(),
});

const StopSchema = z.object({
  id: StopId,
  placeKey: PlaceKey,
  time: HHmm.optional(),
  note: z.string().optional(),
});

const LngLat = z.tuple([z.number(), z.number()]);

const LegSchema = z.object({
  fromStopId: StopId,
  toStopId: StopId,
  fromPlaceKey: PlaceKey,
  toPlaceKey: PlaceKey,
  status: z.enum(['routed', 'failed']),
  distanceM: z.number().nonnegative(),
  distanceKind: z.enum(['road', 'straight']),
  durationMs: z.number().nonnegative().nullable(),
  staticDurationMs: z.number().nonnegative().nullable(),
  tollFare: z.number().nonnegative().nullable(),
  path: z.array(LngLat),
  queriedAt: IsoDateTime.nullable(),
});

const DaySchema = z.object({
  date: CalendarDate,
  stops: z.array(StopSchema),
  legs: z.array(LegSchema),
});

export const TripDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicId: PublicId,
    title: z.string(),
    startDate: CalendarDate,
    endDate: CalendarDate,
    dataVersion: IsoDateTime,
    folders: z.array(FolderSchema),
    places: z.record(PlaceKey, PlaceSchema),
    days: z.array(DaySchema),
  })
  .superRefine((trip, ctx) => {
    checkPeriodAndDays(ctx, trip);
    checkUniqueStopIds(ctx, trip.days);

    const folderIds = new Set<string>();
    trip.folders.forEach((f, i) => {
      if (folderIds.has(f.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `folder id가 중복됩니다: ${f.id}`,
          path: ['folders', i, 'id'],
        });
      }
      folderIds.add(f.id);
    });

    for (const [key, place] of Object.entries(trip.places)) {
      place.folderIds.forEach((fid, i) => {
        if (!folderIds.has(fid)) {
          ctx.addIssue({
            code: 'custom',
            message: `없는 folderId: ${fid}`,
            path: ['places', key, 'folderIds', i],
          });
        }
      });
      place.naverMemos?.forEach((m, i) => {
        if (!folderIds.has(m.folderId)) {
          ctx.addIssue({
            code: 'custom',
            message: `없는 folderId: ${m.folderId}`,
            path: ['places', key, 'naverMemos', i, 'folderId'],
          });
        }
      });
    }

    trip.days.forEach((day, di) => {
      day.stops.forEach((stop, si) => {
        if (!(stop.placeKey in trip.places)) {
          ctx.addIssue({
            code: 'custom',
            message: `없는 placeKey: ${stop.placeKey}`,
            path: ['days', di, 'stops', si, 'placeKey'],
          });
        }
      });

      const expected = Math.max(0, day.stops.length - 1);
      if (day.legs.length !== expected) {
        ctx.addIssue({
          code: 'custom',
          message: `legs는 ${expected}개여야 하는데 ${day.legs.length}개입니다`,
          path: ['days', di, 'legs'],
        });
        return;
      }
      day.legs.forEach((leg, li) => {
        const from = day.stops[li]!;
        const to = day.stops[li + 1]!;
        const at = (field: string) => ['days', di, 'legs', li, field];
        if (leg.fromStopId !== from.id)
          ctx.addIssue({
            code: 'custom',
            message: 'fromStopId가 stops와 맞지 않습니다',
            path: at('fromStopId'),
          });
        if (leg.toStopId !== to.id)
          ctx.addIssue({
            code: 'custom',
            message: 'toStopId가 stops와 맞지 않습니다',
            path: at('toStopId'),
          });
        if (leg.fromPlaceKey !== from.placeKey)
          ctx.addIssue({
            code: 'custom',
            message: 'fromPlaceKey가 stops와 맞지 않습니다',
            path: at('fromPlaceKey'),
          });
        if (leg.toPlaceKey !== to.placeKey)
          ctx.addIssue({
            code: 'custom',
            message: 'toPlaceKey가 stops와 맞지 않습니다',
            path: at('toPlaceKey'),
          });

        if (leg.status === 'failed') {
          if (leg.distanceKind !== 'straight')
            ctx.addIssue({
              code: 'custom',
              message: 'failed 구간은 distanceKind가 straight여야 합니다',
              path: at('distanceKind'),
            });
          if (leg.path.length !== 2)
            ctx.addIssue({
              code: 'custom',
              message: 'failed 구간의 path는 두 점(직선)이어야 합니다',
              path: at('path'),
            });
          for (const f of ['durationMs', 'staticDurationMs', 'tollFare', 'queriedAt'] as const) {
            if (leg[f] !== null)
              ctx.addIssue({
                code: 'custom',
                message: `failed 구간의 ${f}는 null이어야 합니다`,
                path: at(f),
              });
          }
        } else {
          if (leg.distanceKind !== 'road')
            ctx.addIssue({
              code: 'custom',
              message: 'routed 구간은 distanceKind가 road여야 합니다',
              path: at('distanceKind'),
            });
          if (leg.durationMs === null)
            ctx.addIssue({
              code: 'custom',
              message: 'routed 구간은 durationMs가 필요합니다',
              path: at('durationMs'),
            });
          if (leg.queriedAt === null)
            ctx.addIssue({
              code: 'custom',
              message: 'routed 구간은 queriedAt이 필요합니다',
              path: at('queriedAt'),
            });
        }
      });
    });
  });

export type TripData = z.infer<typeof TripDataSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Stop = z.infer<typeof StopSchema>;
export type Leg = z.infer<typeof LegSchema>;

import { z } from 'zod';
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

const CustomPlaceSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]+$/, { message: 'key는 영숫자·_·-만 쓸 수 있습니다' }),
  name: z.string().min(1),
  lng: Lng,
  lat: Lat,
});

const SourceStopSchema = z.object({
  id: StopId.optional(),
  place: z.string().min(1),
  time: HHmm.optional(),
  note: z.string().optional(),
});

const SourceDaySchema = z.object({
  date: CalendarDate,
  stops: z.array(SourceStopSchema),
});

export const TripSourceSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    publicId: PublicId.optional(),
    title: z.string().min(1),
    startDate: CalendarDate,
    endDate: CalendarDate,
    folders: z.array(z.string().min(1)),
    // 저장 폴더 없이 네이버 장소 ID(sid)로 장소를 지정한다. collect가 장소 API로 이름·좌표·분류를 가져온다.
    naverPlaces: z
      .array(z.string().regex(/^\d+$/, { message: '네이버 장소 ID는 숫자여야 합니다' }))
      .default([]),
    publish: z.object({ naverMemo: z.boolean().default(true) }).default({ naverMemo: true }),
    customPlaces: z.array(CustomPlaceSchema).default([]),
    days: z.array(SourceDaySchema),
  })
  .superRefine((trip, ctx) => {
    checkPeriodAndDays(ctx, trip);
    const keys = new Set<string>();
    trip.customPlaces.forEach((p, i) => {
      if (/^\d+$/.test(p.key)) {
        ctx.addIssue({
          code: 'custom',
          message: '숫자만으로 된 key는 네이버 sid와 구분되지 않습니다',
          path: ['customPlaces', i, 'key'],
        });
      }
      if (keys.has(p.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `key가 중복됩니다: ${p.key}`,
          path: ['customPlaces', i, 'key'],
        });
      }
      keys.add(p.key);
    });
    const sids = new Set<string>();
    trip.naverPlaces.forEach((sid, i) => {
      if (sids.has(sid)) {
        ctx.addIssue({
          code: 'custom',
          message: `네이버 장소 ID가 중복됩니다: ${sid}`,
          path: ['naverPlaces', i],
        });
      }
      sids.add(sid);
    });
    checkUniqueStopIds(ctx, trip.days);
  });

export type TripSource = z.infer<typeof TripSourceSchema>;

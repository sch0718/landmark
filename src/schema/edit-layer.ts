import { z } from 'zod';
import {
  CalendarDate,
  HHmm,
  IsoDateTime,
  LIMITS,
  PlaceKey,
  PublicId,
  StopId,
} from 'src/schema/common';

const MemoSchema = z.object({
  text: z.string().max(LIMITS.memoChars).nullable(),
  updatedAt: IsoDateTime,
});

const PlaceEditSchema = z.object({
  memos: z.record(z.string(), MemoSchema),
  tags: z
    .object({
      value: z.array(z.string().max(LIMITS.tagChars)).max(LIMITS.tagsPerPlace),
      updatedAt: IsoDateTime,
    })
    .optional(),
  hidden: z.object({ value: z.boolean(), updatedAt: IsoDateTime }).optional(),
});

const EditStopSchema = z.object({
  id: StopId,
  placeKey: PlaceKey,
  time: HHmm.optional(),
  note: z.string().optional(),
});

const OverrideDaySchema = z.object({
  mode: z.literal('override'),
  stops: z.array(EditStopSchema).max(LIMITS.stopsPerDay),
  baseDayHash: z.string(),
  updatedAt: IsoDateTime,
});

const ResetDaySchema = z.strictObject({
  mode: z.literal('reset'),
  updatedAt: IsoDateTime,
});

const DayEditSchema = z.discriminatedUnion('mode', [OverrideDaySchema, ResetDaySchema]);

export const EditLayerSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicId: PublicId,
    baseDataVersion: IsoDateTime,
    authorId: z.string().min(1),
    authors: z.record(z.string(), z.object({ nickname: z.string(), updatedAt: IsoDateTime })),
    places: z.record(PlaceKey, PlaceEditSchema),
    days: z.record(CalendarDate, DayEditSchema),
  })
  .superRefine((layer, ctx) => {
    if (Object.keys(layer.authors).length > LIMITS.authors) {
      ctx.addIssue({
        code: 'custom',
        message: `authors는 ${LIMITS.authors}명까지입니다`,
        path: ['authors'],
      });
    }
    for (const [key, place] of Object.entries(layer.places)) {
      for (const authorId of Object.keys(place.memos)) {
        if (!(authorId in layer.authors)) {
          ctx.addIssue({
            code: 'custom',
            message: `authors에 없는 작성자의 메모입니다: ${authorId}`,
            path: ['places', key, 'memos', authorId],
          });
        }
      }
    }
    for (const [date, day] of Object.entries(layer.days)) {
      if (day.mode !== 'override') continue;
      const seen = new Set<string>();
      day.stops.forEach((stop, i) => {
        if (seen.has(stop.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `stop id가 중복됩니다: ${stop.id}`,
            path: ['days', date, 'stops', i, 'id'],
          });
        }
        seen.add(stop.id);
      });
    }
  });

export type EditLayer = z.infer<typeof EditLayerSchema>;
export type PlaceEdit = z.infer<typeof PlaceEditSchema>;
export type DayEdit = z.infer<typeof DayEditSchema>;

/** 내보내기 파일(`.tripedit.json`)의 내용. 가져오기의 파일 크기 제한은 이 직렬화 기준이다. */
export function serializeEditLayerFile(edit: EditLayer): string {
  return JSON.stringify(edit, null, 2);
}

/**
 * 내보내기 파일로 썼을 때의 UTF-8 바이트 수. 들여쓴 파일이 압축 링크·저장소의 압축 없는 JSON보다
 * 크므로, 이 값이 제한 안이면 모든 내보내기 경로가 받는 쪽의 크기 제한을 통과한다.
 */
export function editLayerByteLength(edit: EditLayer): number {
  return new TextEncoder().encode(serializeEditLayerFile(edit)).length;
}

export const EDIT_LAYER_TOO_LARGE = '편집 데이터가 1MB를 넘어 저장할 수 없어요';
export const MERGE_RESULT_TOO_LARGE = '병합 결과가 1MB를 넘어 저장할 수 없어요';

/** 내보낼 수 없는(가져오기에서 too-large가 되는) 크기면 true. */
export function isEditLayerTooLarge(edit: EditLayer): boolean {
  return editLayerByteLength(edit) > LIMITS.fileBytes;
}

/** 크기 제한(§5.3)을 넘으면 throw한다. */
export function assertEditLayerSize(edit: EditLayer, message = EDIT_LAYER_TOO_LARGE): void {
  if (isEditLayerTooLarge(edit)) throw new Error(message);
}

export function newEditLayer(args: {
  publicId: string;
  baseDataVersion: string;
  authorId: string;
  nickname: string;
  now: string;
}): EditLayer {
  return {
    schemaVersion: 1,
    publicId: args.publicId,
    baseDataVersion: args.baseDataVersion,
    authorId: args.authorId,
    authors: { [args.authorId]: { nickname: args.nickname, updatedAt: args.now } },
    places: {},
    days: {},
  };
}

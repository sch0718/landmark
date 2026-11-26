import { Schema } from 'effect';
import {
  CalendarDate,
  HHmm,
  IsoDateTime,
  LIMITS,
  PlaceKey,
  PublicId,
  StopId,
} from 'src/schema/common';
import { MutableArray, MutableRecord, MutableStruct } from 'src/schema/mutable';
import type { ParseOpts } from 'src/schema/parse';

/**
 * ResetDay는 알 수 없는 키를 거부해야 한다. Effect는 알 수 없는 키를 기본으로 버리므로,
 * EditLayerSchema를 디코드하는 모든 호출부가 이 옵션을 넘긴다.
 */
export const EDIT_LAYER_PARSE: ParseOpts = { onExcessProperty: 'error' };

const MemoSchema = MutableStruct({
  text: Schema.NullOr(Schema.String.check(Schema.isMaxLength(LIMITS.memoChars))),
  updatedAt: IsoDateTime,
});

const PlaceEditSchema = MutableStruct({
  memos: MutableRecord(Schema.String, MemoSchema),
  tags: Schema.optional(
    MutableStruct({
      value: MutableArray(Schema.String.check(Schema.isMaxLength(LIMITS.tagChars))).check(
        Schema.isMaxLength(LIMITS.tagsPerPlace),
      ),
      updatedAt: IsoDateTime,
    }),
  ),
  hidden: Schema.optional(MutableStruct({ value: Schema.Boolean, updatedAt: IsoDateTime })),
  /** 원본 분류 덮어쓰기. `value: null`은 원본으로 되돌림(병합에서 옛 값이 되살아나지 않게 기록한다). */
  category: Schema.optional(
    MutableStruct({
      value: Schema.NullOr(
        Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(LIMITS.categoryChars)),
      ),
      updatedAt: IsoDateTime,
    }),
  ),
});

const EditStopSchema = MutableStruct({
  id: StopId,
  placeKey: PlaceKey,
  time: Schema.optional(HHmm),
  note: Schema.optional(Schema.String),
});

const OverrideDaySchema = MutableStruct({
  mode: Schema.Literal('override'),
  stops: MutableArray(EditStopSchema).check(Schema.isMaxLength(LIMITS.stopsPerDay)),
  baseDayHash: Schema.String,
  updatedAt: IsoDateTime,
});

const ResetDaySchema = MutableStruct({
  mode: Schema.Literal('reset'),
  updatedAt: IsoDateTime,
});

const DayEditSchema = Schema.Union([OverrideDaySchema, ResetDaySchema]);

export const EditLayerSchema = MutableStruct({
  schemaVersion: Schema.Literal(1),
  publicId: PublicId,
  baseDataVersion: IsoDateTime,
  authorId: Schema.String.check(Schema.isMinLength(1)),
  authors: MutableRecord(
    Schema.String,
    MutableStruct({ nickname: Schema.String, updatedAt: IsoDateTime }),
  ),
  places: MutableRecord(PlaceKey, PlaceEditSchema),
  days: MutableRecord(CalendarDate, DayEditSchema),
}).check(
  Schema.makeFilter((layer) => {
    const issues: Schema.FilterIssue[] = [];
    if (Object.keys(layer.authors).length > LIMITS.authors) {
      issues.push({ path: ['authors'], issue: `authors는 ${LIMITS.authors}명까지입니다` });
    }
    for (const [key, place] of Object.entries(layer.places)) {
      for (const authorId of Object.keys(place.memos)) {
        if (!(authorId in layer.authors)) {
          issues.push({
            path: ['places', key, 'memos', authorId],
            issue: `authors에 없는 작성자의 메모입니다: ${authorId}`,
          });
        }
      }
    }
    for (const [date, day] of Object.entries(layer.days)) {
      if (day.mode !== 'override') continue;
      const seen = new Set<string>();
      day.stops.forEach((stop, i) => {
        if (seen.has(stop.id)) {
          issues.push({
            path: ['days', date, 'stops', i, 'id'],
            issue: `stop id가 중복됩니다: ${stop.id}`,
          });
        }
        seen.add(stop.id);
      });
    }
    return issues;
  }),
);

export type EditLayer = typeof EditLayerSchema.Type;
export type PlaceEdit = typeof PlaceEditSchema.Type;
export type DayEdit = typeof DayEditSchema.Type;

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { z } from 'zod';

dayjs.extend(customParseFormat);

export const LIMITS = {
  linkChars: 16000,
  fileBytes: 1048576,
  decodedBytes: 1048576,
  memoChars: 2000,
  tagsPerPlace: 20,
  tagChars: 30,
  stopsPerDay: 50,
  authors: 50,
  exportLinkWarnChars: 8000,
} as const;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** `Date.prototype.toISOString()` 형식(UTC, `Z`)만 허용한다. */
export const IsoDateTime = z.string().refine(
  (s) => {
    if (!ISO_RE.test(s)) return false;
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && d.toISOString() === s;
  },
  { message: 'UTC ISO 시각(YYYY-MM-DDTHH:mm:ss.sssZ)이어야 합니다' },
);

/** `YYYY-MM-DD`이며 실제 달력 날짜. */
export const CalendarDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s, 'YYYY-MM-DD', true).isValid(), {
    message: '실제 달력 날짜(YYYY-MM-DD)여야 합니다',
  });

export const HHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다' });

export const Lng = z.number().min(124.0).max(132.0);
export const Lat = z.number().min(33.0).max(39.0);

export const PlaceKey = z
  .string()
  .regex(/^(n:\d+|c:[A-Za-z0-9_-]+)$/, { message: 'PlaceKey 형식이 아닙니다' });
export const StopId = z
  .string()
  .regex(/^[a-z0-9]{4,}$/, { message: 'StopId는 영숫자 소문자 4자 이상입니다' });
export const PublicId = z
  .string()
  .regex(/^[a-z0-9]{10,}$/, { message: 'publicId는 영숫자 소문자 10자 이상입니다' });

/** TripSource·TripData 공통 관계 검증: 기간 순서, days[].date의 기간 내·중복 없음. */
export function checkPeriodAndDays(
  ctx: z.RefinementCtx,
  trip: { startDate: string; endDate: string; days: { date: string }[] },
): void {
  if (trip.startDate > trip.endDate) {
    ctx.addIssue({ code: 'custom', message: '시작일이 종료일보다 늦습니다', path: ['startDate'] });
  }
  const seen = new Set<string>();
  trip.days.forEach((day, i) => {
    if (day.date < trip.startDate || day.date > trip.endDate) {
      ctx.addIssue({
        code: 'custom',
        message: '여행 기간 밖의 날짜입니다',
        path: ['days', i, 'date'],
      });
    }
    if (seen.has(day.date)) {
      ctx.addIssue({ code: 'custom', message: '날짜가 중복됩니다', path: ['days', i, 'date'] });
    }
    seen.add(day.date);
  });
}

/** 여행 전체에서 stop.id가 유일한지 검사한다(id가 없는 stop은 건너뛴다). */
export function checkUniqueStopIds(
  ctx: z.RefinementCtx,
  days: { stops: { id?: string | undefined }[] }[],
): void {
  const seen = new Set<string>();
  days.forEach((day, di) => {
    day.stops.forEach((stop, si) => {
      if (stop.id === undefined) return;
      if (seen.has(stop.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `stop id가 중복됩니다: ${stop.id}`,
          path: ['days', di, 'stops', si, 'id'],
        });
      }
      seen.add(stop.id);
    });
  });
}

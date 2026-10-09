import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { Schema } from 'effect';

dayjs.extend(customParseFormat);

export const LIMITS = {
  linkChars: 16000,
  fileBytes: 1048576,
  decodedBytes: 1048576,
  memoChars: 2000,
  tagsPerPlace: 20,
  tagChars: 30,
  categoryChars: 30,
  stopsPerDay: 50,
  authors: 50,
  exportLinkWarnChars: 8000,
} as const;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** `Date.prototype.toISOString()` 형식(UTC, `Z`)만 허용한다. */
export const IsoDateTime = Schema.String.check(
  Schema.makeFilter(
    (s: string) => {
      if (!ISO_RE.test(s)) return false;
      const d = new Date(s);
      return !Number.isNaN(d.getTime()) && d.toISOString() === s;
    },
    { message: 'UTC ISO 시각(YYYY-MM-DDTHH:mm:ss.sssZ)이어야 합니다' },
  ),
);

/** `YYYY-MM-DD`이며 실제 달력 날짜. */
export const CalendarDate = Schema.String.check(
  Schema.makeFilter(
    (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dayjs(s, 'YYYY-MM-DD', true).isValid(),
    { message: '실제 달력 날짜(YYYY-MM-DD)여야 합니다' },
  ),
);

export const HHmm = Schema.String.check(
  Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'HH:mm 형식이어야 합니다' }),
);

export const Lng = Schema.Finite.check(Schema.isBetween({ minimum: 124.0, maximum: 132.0 }));
export const Lat = Schema.Finite.check(Schema.isBetween({ minimum: 33.0, maximum: 39.0 }));

export const PlaceKey = Schema.String.check(
  Schema.isPattern(/^(n:\d+|c:[A-Za-z0-9_-]+)$/, { message: 'PlaceKey 형식이 아닙니다' }),
);
export const StopId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{4,}$/, { message: 'StopId는 영숫자 소문자 4자 이상입니다' }),
);
export const PublicId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]{10,}$/, { message: 'publicId는 영숫자 소문자 10자 이상입니다' }),
);

/** TripSource·TripData 공통 관계 검증: 기간 순서, days[].date의 기간 내·중복 없음. */
export function checkPeriodAndDays(trip: {
  startDate: string;
  endDate: string;
  days: ReadonlyArray<{ date: string }>;
}): Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  if (trip.startDate > trip.endDate) {
    issues.push({ path: ['startDate'], issue: '시작일이 종료일보다 늦습니다' });
  }
  const seen = new Set<string>();
  trip.days.forEach((day, i) => {
    if (day.date < trip.startDate || day.date > trip.endDate) {
      issues.push({ path: ['days', i, 'date'], issue: '여행 기간 밖의 날짜입니다' });
    }
    if (seen.has(day.date)) {
      issues.push({ path: ['days', i, 'date'], issue: '날짜가 중복됩니다' });
    }
    seen.add(day.date);
  });
  return issues;
}

/** 여행 전체에서 stop.id가 유일한지 검사한다(id가 없는 stop은 건너뛴다). */
export function checkUniqueStopIds(
  days: ReadonlyArray<{ stops: ReadonlyArray<{ id?: string | undefined }> }>,
): Schema.FilterIssue[] {
  const issues: Schema.FilterIssue[] = [];
  const seen = new Set<string>();
  days.forEach((day, di) => {
    day.stops.forEach((stop, si) => {
      if (stop.id === undefined) return;
      if (seen.has(stop.id)) {
        issues.push({
          path: ['days', di, 'stops', si, 'id'],
          issue: `stop id가 중복됩니다: ${stop.id}`,
        });
      }
      seen.add(stop.id);
    });
  });
  return issues;
}

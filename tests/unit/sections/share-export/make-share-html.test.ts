import { describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import type { ShareLegTime } from 'src/domain/share/build-trip-share';
import { readShareHtml, SHARE_IMPORT_LIMITS } from 'src/domain/share/read-share';
import { emptyLibrary, type Library } from 'src/schema/library';
import {
  renderShareHtml,
  renderTripShareHtml,
  SHARE_FILE_MAX_BYTES,
  shareHtmlBytes,
} from 'src/sections/share-export/make-share-html';
import { ShareDocInvalid } from 'src/services/errors';
import { makePlace, sampleLibrary, T0 } from '../library/fixtures';

const TEMPLATE = `<html><script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script></html>`;
const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const opts = { title: '정자역 카페', includeMemo: true, now: new Date(2026, 9, 11, 12) };

// 틀을 받지 못하는 경우는 tests/unit/services/share-template.test.ts가 다룬다.
describe('renderShareHtml', () => {
  it('injects the data block and names the file, synchronously from a template string', () => {
    const result = Result.getOrThrow(
      renderShareHtml(TEMPLATE, sampleLibrary(), [id(1), id(2)], opts),
    );
    expect(result.fileName).toBe('정자역-카페-20261011.html');
    expect(result.count).toBe(2);
    expect(result.html).not.toContain(SHARE_DATA_PLACEHOLDER);
    const m = /<script type="application\/json" id="tripmap-share">(.*)<\/script>/s.exec(
      result.html,
    );
    const doc = JSON.parse(m![1]!) as { format: string; title: string; places: unknown[] };
    expect(doc.format).toBe('tripmap-share');
    expect(doc.title).toBe('정자역 카페');
    expect(doc.places).toHaveLength(2);
  });

  it('succeeds with zero places (count 0)', () => {
    const result = Result.getOrThrow(renderShareHtml(TEMPLATE, sampleLibrary(), [], opts));
    expect(result.count).toBe(0);
    expect(result.html).toContain('"places":[]');
  });

  it('drops unknown ids from the count', () => {
    const result = Result.getOrThrow(
      renderShareHtml(TEMPLATE, sampleLibrary(), [id(1), 'zzzzzzzzzz'], opts),
    );
    expect(result.count).toBe(1);
  });

  it('returns ShareDocInvalid as a failure when the doc breaks the schema', () => {
    // createdAt 형식이 맞지 않는 now는 만들 수 없으므로, 잘못된 좌표를 가진 장소로 검증 실패를 만든다.
    const lib = sampleLibrary();
    const broken = {
      ...lib,
      places: { ...lib.places, [id(1)]: { ...lib.places[id(1)]!, lng: 999 } },
    };
    const result = renderShareHtml(TEMPLATE, broken, [id(1)], opts);
    if (!Result.isFailure(result)) throw new Error('검증 실패를 기대했어요');
    const err = result.failure;
    expect(err).toBeInstanceOf(ShareDocInvalid);
    expect(err.message).not.toBe('');
    expect(err.userMessage).toBe(
      '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요',
    );
  });
});

describe('renderTripShareHtml', () => {
  const f = <V>(value: V) => ({ value, updatedAt: T0 });
  const tripOpts = { ...opts, includeCandidates: true };
  const routeOf = (): ShareLegTime => ({
    durationS: 300,
    distanceM: 1000,
    tollFare: null,
    status: 'estimated',
    queriedAt: null,
    path: [],
  });
  const INJECT = '</script><script>window.__injected = 1</script>';

  function tripLib(
    over: { title?: string; note?: string; memo?: string; deleted?: boolean } = {},
  ): Library {
    const places = [1, 2, 3].map((n) =>
      n === 2 && over.memo !== undefined ? makePlace(n, { memo: over.memo }) : makePlace(n),
    );
    return {
      ...emptyLibrary(),
      places: Object.fromEntries(places.map((p) => [p.id, p])),
      trips: {
        trip000001: {
          id: 'trip000001',
          title: f(over.title ?? '강릉'),
          startDate: f('2026-10-24'),
          endDate: f('2026-10-24'),
          origin: f<string | null>(id(1)),
          candidates: f<string[]>([id(3)]),
          days: [
            {
              stops: f([
                {
                  id: 'stop0001',
                  placeId: id(2),
                  stayMin: 60,
                  fixedTime: null,
                  note: over.note ?? '',
                },
              ]),
              lodging: f<string | null>(null),
              startTime: f('09:00'),
            },
          ],
          legModes: f<Record<string, 'car' | 'walk'>>({}),
          createdAt: T0,
          deletedAt: over.deleted ? T0 : null,
        },
      },
    };
  }

  it('renders a readable v2 file with count and file name', () => {
    const result = Result.getOrThrow(
      renderTripShareHtml(TEMPLATE, tripLib(), 'trip000001', routeOf, tripOpts),
    );
    expect(result.count).toBe(3);
    expect(result.fileName).toBe('정자역-카페-20261011.html');
    const read = readShareHtml(result.html);
    expect(read.ok && read.doc.version).toBe(2);
  });

  it('fails with ShareDocInvalid for a deleted or missing trip', () => {
    for (const [lib, tripId] of [
      [tripLib({ deleted: true }), 'trip000001'],
      [tripLib(), 'trip999999'],
    ] as const) {
      const result = renderTripShareHtml(TEMPLATE, lib, tripId, routeOf, tripOpts);
      if (!Result.isFailure(result)) throw new Error('실패를 기대했어요');
      expect(result.failure).toBeInstanceOf(ShareDocInvalid);
      expect(result.failure.message).toBe('여행을 찾지 못했어요');
    }
  });

  it('fails with ShareDocInvalid when a relation check fails', () => {
    // 출발지·후보·Stop이 모두 비면 장소가 하나도 없는 문서가 된다
    const lib = tripLib();
    const empty: Library = {
      ...lib,
      trips: {
        trip000001: {
          ...lib.trips['trip000001']!,
          origin: f<string | null>(null),
          candidates: f<string[]>([]),
          days: [{ ...lib.trips['trip000001']!.days[0]!, stops: f([]) }],
        },
      },
    };
    const result = renderTripShareHtml(TEMPLATE, empty, 'trip000001', routeOf, tripOpts);
    if (!Result.isFailure(result)) throw new Error('실패를 기대했어요');
    expect(result.failure).toBeInstanceOf(ShareDocInvalid);
  });

  it('keeps injected </script> out of the data block and round-trips through readShareHtml', () => {
    const lib = tripLib({ title: INJECT, note: INJECT });
    const result = Result.getOrThrow(
      renderTripShareHtml(TEMPLATE, lib, 'trip000001', routeOf, tripOpts),
    );
    const m = /<script type="application\/json" id="tripmap-share">(.*?)<\/script>/s.exec(
      result.html,
    );
    expect(m![1]).not.toContain('<');
    expect(result.html.split('</script>')).toHaveLength(2);
    const read = readShareHtml(result.html);
    if (!read.ok || read.doc.version !== 2) throw new Error('v2 문서를 기대했어요');
    expect(read.doc.trips[0]!.title).toBe(INJECT);
    expect(read.doc.trips[0]!.days[0]!.stops[0]!.note).toBe(INJECT);
  });
});

describe('shareHtmlBytes', () => {
  it('counts UTF-8 bytes', () => {
    expect(shareHtmlBytes('a')).toBe(1);
    expect(shareHtmlBytes('가')).toBe(3);
    expect(shareHtmlBytes('😀')).toBe(4);
  });

  it('matches File size for a file with a 10,000-char Korean memo', () => {
    const lib = sampleLibrary();
    const place = lib.places[id(1)]!;
    const big: Library = {
      ...lib,
      places: {
        ...lib.places,
        [id(1)]: { ...place, memo: { ...place.memo, value: '가'.repeat(10_000) } },
      },
    };
    const { html } = Result.getOrThrow(renderShareHtml(TEMPLATE, big, [id(1)], opts));
    expect(shareHtmlBytes(html)).toBe(new File([html], 'x.html').size);
    expect(shareHtmlBytes(html)).toBeGreaterThan(30_000);
  });

  it('limits to the import file limit', () => {
    expect(SHARE_FILE_MAX_BYTES).toBe(SHARE_IMPORT_LIMITS.fileBytes);
    expect(SHARE_FILE_MAX_BYTES).toBe(5_242_880);
  });
});

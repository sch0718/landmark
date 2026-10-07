import { dirname, join } from 'node:path';
import { parseDocument, type Document } from 'yaml';
import { TripDataSchema, type TripData } from 'src/schema/trip-data';
import { TripSourceSchema, type TripSource } from 'src/schema/trip-source';
import { dayTotals } from 'src/domain/day-totals';
import { buildPlaces, folderSids } from './build-places';
import type { FsPort } from './fs-port';
import { ensureIds } from './ids';
import { buildLegs, type FailedLeg } from './legs';
import {
  fetchCarRoute,
  fetchFolder,
  fetchPlaceSummary,
  type FetchedFolder,
  type HttpDeps,
  type NaverPlace,
} from './naver-client';
import { resolveStops } from './resolve-stops';
import type { RouteCache } from './route-cache';

export type CollectDeps = {
  fs: FsPort;
  http: HttpDeps;
  cache: RouteCache;
  random: (len: number) => string;
  now: () => string;
  log: (line: string) => void;
};

export type CollectSummary = {
  folders: { name: string; count: number }[];
  excludedUnavailable: number;
  excludedOutOfRange: { sid: string; name: string }[];
  days: {
    date: string;
    stops: number;
    durationMs: number;
    roadDistanceM: number;
    tollFare: number;
    uncomputedCount: number;
    straightDistanceM: number;
    failed: FailedLeg[];
  }[];
};

export class SourceValidationError extends Error {
  issues: { path: string; message: string }[];
  constructor(file: string, issues: { path: string; message: string }[]) {
    super(
      `${file} 검증 실패:\n${issues
        .slice(0, 10)
        .map((i) => `  ${i.path || '(루트)'}: ${i.message}`)
        .join('\n')}`,
    );
    this.name = 'SourceValidationError';
    this.issues = issues;
  }
}

/** yaml 텍스트를 Document로 읽고 `TripSource`로 검증한다. 실패하면 SourceValidationError. */
export function parseSource(text: string, file: string): { doc: Document; source: TripSource } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new SourceValidationError(
      file,
      doc.errors.map((e) => ({ path: '', message: e.message })),
    );
  }
  const parsed = TripSourceSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new SourceValidationError(
      file,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return { doc, source: parsed.data };
}

/**
 * trips/<trip>.yaml → public/data/<publicId>.json (§7.1).
 * 출력 경로는 yaml이 있는 저장소 루트(= yaml 디렉터리의 부모) 기준 `public/data/`이다.
 */
export async function collect(
  yamlPath: string,
  opts: { refreshRoutes: boolean },
  deps: CollectDeps,
): Promise<{ publicId: string; outPath: string; summary: CollectSummary }> {
  const text = await deps.fs.readText(yamlPath);
  // ensureIds 전에 검증해서 잘못된 id가 덮어써지지 않고 실패하게 한다.
  const first = parseSource(text, yamlPath);
  const { changed } = ensureIds(first.doc, deps.random);
  let source = first.source;
  if (changed) {
    await deps.fs.writeTextAtomic(yamlPath, first.doc.toString());
    source = parseSource(await deps.fs.readText(yamlPath), yamlPath).source;
  }
  const publicId = source.publicId;
  if (publicId === undefined) throw new Error('publicId를 만들지 못했습니다');

  const fetched: FetchedFolder[] = [];
  for (const [i, shareId] of source.folders.entries()) {
    if (i > 0) await deps.http.sleep(300);
    try {
      fetched.push(await fetchFolder(shareId, deps.http));
    } catch (e) {
      throw new Error(
        `네이버 폴더를 가져오지 못했습니다 (shareId=${shareId}): ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }

  // 폴더에 이미 있는 sid는 buildPlaces가 폴더 쪽을 쓰므로 조회하지 않는다.
  const inFolders = folderSids(fetched);
  const naverPlaces: NaverPlace[] = [];
  for (const sid of source.naverPlaces.filter((id) => !inFolders.has(id))) {
    if (naverPlaces.length > 0 || fetched.length > 0) await deps.http.sleep(300);
    try {
      naverPlaces.push(await fetchPlaceSummary(sid, deps.http));
    } catch (e) {
      throw new Error(
        `네이버 장소를 가져오지 못했습니다 (장소 ID=${sid}): ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }

  const now = deps.now();
  const built = buildPlaces(source, fetched, naverPlaces);
  const resolved = resolveStops(source, built.places);
  const { days, failed } = await buildLegs(resolved, built.places, {
    cache: deps.cache,
    fetchRoute: async (s, g) => {
      await deps.http.sleep(300);
      return fetchCarRoute(s, g, deps.http);
    },
    refresh: opts.refreshRoutes,
    now,
  });

  const data: TripData = TripDataSchema.parse({
    schemaVersion: 1,
    publicId,
    title: source.title,
    startDate: source.startDate,
    endDate: source.endDate,
    dataVersion: now,
    folders: built.folders,
    places: built.places,
    days,
  });

  const outPath = join(dirname(dirname(yamlPath)), 'public', 'data', `${publicId}.json`);
  await deps.fs.writeTextAtomic(outPath, JSON.stringify(data));

  const summary: CollectSummary = {
    folders: built.folders.map((f) => ({ name: f.name, count: f.count })),
    excludedUnavailable: built.report.excludedUnavailable,
    excludedOutOfRange: built.report.excludedOutOfRange,
    days: data.days.map((d) => ({
      date: d.date,
      stops: d.stops.length,
      ...dayTotals(d.legs),
      failed: failed.filter((f) => f.date === d.date),
    })),
  };
  logSummary(summary, outPath, deps.log);
  return { publicId, outPath, summary };
}

function logSummary(s: CollectSummary, outPath: string, log: (line: string) => void): void {
  log(`생성: ${outPath}`);
  for (const f of s.folders) log(`폴더 "${f.name}": 장소 ${f.count}곳`);
  log(`제외: 사용 불가 ${s.excludedUnavailable}곳, 좌표 범위 밖 ${s.excludedOutOfRange.length}곳`);
  for (const o of s.excludedOutOfRange) log(`  범위 밖: ${o.name} (${o.sid})`);
  for (const d of s.days) {
    const uncomputed =
      d.uncomputedCount > 0
        ? ` · 미계산 ${d.uncomputedCount}구간(직선 ${(d.straightDistanceM / 1000).toFixed(1)}km)`
        : '';
    log(
      `${d.date}: 장소 ${d.stops}곳, ${(d.roadDistanceM / 1000).toFixed(1)}km, ${Math.round(d.durationMs / 60000)}분, 통행료 ${d.tollFare}원${uncomputed}`,
    );
    for (const f of d.failed) log(`  경로 실패(직선 대체): ${f.from} → ${f.to}`);
  }
}

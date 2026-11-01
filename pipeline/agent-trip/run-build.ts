import { isAllowedOrigin } from 'src/server/http';
import { appUrl, DEFAULT_APP_URL } from 'src/share-viewer/encode';
import { buildDoc, type BuiltDoc } from './build-doc';
import { buildLibrary, type BuiltLibrary } from './build-library';
import { EXIT, TripFailure, type TripIssue } from './errors';
import { parsePlan, type TripPlan } from './plan-schema';
import { resolvePlaces } from './resolve-places';
import { prepareRoutes, type RouteStats } from './route-legs';
import { summarize, type DaySummary } from './summary';

export type BuildOptions = {
  file: string;
  includeMemo: boolean;
  noRoutes: boolean;
  app: string;
  out?: string;
};
export type BuildResult = {
  plan: TripPlan;
  built: BuiltLibrary;
  doc: BuiltDoc;
  days: DaySummary[];
  stats: RouteStats;
  warnings: TripIssue[];
};
export type BuildDeps = {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): Date;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
};

/** 앱 출처만 받으며, 토큰을 쓰면 운영·미리보기·로컬 출처로 한정한다. */
export function pickApp(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  forToken: boolean,
): string {
  const value = appUrl(flag || env.LANDMARK_APP_URL || DEFAULT_APP_URL);
  const fail = (): never => {
    throw new TripFailure(
      [{ path: '', code: 'app-origin', message: '허용된 HTTP(S) 앱 출처를 적어 주세요' }],
      EXIT.input,
    );
  };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    value !== url.origin
  )
    return fail();
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (forToken && !isAllowedOrigin(url.origin) && !local) return fail();
  return url.origin;
}

/** 읽기·검사부터 앱 문서·링크·요약까지 같은 순서로 수행한다. */
export async function runBuild(opts: BuildOptions, deps: BuildDeps): Promise<BuildResult> {
  let value: unknown;
  try {
    value = JSON.parse(await deps.readFile(opts.file));
  } catch {
    throw new TripFailure(
      [{ path: '', code: 'schema', message: '계획 파일을 읽지 못했거나 JSON 형식이 아니에요' }],
      EXIT.input,
    );
  }
  const plan = parsePlan(value);
  const warnings: TripIssue[] = [];
  const places = await resolvePlaces(plan, deps, warnings);
  const now = deps.now();
  const built = buildLibrary(plan, places, now, warnings);
  const { routeOf, stats } = await prepareRoutes(
    built,
    { fetch: deps.fetch, sleep: deps.sleep, skip: opts.noRoutes },
    warnings,
  );
  const doc = await buildDoc(
    built,
    routeOf,
    { title: plan.title, includeMemo: opts.includeMemo, app: opts.app, now },
    plan,
  );
  const days = summarize(built, routeOf, plan);
  if (opts.out !== undefined) {
    try {
      await deps.writeFile(opts.out, JSON.stringify(doc.doc, null, 2) + '\n');
    } catch (error) {
      const cause =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : '알 수 없는 오류';
      throw new TripFailure(
        [
          {
            path: '--out',
            code: 'schema',
            message: `문서 파일을 쓰지 못했어요 (${opts.out}): ${cause}`,
          },
        ],
        EXIT.input,
      );
    }
  }
  return { plan, built, doc, days, stats, warnings };
}

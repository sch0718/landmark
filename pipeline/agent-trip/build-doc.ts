import { defaultTitleLabel, importSharePlaces } from 'src/domain/library/import-share';
import { importSharedTrip } from 'src/domain/library/import-share-trip';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { AGENT_INBOX_LIMITS, agentDocProblem } from 'src/domain/share/agent-limits';
import { buildTripShareDoc, type ShareLegTime } from 'src/domain/share/build-trip-share';
import { checkShareTrip } from 'src/domain/share/check-share-trip';
import { readShareHash } from 'src/domain/share/read-share';
import type { Leg } from 'src/domain/trips/query';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocV2Schema, type ShareDocV2 } from 'src/schema/share';
import { randomId } from 'src/services/id-gen';
import { hashDoc, importLink, viewLink } from 'src/share-viewer/encode';
import type { BuiltLibrary } from './build-library';
import { exitFor, TripFailure, type TripErrorCode, type TripIssue } from './errors';
import type { TripPlan } from './plan-schema';

export type BuiltDoc = {
  doc: ShareDocV2;
  view: string;
  importHref: string;
  importHash: string;
  viewHash: string;
};

/** 장소·라벨·여행의 키 정렬 JSON이 동기화 항목 상한을 넘는지 본다. */
export function oversizedItems(lib: Library, max: number): string[] {
  return (
    [
      ['place', lib.places],
      ['label', lib.labels],
      ['trip', lib.trips],
    ] as const
  ).flatMap(([kind, items]) =>
    Object.entries(items).flatMap(([id, item]) =>
      stableStringify(item).length > max ? [`${kind}:${id}`] : [],
    ),
  );
}

function fail(code: TripErrorCode, path: string, message: string): never {
  throw new TripFailure([{ code, path, message }], exitFor(code));
}

/** 가져오기가 실제로 만든 대응표로, 뒤에서 사라진 Stop·후보와 먼저 남은 참조를 찾는다. */
function mergedIssues(
  importedIds: ReadonlyMap<string, string>,
  built: BuiltLibrary,
  plan: TripPlan,
): TripIssue[] {
  const first = new Map<string, string>();
  const issues = new Map<string, TripIssue>();
  const visit = (key: string, path: string) => {
    const originalId = built.placeIds.get(key);
    const importedId = originalId === undefined ? undefined : importedIds.get(originalId);
    if (importedId === undefined) return;
    const previous = first.get(importedId);
    if (previous === undefined) {
      first.set(importedId, path);
      return;
    }
    for (const [at, other] of [
      [path, previous],
      [previous, path],
    ] as const) {
      issues.set(at, {
        path: at,
        code: 'merged-places',
        message: `가져올 때 ${other}와 같은 장소로 합쳐져 뒤의 Stop·후보가 사라져요. 한 key로 합쳐 주세요`,
      });
    }
  };
  plan.days.forEach((day, d) =>
    day.stops.forEach((stop, s) => visit(stop.place, `days[${d}].stops[${s}].place`)),
  );
  plan.candidates?.forEach((key, i) => visit(key, `candidates[${i}]`));
  return [...issues.values()];
}

/** 가져온 새 장소의 원본 이름·좌표로 문서 id를 찾고, 계획의 장소 경로로 되짚는다. */
function oversizedPlacePath(
  place: Place,
  doc: ShareDocV2,
  built: BuiltLibrary,
  plan: TripPlan,
): string {
  const original = doc.places.find(
    (p) => p.name === place.name.value && p.lng === place.lng && p.lat === place.lat,
  );
  const key =
    original === undefined
      ? undefined
      : [...built.placeIds].find(([, id]) => id === original.id)?.[0];
  const index = plan.places.findIndex((p) => p.key === key);
  return index < 0 ? 'places' : `places[${index}]`;
}

export async function buildDoc(
  built: BuiltLibrary,
  routeOf: (leg: Leg) => ShareLegTime,
  opts: { title: string; includeMemo: boolean; app: string; now: Date },
  plan: TripPlan,
): Promise<BuiltDoc> {
  try {
    const doc = buildTripShareDoc(built.lib, built.tripId, routeOf, {
      ...opts,
      includeCandidates: true,
    });
    if (doc === null) fail('internal', 'days', '공유할 여행을 찾지 못했어요');
    const parsed = safeParse(ShareDocV2Schema, doc, { onExcessProperty: 'error' });
    if (!parsed.success) {
      throw new TripFailure(
        parsed.issues.map((issue) => ({
          path: issue.path,
          code: 'internal',
          message: `만든 공유 문서가 올바르지 않아요: ${issue.path}: ${issue.message}`,
        })),
        exitFor('internal'),
      );
    }
    const problems = checkShareTrip(doc);
    if (problems.length > 0) {
      throw new TripFailure(
        problems.map((message) => ({ path: 'days', code: 'internal', message })),
        exitFor('internal'),
      );
    }

    const stripped = hashDoc(doc) as ShareDocV2;
    const input = { titleLabel: defaultTitleLabel(doc.title), appendMemo: true };
    const ctx = {
      now: opts.now.toISOString(),
      newId: (kind: string) => randomId(kind === 'label' || kind === 'stop' ? 8 : 10),
    };
    const imported = importSharedTrip(emptyLibrary(), stripped, input, ctx);
    if (!imported.ok)
      fail('internal', 'days', `만든 공유 문서를 가져오지 못했어요 (${imported.error._tag})`);
    const trip =
      imported.createdId === undefined ? undefined : imported.lib.trips[imported.createdId];
    if (trip === undefined) fail('internal', 'days', '모의 가져오기가 새 여행을 만들지 못했어요');
    const received = doc.trips[0]!;
    if (
      trip.days.some((day, d) => day.stops.value.length !== received.days[d]!.stops.length) ||
      trip.candidates.value.length !== received.candidateIds.length
    ) {
      // 오류 진단 때만 장소 가져오기를 다시 돌려 앱의 병합 규칙을 그대로 쓴다.
      const placed = importSharePlaces(
        emptyLibrary(),
        stripped,
        { ...input, selected: doc.places.map((p) => p.id) },
        ctx,
      );
      if (!placed.ok)
        fail('internal', 'days', `합쳐진 장소를 확인하지 못했어요 (${placed.error._tag})`);
      const issues = mergedIssues(placed.placeIds, built, plan);
      if (issues.length === 0)
        fail('internal', 'days', '가져오며 사라진 장소의 계획 경로를 찾지 못했어요');
      throw new TripFailure(issues, exitFor('merged-places'));
    }

    const oversized = oversizedItems(imported.lib, ITEM_DOC_MAX_CHARS);
    if (oversized.length > 0) {
      throw new TripFailure(
        oversized.map((key) => {
          const [kind, id] = key.split(':');
          return {
            path:
              kind === 'place'
                ? oversizedPlacePath(imported.lib.places[id!]!, doc, built, plan)
                : 'days',
            code: 'item-too-large',
            message: `가져온 항목이 동기화 크기 한도를 넘어요 (${key})`,
          };
        }),
        exitFor('item-too-large'),
      );
    }

    const view = await viewLink(doc, opts.app);
    const importing = await importLink(doc, opts.app);
    if (view.kind !== 'direct' || importing.kind !== 'direct') {
      fail('too-big', 'days', '장소·Day를 줄이거나 앱에서 파일로 공유해 주세요');
    }
    const importHash = importing.href.split('#d=')[1]!;
    const viewHash = view.href.split('#d=')[1]!;
    const read = await readShareHash(importHash, AGENT_INBOX_LIMITS);
    if (!read.ok)
      fail(
        'too-big',
        'days',
        `받은함에서 문서를 읽을 수 없어요 (${read.error}). 장소·Day를 줄이거나 앱에서 파일로 공유해 주세요`,
      );
    const problem = agentDocProblem(doc);
    if (problem !== null)
      fail(
        'internal',
        problem === 'title' ? 'title' : 'places',
        `만든 공유 문서가 받은함 내용 한도를 벗어났어요 (${problem})`,
      );
    return { doc, view: view.href, importHref: importing.href, importHash, viewHash };
  } catch (error) {
    if (error instanceof TripFailure) throw error;
    fail('internal', 'days', '공유 문서를 만들고 검사하지 못했어요');
  }
}

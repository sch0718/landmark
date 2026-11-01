import { sourceKey, type PlaceCandidate } from 'src/domain/library/add-place';
import { AGENT_PLACE_LIMITS } from 'src/domain/share/agent-limits';
import { Lat, Lng } from 'src/schema/common';
import { is } from 'src/schema/parse';
import { makeRequester, type Requester } from 'src/server/request';
import { httpDeps, resolveLink } from 'src/server/resolve';
import { searchNaverPlaces } from 'src/server/search';
import { fetchPlaceSummary } from '../naver-client';
import { EXIT, TripFailure, exitFor, type TripIssue } from './errors';
import type { PlanPlace, TripPlan } from './plan-schema';

export type ResolvedPlace = {
  key: string;
  index: number;
  candidate: PlaceCandidate;
  memo: string;
};

export type ResolveDeps = {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  gapMs?: number;
};

const normalizeName = (name: string) => name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
const issue = (path: string, code: TripIssue['code'], message: string): TripIssue => ({
  path,
  code,
  message,
});

function pin(place: PlanPlace, name: string): PlaceCandidate {
  return {
    source: { kind: 'pin' },
    name,
    address: place.address ?? '',
    lng: place.lng!,
    lat: place.lat!,
    category: null,
  };
}

async function lookupPlace(
  place: PlanPlace,
  path: string,
  request: Requester,
  deps: ResolveDeps,
  warnings: TripIssue[],
): Promise<PlaceCandidate | TripIssue> {
  if (place.naverSid !== undefined) {
    const { sid, ...candidate } = await fetchPlaceSummary(place.naverSid, httpDeps(request));
    return { ...candidate, source: { kind: 'naver', sid } };
  }
  if (place.link !== undefined) {
    const result = await resolveLink(place.link, { fetch: deps.fetch });
    if (result.kind === 'folder') {
      return issue(path, 'lookup-failed', '폴더 링크는 장소가 아니에요');
    }
    const source: PlaceCandidate['source'] =
      result.providerId === null
        ? { kind: 'pin' }
        : result.provider === 'naver'
          ? { kind: 'naver', sid: result.providerId }
          : result.provider === 'kakao'
            ? { kind: 'kakao', kakaoId: result.providerId }
            : { kind: 'google', googleId: result.providerId };
    return {
      source,
      name: result.name,
      address: result.address,
      lng: result.lng,
      lat: result.lat,
      category: result.category,
    };
  }
  if (place.search !== undefined) {
    const results = (await searchNaverPlaces(place.search, { fetch: deps.fetch })).filter(
      (result) => result.sid !== null,
    );
    const target = normalizeName(place.name ?? place.search.q);
    const exact = results.filter((result) => normalizeName(result.name) === target);
    const selected = exact.length === 1 ? exact[0] : results.length === 1 ? results[0] : undefined;
    if (selected !== undefined) {
      return {
        source: { kind: 'naver', sid: selected.sid! },
        name: selected.name,
        address: selected.address,
        lng: selected.lng,
        lat: selected.lat,
        category: selected.category,
      };
    }
    if (results.length > 0) {
      return {
        ...issue(path, 'ambiguous', '검색 후보가 여럿이에요. naverSid로 골라 주세요'),
        candidates: results.slice(0, 5).map((result) => ({
          naverSid: result.sid!,
          name: result.name,
          address: result.address,
          category: result.category,
        })),
      };
    }
    if (place.lng !== undefined && place.lat !== undefined) {
      warnings.push(issue(path, 'not-found', '검색 결과가 없어 적어 준 좌표로 핀을 만들었어요'));
      return pin(place, place.name ?? place.search.q);
    }
    return issue(path, 'not-found', '검색 결과가 없어요. 이름과 좌표를 적어 주세요');
  }
  // 출처 없는 핀의 이름과 좌표는 계획 스키마에서 이미 검사했다.
  return pin(place, place.name ?? '');
}

function checkCandidate(
  candidate: PlaceCandidate,
  place: PlanPlace,
  path: string,
  warnings: TripIssue[],
): TripIssue[] {
  const issues: TripIssue[] = [];
  if (!is(Lng, candidate.lng) || !is(Lat, candidate.lat)) {
    issues.push(issue(path, 'out-of-range', '장소 좌표는 경도 124~132, 위도 33~39여야 해요'));
  }
  const source = candidate.source;
  const limits = AGENT_PLACE_LIMITS;
  const invalidSource =
    source.kind === 'naver'
      ? !limits.numericIdPattern.test(source.sid)
      : source.kind === 'kakao'
        ? !limits.numericIdPattern.test(source.kakaoId)
        : source.kind === 'google' && source.googleId.length > limits.googleIdChars;
  if (invalidSource) {
    const field =
      place.link !== undefined ? 'link' : place.search !== undefined ? 'search' : 'naverSid';
    issues.push(issue(`${path}.${field}`, 'out-of-range', '조회한 장소의 출처 id가 한도를 넘어요'));
  }
  candidate.name = candidate.name || place.name || '';
  candidate.address = candidate.address || place.address || '';
  if (candidate.name.length === 0) {
    issues.push(issue(path, 'lookup-failed', '장소 이름이 없어요. 대체 이름을 적어 주세요'));
  }
  for (const [field, limit, label] of [
    ['name', limits.nameChars, '이름'],
    ['address', limits.addressChars, '주소'],
  ] as const) {
    if (candidate[field].length > limit) {
      candidate[field] = candidate[field].slice(0, limit);
      warnings.push(issue(path, 'out-of-range', `장소 ${label}를 ${limit}자로 줄였어요`));
    }
  }
  return issues;
}

/** 차례로 조회하고 경고와 오류를 모두 모은다. 입력 오류는 조회 오류보다 우선한다. */
export async function resolvePlaces(
  plan: TripPlan,
  deps: ResolveDeps,
  warnings: TripIssue[],
): Promise<ResolvedPlace[]> {
  const request = makeRequester({ fetch: deps.fetch });
  const resolved: ResolvedPlace[] = [];
  const issues: TripIssue[] = [];
  const sources = new Map<string, string>();
  let requested = false;
  for (const [index, place] of plan.places.entries()) {
    const path = `places[${index}]`;
    if (place.naverSid !== undefined || place.link !== undefined || place.search !== undefined) {
      if (requested) await deps.sleep(deps.gapMs ?? 300);
      requested = true;
    }
    let result: PlaceCandidate | TripIssue;
    try {
      result = await lookupPlace(place, path, request, deps, warnings);
    } catch {
      if (place.name && place.lng !== undefined && place.lat !== undefined) {
        result = pin(place, place.name);
        if (place.naverSid !== undefined) result.source = { kind: 'naver', sid: place.naverSid };
        warnings.push(
          issue(path, 'lookup-failed', '장소를 조회하지 못해 적어 준 이름·좌표를 썼어요'),
        );
      } else {
        result = issue(
          path,
          'lookup-failed',
          '장소를 조회하지 못했어요. 대체 이름과 좌표를 적어 주세요',
        );
      }
    }
    if ('code' in result) {
      issues.push(result);
      continue;
    }
    const problems = checkCandidate(result, place, path, warnings);
    issues.push(...problems);
    if (problems.length > 0) continue;
    const key = sourceKey(result.source);
    if (key !== null) {
      const previous = sources.get(key);
      if (previous !== undefined) {
        issues.push(issue(path, 'duplicate-source', `${previous}과 같아요. 한 key로 합쳐 주세요`));
      } else sources.set(key, path);
    }
    resolved.push({ key: place.key, index, candidate: result, memo: place.memo ?? '' });
  }
  if (issues.length > 0) {
    // 입력부터 고쳐 다시 조회할 수 있도록 끝 코드 2를 3보다 우선한다.
    const exit = issues.some((problem) => exitFor(problem.code) === EXIT.input)
      ? EXIT.input
      : EXIT.lookup;
    throw new TripFailure(issues, exit);
  }
  return resolved;
}

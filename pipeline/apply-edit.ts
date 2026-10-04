import { dirname, join } from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type YAMLMap } from 'yaml';
import { reconcile } from 'src/domain/reconcile';
import { EditLayerSchema, type EditLayer } from 'src/schema/edit-layer';
import { TripDataSchema, type Stop, type TripData } from 'src/schema/trip-data';
import { TripSourceSchema, type TripSource } from 'src/schema/trip-source';
import { parseSource } from './collect';
import type { FsPort } from './fs-port';
import type { GitPort } from './git-port';
import { placeKeyOf } from './resolve-stops';

export type ApplyEditCode =
  | 'behind-origin'
  | 'newer-base'
  | 'invalid-edit'
  | 'unresolved'
  | 'would-remove'
  | 'yaml-drift'
  | 'invalid-result';

export class ApplyEditError extends Error {
  code: ApplyEditCode;
  details: string[];
  constructor(code: ApplyEditCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'ApplyEditError';
    this.code = code;
    this.details = details;
  }
}

export type ApplyEditDeps = { fs: FsPort; git: GitPort; log: (line: string) => void };

/** 최신 기준을 확보하는 방법은 `git pull`뿐이다(§5.7 검사 0). collect 재실행은 안내하지 않는다. */
const PULL_GUIDE = '`git pull`로 최신 yaml과 JSON을 함께 받으세요.';

type ComparableStop = {
  id: string | null;
  placeKey: string;
  time: string | null;
  note: string | null;
};

const fromSource = (s: TripSource['days'][number]['stops'][number]): ComparableStop => ({
  id: s.id ?? null,
  placeKey: placeKeyOf(s.place),
  time: s.time ?? null,
  note: s.note ?? null,
});

const fromData = (s: Stop): ComparableStop => ({
  id: s.id,
  placeKey: s.placeKey,
  time: s.time ?? null,
  note: s.note ?? null,
});

const formatStops = (stops: ComparableStop[]): string =>
  stops.length === 0
    ? '(비어 있음)'
    : stops
        .map(
          (s) =>
            `${s.id ?? '(id 없음)'}:${s.placeKey}${s.time ? ` ${s.time}` : ''}${s.note ? ` "${s.note}"` : ''}`,
        )
        .join(' → ');

/** PlaceKey → yaml `place` (`n:<sid>` → sid, `c:<key>` → key). */
const placeOfKey = (placeKey: string): string => placeKey.slice(2);

/**
 * 앱에서 내보낸 EditLayer의 일정 override를 trips/<trip>.yaml에 반영한다(§5.7, §7.2).
 * 검사 0→3을 모두 통과한 뒤에만 yaml을 기록하며, 실패하면 yaml은 바뀌지 않는다.
 * TripData(JSON)는 바꾸지 않는다.
 */
export async function applyEdit(
  yamlPath: string,
  editPath: string,
  deps: ApplyEditDeps,
): Promise<{ appliedDates: string[] }> {
  // 검사 0: 최신 원본 동기화
  if (!(await deps.git.fetch())) {
    deps.log('경고: git fetch에 실패했습니다. 원격과의 동기화를 확인하지 못한 채 계속합니다.');
  }
  const behind = await deps.git.behindCount();
  if (behind > 0) {
    throw new ApplyEditError(
      'behind-origin',
      `현재 브랜치가 원격보다 ${behind}커밋 뒤처져 있습니다. ${PULL_GUIDE}`,
    );
  }

  const yamlText = await deps.fs.readText(yamlPath);
  const { doc, source } = parseSource(yamlText, yamlPath);
  if (source.publicId === undefined) {
    throw new ApplyEditError(
      'invalid-edit',
      `${yamlPath}에 publicId가 없습니다. 아직 수집된 적 없는 yaml이라 편집의 기준이 되는 JSON이 있을 수 없습니다.`,
    );
  }

  const edit = parseEdit(await deps.fs.readText(editPath), editPath);
  if (edit.publicId !== source.publicId) {
    throw new ApplyEditError(
      'invalid-edit',
      `다른 여행의 편집 파일입니다 (편집 publicId=${edit.publicId}, yaml publicId=${source.publicId}).`,
    );
  }

  const jsonPath = join(dirname(dirname(yamlPath)), 'public', 'data', `${source.publicId}.json`);
  const trip = await readTripData(deps.fs, jsonPath);

  if (edit.baseDataVersion > trip.dataVersion) {
    throw new ApplyEditError(
      'newer-base',
      `편집 파일이 로컬 JSON보다 새로운 원본(${edit.baseDataVersion})을 기준으로 만들어졌습니다(로컬 dataVersion=${trip.dataVersion}). ${PULL_GUIDE}`,
    );
  }

  // 검사 1: reconcile
  const { edit: reconciled, report } = reconcile(trip, edit);
  if (report.unresolvedGroups.length > 0) {
    throw new ApplyEditError(
      'unresolved',
      '미해결 원본 변경이 있습니다. 앱에서 [원본 보기] 또는 [내 편집 유지]로 먼저 해결한 뒤 다시 내보내세요.',
      report.unresolvedGroups.map((group) => `묶음: ${group.join(', ')}`),
    );
  }
  if (report.removedStops.length > 0) {
    const customNames = new Map(source.customPlaces.map((p) => [`c:${p.key}`, p.name]));
    throw new ApplyEditError(
      'would-remove',
      '현재 JSON에 없는 장소를 쓰는 방문이 있어 반영하면 사라집니다. yaml에 기록하는 apply-edit은 방문을 버리지 않습니다.',
      report.removedStops.map((r) => {
        const name =
          trip.places[r.placeKey]?.name ??
          customNames.get(r.placeKey) ??
          '(이름을 알 수 없는 장소)';
        return `${r.date} ${name} (${r.placeKey})`;
      }),
    );
  }

  const overrides = Object.entries(reconciled.days)
    .flatMap(([date, day]) => (day.mode === 'override' ? [{ date, stops: day.stops }] : []))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 검사 2: 미수집 yaml 보호
  checkDrift(source, trip, overrides);

  if (overrides.length === 0) {
    deps.log('반영할 일정 변경이 없습니다(yaml을 바꾸지 않았습니다).');
    return { appliedDates: [] };
  }

  for (const { date, stops } of overrides) replaceDayStops(doc, date, stops);
  const nextText = doc.toString();

  // 검사 3: 반영 결과 검증
  checkResult(
    nextText,
    overrides.map((o) => o.date),
  );

  await deps.fs.writeTextAtomic(yamlPath, nextText);

  const tripDays = new Map(trip.days.map((d) => [d.date, d]));
  const nameOf = (placeKey: string) => trip.places[placeKey]?.name ?? placeKey;
  for (const { date, stops } of overrides) {
    const prev = tripDays.get(date)?.stops ?? [];
    deps.log(`반영: ${date} 장소 ${prev.length}곳 → ${stops.length}곳`);
    deps.log(`  이전: ${prev.map((s) => nameOf(s.placeKey)).join(' → ') || '(비어 있음)'}`);
    deps.log(`  이후: ${stops.map((s) => nameOf(s.placeKey)).join(' → ') || '(비어 있음)'}`);
  }
  if (report.autoResetDates.length > 0) {
    deps.log(`원본과 같아 건너뛴 날: ${report.autoResetDates.join(', ')}`);
  }
  return { appliedDates: overrides.map((o) => o.date) };
}

function parseEdit(text: string, file: string): EditLayer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ApplyEditError('invalid-edit', `${file}은 JSON이 아닙니다.`, [
      e instanceof Error ? e.message : String(e),
    ]);
  }
  const parsed = EditLayerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplyEditError(
      'invalid-edit',
      `${file}은 올바른 편집 파일이 아닙니다.`,
      parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`),
    );
  }
  return parsed.data;
}

async function readTripData(fs: FsPort, jsonPath: string): Promise<TripData> {
  let text: string;
  try {
    text = await fs.readText(jsonPath);
  } catch (e) {
    throw new Error(
      `기준 JSON을 읽지 못했습니다 (${jsonPath}): ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  const parsed = TripDataSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `기준 JSON 검증 실패 (${jsonPath}): ${first ? `${first.path.join('.')}: ${first.message}` : ''}`,
    );
  }
  return parsed.data;
}

function checkDrift(
  source: TripSource,
  trip: TripData,
  overrides: { date: string; stops: Stop[] }[],
): void {
  const details: string[] = [];
  const yamlDays = new Map(source.days.map((d) => [d.date, d]));
  const jsonDays = new Map(trip.days.map((d) => [d.date, d]));

  for (const date of [...new Set([...yamlDays.keys(), ...jsonDays.keys()])].sort()) {
    if (!jsonDays.has(date)) details.push(`${date}: yaml에만 있는 날짜입니다`);
    else if (!yamlDays.has(date)) details.push(`${date}: JSON에만 있는 날짜입니다`);
  }

  for (const { date } of overrides) {
    const y = yamlDays.get(date);
    const j = jsonDays.get(date);
    if (!y || !j) {
      if (!y && !j) details.push(`${date}: 편집한 날짜가 yaml과 JSON 모두에 없습니다`);
      continue; // 한쪽에만 있으면 위 날짜 목록 비교에서 이미 보고했다.
    }
    const ys = y.stops.map(fromSource);
    const js = j.stops.map(fromData);
    if (JSON.stringify(ys) !== JSON.stringify(js)) {
      details.push(`${date}: yaml ${formatStops(ys)} ≠ JSON ${formatStops(js)}`);
    }
  }

  if (details.length > 0) {
    throw new ApplyEditError(
      'yaml-drift',
      'yaml이 마지막 collect 이후 직접 수정되었습니다. 먼저 collect로 JSON을 yaml에 맞추고, 앱에서 편집을 다시 확인한 뒤 내보내세요.',
      details,
    );
  }
}

/** 그날 `stops`를 override로 바꾼다. 같은 id의 기존 노드는 재사용해 그 주석을 보존한다. */
function replaceDayStops(doc: Document, date: string, stops: Stop[]): void {
  const days = doc.get('days', true);
  if (!isSeq(days)) throw new Error('yaml에 days가 없습니다');
  const day = days.items.find((d): d is YAMLMap => isMap(d) && String(d.get('date')) === date);
  if (!day) throw new Error(`yaml에 ${date}가 없습니다`);

  const oldSeq = day.get('stops', true);
  const byId = new Map<string, YAMLMap>();
  if (isSeq(oldSeq)) {
    for (const item of oldSeq.items) {
      if (!isMap(item)) continue;
      const id = item.get('id');
      if (typeof id === 'string') byId.set(id, item);
    }
  }

  // 시각·숫자 sid는 따옴표로 써서 YAML 1.1 파서(60진수·정수 해석)에서도 문자열로 남게 한다.
  const scalar = (value: string, quote: boolean): Scalar => {
    const node = doc.createNode(value);
    if (quote) node.type = Scalar.QUOTE_SINGLE;
    return node;
  };
  const fields = (stop: Stop): [string, Scalar | undefined][] => {
    const place = placeOfKey(stop.placeKey);
    return [
      ['place', scalar(place, stop.placeKey.startsWith('n:'))],
      ['time', stop.time === undefined ? undefined : scalar(stop.time, true)],
      ['note', stop.note === undefined ? undefined : scalar(stop.note, false)],
    ];
  };

  const items = stops.map((stop) => {
    let node = byId.get(stop.id);
    if (!node) {
      node = doc.createNode({ id: stop.id });
      node.flow = true;
    }
    for (const [key, value] of fields(stop)) {
      if (value === undefined) node.delete(key);
      else if (!isSameScalar(node.get(key, true), value)) node.set(key, value);
    }
    return node;
  });

  if (isSeq(oldSeq)) {
    oldSeq.items = items;
    oldSeq.flow = items.length === 0;
  } else {
    const seq = doc.createNode(items);
    seq.flow = items.length === 0;
    day.set('stops', seq);
  }
}

/** 값이 같은 기존 스칼라는 그대로 둬서 따옴표 스타일·주석을 보존한다. */
const isSameScalar = (existing: unknown, next: Scalar): boolean =>
  isScalar(existing) && existing.value === next.value;

function checkResult(text: string, writtenDates: string[]): void {
  const reparsed = parseDocument(text);
  const fail = (details: string[]) => {
    throw new ApplyEditError(
      'invalid-result',
      '반영 결과 yaml이 TripSource 검증을 통과하지 못해 기록하지 않았습니다.',
      details,
    );
  };
  if (reparsed.errors.length > 0) fail(reparsed.errors.map((e) => e.message));
  const parsed = TripSourceSchema.safeParse(reparsed.toJS());
  if (!parsed.success) {
    fail(parsed.error.issues.map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`));
    return;
  }
  // 반영한 날의 customPlace 참조는 yaml 안에서 확인할 수 있다.
  const keys = new Set(parsed.data.customPlaces.map((p) => p.key));
  const missing = parsed.data.days
    .filter((d) => writtenDates.includes(d.date))
    .flatMap((d) =>
      d.stops
        .filter((s) => !/^\d+$/.test(s.place) && !keys.has(s.place))
        .map((s) => `${d.date}: customPlaces에 없는 key입니다: ${s.place}`),
    );
  if (missing.length > 0) fail(missing);
}

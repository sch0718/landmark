import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';
import { ApplyEditError, applyEdit } from '../../../pipeline/apply-edit';
import { collect } from '../../../pipeline/collect';
import { createShellGitPort, type GitPort } from '../../../pipeline/git-port';
import { hashDayStops } from 'src/domain/day-hash';
import type { DayEdit, EditLayer } from 'src/schema/edit-layer';
import { parseOrThrow, safeParse } from 'src/schema/parse';
import { TRIP_DATA_PARSE, TripDataSchema, type Stop, type TripData } from 'src/schema/trip-data';
import { TripSourceSchema } from 'src/schema/trip-source';
import { fixture, NOW, setupCollect, YAML_PATH } from './pipeline-harness';

const EDIT_PATH = 'edits/x.tripedit.json';
const D1 = '2026-11-14';
const D2 = '2026-11-15';
const D3 = '2026-11-16';
const EDITED_AT = '2026-10-03T02:00:00.000Z';

/** basic.yaml에 3일째(2026-11-16)를 더한 yaml. */
const threeDayYaml = (): string =>
  fixture('trips/basic.yaml')
    .replace('endDate: 2026-11-15', 'endDate: 2026-11-16')
    .concat(`  - date: ${D3}\n    stops:\n      - { place: '12028621' } # 셋째 날\n`);

/** collect를 한 번 실행해 서로 맞는 yaml·JSON을 만든다. */
async function prepared(yaml = fixture('trips/basic.yaml')) {
  const env = setupCollect(yaml);
  const r = await collect(YAML_PATH, { refreshRoutes: false }, env.deps);
  const json = parseOrThrow(TripDataSchema, JSON.parse(env.fs.files[r.outPath]!), TRIP_DATA_PARSE);
  return { ...env, json, jsonPath: r.outPath };
}

const okGit = (over: Partial<GitPort> = {}): GitPort => ({
  fetch: async () => true,
  behindCount: async () => 0,
  ...over,
});

function dayOf(json: TripData, date: string) {
  const d = json.days.find((x) => x.date === date);
  if (!d) throw new Error(`no day ${date}`);
  return d;
}

function override(
  json: TripData,
  date: string,
  stops: Stop[],
): Extract<DayEdit, { mode: 'override' }> {
  return {
    mode: 'override',
    stops,
    baseDayHash: hashDayStops(dayOf(json, date).stops),
    updatedAt: EDITED_AT,
  };
}

function makeEdit(json: TripData, days: Record<string, DayEdit>, over: Partial<EditLayer> = {}) {
  const edit: EditLayer = {
    schemaVersion: 1,
    publicId: json.publicId,
    baseDataVersion: json.dataVersion,
    authorId: 'u1',
    authors: { u1: { nickname: '작성자', updatedAt: EDITED_AT } },
    places: {},
    days,
    ...over,
  };
  return JSON.stringify(edit);
}

async function runApply(
  env: Awaited<ReturnType<typeof prepared>>,
  editText: string,
  git: GitPort = okGit(),
) {
  env.fs.files[EDIT_PATH] = editText;
  const log = vi.fn();
  const before = env.fs.files[YAML_PATH];
  const result = await applyEdit(YAML_PATH, EDIT_PATH, { fs: env.fs, git, log }).then(
    (v) => ({ ok: true as const, value: v }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );
  return { result, log, before };
}

async function expectFailure(
  env: Awaited<ReturnType<typeof prepared>>,
  editText: string,
  code: ApplyEditError['code'],
  git?: GitPort,
): Promise<ApplyEditError> {
  const { result, before } = await runApply(env, editText, git);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.error).toBeInstanceOf(ApplyEditError);
  const err = result.error as ApplyEditError;
  expect(err.code).toBe(code);
  // 실패하면 yaml은 바이트 단위로 그대로다.
  expect(env.fs.files[YAML_PATH]).toBe(before);
  return err;
}

const yamlStops = (text: string, date: string) =>
  parseOrThrow(TripSourceSchema, parseDocument(text).toJS()).days.find((d) => d.date === date)!
    .stops;

describe('applyEdit', () => {
  it('override인 날만 yaml에 반영하고 주석·reset 날·편집 없는 날은 그대로 둔다', async () => {
    const env = await prepared(threeDayYaml());
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, {
      [D1]: override(env.json, D1, [
        a!,
        { ...c!, time: '10:30', note: '커피' },
        { id: b!.id, placeKey: b!.placeKey },
        { id: 'new1', placeKey: 'c:start', note: '복귀' },
      ]),
      [D2]: { mode: 'reset', updatedAt: EDITED_AT },
    });
    const before = env.fs.files[YAML_PATH]!;
    const { result, log } = await runApply(env, edit);

    expect(result).toEqual({ ok: true, value: { appliedDates: [D1] } });
    const after = env.fs.files[YAML_PATH]!;
    // 시각과 숫자 sid는 따옴표로 써서 다른 YAML 파서에서도 문자열로 읽힌다.
    expect(after).toContain(`- { place: '1885598328', id: ${c!.id}, time: '10:30', note: 커피 }`);
    expect(after).toContain(`- { id: new1, place: start, note: 복귀 }`);
    expect(yamlStops(after, D1)).toEqual([
      { id: a!.id, place: 'start' },
      { id: c!.id, place: '1885598328', time: '10:30', note: '커피' },
      { id: b!.id, place: '12028621' },
      { id: 'new1', place: 'start', note: '복귀' },
    ]);
    expect(after).toContain('# 테스트용 여행 (id 없음)');
    expect(after).toContain('# 속초, 고성, 양양 맛집');
    expect(after).toContain('# 출발');
    // D2(reset)·D3(편집 없음) 부분은 바이트가 같다.
    const tail = (s: string) => s.slice(s.indexOf(`- date: ${D2}`));
    expect(tail(after)).toBe(tail(before));
    // TripData는 바꾸지 않는다.
    expect(env.fs.files[env.jsonPath]).toBe(JSON.stringify(env.json));
    const lines = log.mock.calls.map((x) => String(x[0]));
    expect(lines.some((l) => l.includes(D1))).toBe(true);
  });

  it('원본과 같아진 override(자동 reset)만 있으면 yaml을 쓰지 않는다', async () => {
    const env = await prepared();
    const edit = makeEdit(env.json, {
      [D1]: override(env.json, D1, dayOf(env.json, D1).stops),
    });
    const { result, before } = await runApply(env, edit);
    expect(result).toEqual({ ok: true, value: { appliedDates: [] } });
    expect(env.fs.files[YAML_PATH]).toBe(before);
  });

  it('미해결 원본 변경이 있으면 unresolved', async () => {
    const env = await prepared();
    const [a, b] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, {
      [D1]: { ...override(env.json, D1, [b!, a!]), baseDayHash: 'deadbeef' },
    });
    const err = await expectFailure(env, edit, 'unresolved');
    expect(err.details.join('\n')).toContain(D1);
  });

  it('편집의 baseDataVersion이 JSON보다 새로우면 newer-base이고 git pull만 안내한다', async () => {
    const env = await prepared();
    const edit = makeEdit(env.json, {}, { baseDataVersion: '2026-10-04T00:00:00.000Z' });
    const err = await expectFailure(env, edit, 'newer-base');
    expect(err.message).toContain('`git pull`로 최신 yaml과 JSON을 함께 받으세요');
    expect(err.message).not.toContain('collect');
  });

  it('오래된 yaml 재수집 우회: JSON에 없는 c:y를 쓰는 편집은 would-remove', async () => {
    const env = await prepared();
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(
      env.json,
      { [D1]: override(env.json, D1, [a!, { id: 'yyy1', placeKey: 'c:y' }, b!, c!]) },
      { baseDataVersion: '2026-10-01T00:00:00.000Z' },
    );
    const err = await expectFailure(env, edit, 'would-remove');
    expect(err.details).toHaveLength(1);
    expect(err.details[0]).toContain(D1);
    expect(err.details[0]).toContain('c:y');
  });

  it('원격보다 뒤처져 있으면 behind-origin', async () => {
    const env = await prepared();
    const edit = makeEdit(env.json, {});
    const err = await expectFailure(
      env,
      edit,
      'behind-origin',
      okGit({ behindCount: async () => 2 }),
    );
    expect(err.message).toContain('`git pull`로 최신 yaml과 JSON을 함께 받으세요');
    expect(err.message).not.toContain('collect');
  });

  it('git fetch가 실패하면 경고만 남기고 계속한다', async () => {
    const env = await prepared();
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, { [D1]: override(env.json, D1, [a!, c!, b!]) });
    const { result, log } = await runApply(env, edit, okGit({ fetch: async () => false }));
    expect(result).toEqual({ ok: true, value: { appliedDates: [D1] } });
    expect(log.mock.calls.some((x) => String(x[0]).includes('git fetch'))).toBe(true);
  });

  it('미수집 yaml 보호: yaml D1 stops가 JSON과 다르면 yaml-drift', async () => {
    const env = await prepared();
    env.fs.files[YAML_PATH] = env.fs.files[YAML_PATH]!.replace("time: '12:00'", "time: '13:00'");
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, { [D1]: override(env.json, D1, [a!, c!, b!]) });
    const err = await expectFailure(env, edit, 'yaml-drift');
    expect(err.details).toHaveLength(1);
    expect(err.details[0]).toContain(D1);
    expect(err.details[0]).toContain('13:00');
  });

  it('yaml과 JSON의 날짜 목록이 다르면 yaml-drift', async () => {
    const env = await prepared();
    env.fs.files[YAML_PATH] = env.fs.files[YAML_PATH]!.replace(
      / {2}- date: 2026-11-15\n {4}stops:\n {6}- [^\n]*\n/,
      '',
    );
    expect(env.fs.files[YAML_PATH]).not.toContain(`date: ${D2}`);
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, { [D1]: override(env.json, D1, [a!, c!, b!]) });
    const err = await expectFailure(env, edit, 'yaml-drift');
    expect(err.details.join('\n')).toContain(D2);
  });

  it('publicId가 다르거나 yaml에 publicId가 없으면 invalid-edit', async () => {
    const env = await prepared();
    await expectFailure(env, makeEdit(env.json, {}, { publicId: 'zzzzzzzzzz' }), 'invalid-edit');
    await expectFailure(env, '{"not":"an edit"}', 'invalid-edit');
    await expectFailure(env, 'not json', 'invalid-edit');

    env.fs.files[YAML_PATH] = env.fs.files[YAML_PATH]!.replace(/^publicId: .*\n/m, '');
    const err = await expectFailure(env, makeEdit(env.json, {}), 'invalid-edit');
    expect(err.message).toContain('publicId');
  });

  it('반영 결과가 TripSource 검증에 실패하면(다른 날과 stop id 중복) invalid-result', async () => {
    const env = await prepared();
    const [a] = dayOf(env.json, D1).stops;
    const [d2stop] = dayOf(env.json, D2).stops;
    // D2의 방문을 D1에 넣었지만 D2 override가 없다 → yaml에서 같은 id가 두 번 나온다.
    const edit = makeEdit(env.json, { [D1]: override(env.json, D1, [a!, d2stop!]) });
    const err = await expectFailure(env, edit, 'invalid-result');
    expect(err.details.join('\n')).toContain(d2stop!.id);
  });

  it('빈 일정: 마지막 stop을 뺀 override도 반영되고 collect 후 stops·legs가 빈다', async () => {
    const env = await prepared();
    const edit = makeEdit(env.json, { [D2]: override(env.json, D2, []) });
    const { result } = await runApply(env, edit);
    expect(result).toEqual({ ok: true, value: { appliedDates: [D2] } });
    const after = env.fs.files[YAML_PATH]!;
    expect(safeParse(TripSourceSchema, parseDocument(after).toJS()).success).toBe(true);
    expect(yamlStops(after, D2)).toEqual([]);

    const r = await collect(YAML_PATH, { refreshRoutes: false }, env.deps);
    const data = parseOrThrow(
      TripDataSchema,
      JSON.parse(env.fs.files[r.outPath]!),
      TRIP_DATA_PARSE,
    );
    expect(dayOf(data, D2)).toMatchObject({ stops: [], legs: [] });
  });

  it('통합: A→C→B 재정렬 → apply-edit → collect는 새 구간(A→C, C→B)만 경로를 조회한다', async () => {
    const env = await prepared();
    const [a, b, c] = dayOf(env.json, D1).stops;
    const edit = makeEdit(env.json, { [D1]: override(env.json, D1, [a!, c!, b!]) });
    const { result } = await runApply(env, edit);
    expect(result.ok).toBe(true);

    const coord = (placeKey: string) => {
      const p = env.json.places[placeKey]!;
      return `${p.lng},${p.lat}`;
    };
    const query = (from: Stop, to: Stop) =>
      `start=${coord(from.placeKey)}&goal=${coord(to.placeKey)}`;

    const routedBefore = env.calls.routeQueries.length;
    const r = await collect(YAML_PATH, { refreshRoutes: false }, env.deps);
    expect(env.calls.routeQueries.slice(routedBefore)).toEqual([query(a!, c!), query(c!, b!)]);
    const data = parseOrThrow(
      TripDataSchema,
      JSON.parse(env.fs.files[r.outPath]!),
      TRIP_DATA_PARSE,
    );
    expect(dayOf(data, D1).stops.map((s) => s.id)).toEqual([a!.id, c!.id, b!.id]);
    expect(data.dataVersion).toBe(NOW);
  });
});

describe('createShellGitPort', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // 상위 저장소(worktree)의 GIT_* 환경 변수가 임시 저장소 명령에 끼어들지 않게 한다.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'init.defaultBranch=main',
        ...args,
      ],
      { cwd, env: cleanEnv, stdio: 'pipe' },
    ).toString();

  function commit(repo: string, name: string) {
    writeFileSync(join(repo, name), name);
    git(repo, 'add', name);
    git(repo, 'commit', '--quiet', '-m', name);
  }

  it('클론이 원격보다 1커밋 뒤처지면 fetch 후 behindCount() === 1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trip-map-git-'));
    dirs.push(root);
    const remote = join(root, 'remote.git');
    git(root, 'init', '--quiet', '--bare', remote);
    git(root, 'clone', '--quiet', remote, 'a');
    const a = join(root, 'a');
    commit(a, 'one');
    git(a, 'push', '--quiet', 'origin', 'HEAD:main');
    git(root, 'clone', '--quiet', '--branch', 'main', remote, 'b');
    const b = join(root, 'b');
    commit(a, 'two');
    git(a, 'push', '--quiet', 'origin', 'HEAD:main');

    const port = createShellGitPort(b, vi.fn(), cleanEnv);
    expect(await port.behindCount()).toBe(0);
    expect(await port.fetch()).toBe(true);
    expect(await port.behindCount()).toBe(1);
  });

  it('upstream이 없으면 behindCount()는 0이고 경고를 남긴다, fetch 실패는 false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trip-map-git-'));
    dirs.push(root);
    git(root, 'init', '--quiet');
    commit(root, 'one');
    const warn = vi.fn();
    const port = createShellGitPort(root, warn, cleanEnv);
    expect(await port.behindCount()).toBe(0);
    expect(warn).toHaveBeenCalledOnce();

    const notRepo = mkdtempSync(join(tmpdir(), 'trip-map-nogit-'));
    dirs.push(notRepo);
    expect(await createShellGitPort(notRepo, vi.fn(), cleanEnv).fetch()).toBe(false);
  });
});

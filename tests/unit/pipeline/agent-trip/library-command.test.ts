// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main, type CliDeps } from '../../../../pipeline/cli/trip';
import { EXIT } from '../../../../pipeline/agent-trip/errors';
import { helpText } from '../../../../pipeline/agent-trip/help';

const app = 'http://localhost:8795';
const token = 'lmk_' + 'a'.repeat(43);
const T0 = '2026-10-03T00:00:00.000Z';
const f = <T>(value: T) => ({ value, updatedAt: T0 });
const place = (id = 'place00001') => ({
  id,
  source: { kind: 'pin' },
  name: f('장소'),
  address: '주소',
  lng: 127,
  lat: 37,
  category: f(null),
  labelIds: f([]),
  memo: f('메모'),
  saved: f(true),
  createdAt: T0,
  deletedAt: null,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let calls: { path: string; method: string; body: unknown }[];
let handler: (path: string, body: unknown) => Response;
let deps: CliDeps;
let out: string[];
let err: string[];
let files: Record<string, string>;

beforeEach(() => {
  calls = [];
  out = [];
  err = [];
  files = { 'place.json': JSON.stringify(place()) };
  handler = () => json(500, {});
  deps = {
    env: { LANDMARK_AGENT_TOKEN: token, LANDMARK_TRIP_HOME: '/nonexistent' },
    platform: 'linux',
    fetch: vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const path = url.pathname.replace('/api/agent/v1', '') + url.search;
      calls.push({ path, method: init?.method ?? 'GET', body });
      return handler(path, body);
    }),
    now: () => new Date('2026-11-06T00:00:00Z'),
    sleep: async () => {},
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error('없는 파일');
      return text;
    },
    writeFile: async () => {},
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
  };
});
const run = (args: string[], asJson = true) =>
  main(['library', ...args, '--app', app, ...(asJson ? ['--json'] : [])], deps);
const data = () => JSON.parse(out.join(''));
const page = (items: unknown[], more = false, next = { rev: 1, key: '' }) =>
  json(200, { rev: 9, purgedRev: 0, more, next, items });
const item = (doc = place(), rev = 3, deleted = false) => ({
  kind: 'place',
  id: doc.id,
  rev,
  deleted,
  doc,
});

describe('인자 검사', () => {
  it.each([
    [[]],
    [['bogus']],
    [['get', 'place']],
    [['get', 'weird', 'x']],
    [['list', '--kind', 'weird']],
    [['put', 'place', 'place00001', '--file', 'place.json']],
    [['put', 'place', 'place00001', '--base-rev', '1']],
    [['put', 'place', 'place00001', '--file', 'place.json', '--base-rev', 'x']],
    [['put', 'place', 'place00001', '--file', 'place.json', '--base-rev', '-1']],
    [['delete', 'place', 'place00001']],
    [['undo']],
    [['undo', 'c1', '--request', 'r1']],
    [['changes', 'extra']],
    [['list', '--file', 'place.json']],
  ])('%j는 입력 오류(2)이고 서버를 부르지 않는다', async (args) => {
    expect(await run(args)).toBe(EXIT.input);
    expect(calls).toEqual([]);
    expect(data().ok).toBe(false);
  });
});

describe('put 입력 검증', () => {
  it('앱 스키마에 안 맞는 문서는 서버로 보내기 전에 입력 오류(2)다', async () => {
    files['bad.json'] = JSON.stringify({ ...place(), lat: 'x' });
    expect(await run(['put', 'place', 'place00001', '--file', 'bad.json', '--base-rev', '0'])).toBe(
      EXIT.input,
    );
    expect(calls).toEqual([]);
  });
  it('문서 id가 인자와 다르면 입력 오류(2)다', async () => {
    expect(
      await run(['put', 'place', 'place00002', '--file', 'place.json', '--base-rev', '0']),
    ).toBe(EXIT.input);
    expect(calls).toEqual([]);
  });
  it('JSON이 아니거나 읽을 수 없는 파일은 입력 오류(2)다', async () => {
    files['broken.json'] = '{';
    for (const file of ['broken.json', 'missing.json'])
      expect(await run(['put', 'place', 'place00001', '--file', file, '--base-rev', '0'])).toBe(
        EXIT.input,
      );
    expect(calls).toEqual([]);
  });
  it('통과한 문서는 requestId와 baseRev와 함께 edit로 보낸다', async () => {
    handler = () =>
      json(200, { rev: 4, results: [{ kind: 'place', id: 'place00001', status: 'ok', rev: 4 }] });
    expect(
      await run(['put', 'place', 'place00001', '--file', 'place.json', '--base-rev', '0']),
    ).toBe(EXIT.ok);
    const call = calls[0]!;
    expect(call).toMatchObject({ path: '/library/edit', method: 'POST' });
    expect(call.body).toMatchObject({
      v: 1,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      ops: [{ op: 'put', kind: 'place', id: 'place00001', baseRev: 0, doc: place() }],
    });
    expect(data()).toMatchObject({
      ok: true,
      command: 'library',
      edit: { kind: 'place', id: 'place00001', rev: 4 },
    });
  });
});

describe('서버 상태별 끝 코드', () => {
  it.each([
    ['conflict', 'conflict'],
    ['missing', 'missing'],
    ['referenced', 'referenced'],
    ['invalid-ref', 'invalid-ref'],
    ['invalid', 'rejected'],
    ['too-large', 'rejected'],
    ['clock', 'rejected'],
  ])('edit %s는 끝 코드 5이고 사유 코드 %s를 낸다', async (status, code) => {
    handler = () =>
      json(200, {
        rev: 4,
        results: [
          {
            kind: 'place',
            id: 'place00001',
            status,
            ...(status === 'conflict' ? { rev: 7, doc: place() } : {}),
          },
        ],
      });
    expect(await run(['delete', 'place', 'place00001', '--base-rev', '3'])).toBe(EXIT.server);
    expect(data()).toMatchObject({ ok: false, errors: [{ code }] });
    expect(calls[0]!.body).toMatchObject({ ops: [{ op: 'delete', baseRev: 3 }] });
  });
  it('conflict는 현재 rev를 사람용 출력에 적는다', async () => {
    handler = () =>
      json(200, {
        rev: 4,
        results: [{ kind: 'place', id: 'place00001', status: 'conflict', rev: 7, doc: place() }],
      });
    expect(await run(['delete', 'place', 'place00001', '--base-rev', '3'], false)).toBe(
      EXIT.server,
    );
    expect(err.join('')).toMatch(/conflict.*7/);
  });
  it.each([
    [401, { error: 'unauthorized' }, EXIT.auth],
    [403, { error: 'scope' }, EXIT.auth],
    [429, { error: 'rate-limited' }, EXIT.server],
    [503, { error: 'off' }, EXIT.server],
    [410, { error: 'resync', purgedRev: 5 }, EXIT.server],
  ])('HTTP %i는 끝 코드 %i 규칙을 따른다', async (status, body, exit) => {
    handler = () => json(status, body);
    expect(await run(['list'])).toBe(exit);
    expect(await run(['changes'])).toBe(exit);
  });
  it('토큰이 없으면 끝 코드 4다', async () => {
    deps.env = {};
    expect(await run(['list'])).toBe(EXIT.auth);
  });
  it('응답 모양이 틀리면 서버 오류(5)다', async () => {
    handler = () => json(200, { nope: 1 });
    expect(await run(['list'])).toBe(EXIT.server);
  });
});

describe('읽기', () => {
  it('list는 페이지를 끝까지 읽고 지워진 항목은 뺀다', async () => {
    handler = (path) =>
      path.includes('since=0')
        ? page([item(place('place00001')), item(place('place00002'), 4, true)], true, {
            rev: 4,
            key: 'place:place00002',
          })
        : page([item(place('place00003'), 5)]);
    expect(await run(['list'])).toBe(EXIT.ok);
    expect(calls.map((c) => c.path)).toEqual([
      '/library/changes?since=0',
      '/library/changes?since=4&after=place%3Aplace00002',
    ]);
    expect(data().items.map((x: { id: string }) => x.id)).toEqual(['place00001', 'place00003']);
    expect(data().items[0]).toMatchObject({ kind: 'place', rev: 3, label: '장소' });
  });
  it('list --kind는 그 종류만 낸다', async () => {
    handler = () =>
      page([
        item(),
        { kind: 'label', id: 'label001', rev: 2, deleted: false, doc: { name: f('라벨') } },
      ]);
    await run(['list', '--kind', 'label']);
    expect(data().items.map((x: { kind: string }) => x.kind)).toEqual(['label']);
  });
  it('다음 위치가 나아가지 않는 more 응답은 서버 오류(5)로 끝낸다', async () => {
    handler = () => page([item()], true, { rev: 0, key: '' });
    expect(await run(['list'])).toBe(EXIT.server);
  });
  it('get은 문서와 rev를 낸다', async () => {
    handler = () => page([item(place(), 3)]);
    expect(await run(['get', 'place', 'place00001'])).toBe(EXIT.ok);
    expect(data()).toMatchObject({
      ok: true,
      item: { kind: 'place', id: 'place00001', rev: 3, doc: place() },
    });
  });
  it('get은 없는 항목이나 지워진 항목을 missing(5)으로 끝낸다', async () => {
    handler = () => page([item(place(), 3, true)]);
    expect(await run(['get', 'place', 'place00001'])).toBe(EXIT.server);
    expect(data().errors[0].code).toBe('missing');
    out = [];
    expect(await run(['get', 'place', 'nothing'])).toBe(EXIT.server);
  });
  it('changes는 변경 기록을 낸다', async () => {
    const change = {
      id: 'c1',
      requestId: 'r1',
      kind: 'place',
      itemId: 'place00001',
      beforeRev: 2,
      afterRev: 3,
      label: '장소',
      at: 1_700_000_000_000,
      undoneAt: null,
      tokenId: 't',
    };
    handler = () => json(200, { changes: [change] });
    expect(await run(['changes'])).toBe(EXIT.ok);
    expect(calls[0]!.path).toBe('/library/edits');
    expect(data().changes[0]).toMatchObject({ id: 'c1', requestId: 'r1' });
    out = [];
    expect(await run(['changes'], false)).toBe(EXIT.ok);
    expect(out.join('')).toContain('c1');
  });
});

describe('undo', () => {
  it('변경 id로 되돌린다', async () => {
    handler = () => json(200, { results: [{ id: 'c1', status: 'undone' }] });
    expect(await run(['undo', 'c1'])).toBe(EXIT.ok);
    expect(calls[0]).toMatchObject({ path: '/library/undo', body: { ids: ['c1'] } });
    expect(data().undo).toEqual([{ id: 'c1', status: 'undone' }]);
  });
  it('--request는 묶음으로 되돌린다', async () => {
    handler = () => json(200, { results: [{ id: 'c1', status: 'undone' }] });
    expect(await run(['undo', '--request', 'r1'])).toBe(EXIT.ok);
    expect(calls[0]!.body).toEqual({ requestId: 'r1' });
  });
  it('--request는 more가 false가 될 때까지 다시 부르고 결과를 합친다', async () => {
    const pages = [
      { results: [{ id: 'c2', status: 'undone' }], more: true },
      {
        results: [
          { id: 'c2', status: 'already' },
          { id: 'c1', status: 'undone' },
        ],
        more: false,
      },
    ];
    handler = () => json(200, pages[calls.length - 1]);
    expect(await run(['undo', '--request', 'r1'])).toBe(EXIT.ok);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => JSON.stringify(c.body) === '{"requestId":"r1"}')).toBe(true);
    expect(data().undo).toEqual([
      { id: 'c2', status: 'undone' },
      { id: 'c1', status: 'undone' },
    ]);
  });
  it('--request에서 more인데 한 건도 되돌리지 못하면 멈추고 사유를 낸다', async () => {
    handler = () => json(200, { results: [{ id: 'c1', status: 'changed' }], more: true });
    expect(await run(['undo', '--request', 'r1'])).toBe(EXIT.server);
    expect(calls).toHaveLength(1);
    expect(data().errors[0]).toMatchObject({ code: 'rejected', reason: 'changed' });
  });
  it.each(['changed', 'already', 'gone'])('%s는 끝 코드 5와 사유다', async (status) => {
    handler = () => json(200, { results: [{ id: 'c1', status }] });
    expect(await run(['undo', 'c1'])).toBe(EXIT.server);
    expect(data().errors[0]).toMatchObject({ code: 'rejected', reason: status });
  });
});

describe('도움말', () => {
  it('library --help는 하위 명령과 옵션을 보여 주고 서버를 부르지 않는다', async () => {
    expect(await main(['library', '--help'], deps)).toBe(EXIT.ok);
    const text = out.join('');
    for (const word of ['list', 'get', 'put', 'delete', 'changes', 'undo', '--base-rev', '--file'])
      expect(text).toContain(word);
    expect(calls).toEqual([]);
  });
  it('전체 도움말에도 library가 있고 80열 안팎이다', () => {
    const text = helpText();
    expect(text).toContain('library');
    for (const line of helpText('library').split('\n')) {
      const width = [...line].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
      expect(width, line).toBeLessThanOrEqual(86);
    }
  });
});

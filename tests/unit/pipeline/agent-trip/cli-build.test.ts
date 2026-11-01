// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { readShareHash } from 'src/domain/share/read-share';
import { hashDoc } from 'src/share-viewer/encode';
import { main, type CliDeps } from '../../../../pipeline/cli/trip';
import { TripFailure } from '../../../../pipeline/agent-trip/errors';
import {
  failureJson,
  failureText,
  successJson,
  successText,
} from '../../../../pipeline/agent-trip/output';
import { pickApp, runBuild } from '../../../../pipeline/agent-trip/run-build';
import type { TripPlan } from '../../../../pipeline/agent-trip/plan-schema';

const FILE = 'tests/fixtures/agent-trip/plan.json';
const NOW = new Date('2026-11-01T05:12:00.000Z');
const fixture = readFileSync(FILE, 'utf8');
const plan = (): TripPlan => JSON.parse(fixture) as TripPlan;
function setup(text = fixture) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input) !== 'https://map.naver.com/p/api/place/summary/123')
      throw new Error('장소 조회 외에는 요청하면 안 돼요');
    return Response.json({
      data: {
        placeDetail: {
          name: '학사평 순두부마을',
          address: { roadAddress: '강원 속초시 노학동' },
          coordinate: { longitude: 128.531, latitude: 38.204 },
          category: { category: '음식점' },
        },
      },
    });
  });
  const deps = {
    fetch,
    sleep: vi.fn(async () => {}),
    now: () => NOW,
    readFile: vi.fn<CliDeps['readFile']>(async () => text),
    writeFile: vi.fn<CliDeps['writeFile']>(async () => {}),
    env: {},
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  } satisfies CliDeps;
  return {
    deps,
    stdout: () => deps.stdout.mock.calls.map(([s]) => s).join(''),
    stderr: () => deps.stderr.mock.calls.map(([s]) => s).join(''),
  };
}
const options = {
  file: FILE,
  includeMemo: false,
  noRoutes: true,
  app: 'https://landmark.sch0718.dev',
};

describe('여행 CLI build', () => {
  it.each(['핀', '조회 실패 대체 값', '조회 결과의 빈 이름 대체 값'])(
    '%s의 이름과 메모는 trim한 값으로 문서에 들어간다',
    async (kind) => {
      const p = plan();
      Object.assign(p.places[1]!, { name: '  학사평  ', memo: '  메모  ' });
      if (kind !== '핀') p.places[1]!.naverSid = '123';
      const { deps } = setup(JSON.stringify(p));
      if (kind === '조회 실패 대체 값') deps.fetch.mockRejectedValue(new Error('조회 실패'));
      if (kind === '조회 결과의 빈 이름 대체 값')
        deps.fetch.mockResolvedValue(
          Response.json({
            data: {
              placeDetail: { name: '', coordinate: { longitude: 128.531, latitude: 38.204 } },
            },
          }),
        );
      const r = await runBuild({ ...options, includeMemo: true }, deps);
      expect(r.doc.doc.places.find((place) => place.name.includes('학사평'))).toMatchObject({
        name: '학사평',
        memo: '메모',
      });
    },
  );

  it('핀 계획을 네트워크 없이 만들고 JSON 하나와 앱이 읽는 링크를 출력한다', async () => {
    const { deps, stdout } = setup();
    expect(await main(['build', FILE, '--no-routes', '--json'], deps)).toBe(0);
    const result = JSON.parse(stdout());
    expect(stdout()).toBe(JSON.stringify(result) + '\n');
    expect(result).toMatchObject({
      ok: true,
      command: 'build',
      trip: {
        title: '속초 1박 2일',
        startDate: '2026-11-20',
        endDate: '2026-11-21',
        places: 5,
      },
      routes: { routed: 0, noRoute: 0, oldestQueriedAt: null },
      warnings: [],
    });
    expect(result.links.view).toMatch(/^https:\/\/landmark\.sch0718\.dev\/view#d=/);
    const read = await readShareHash(new URL(result.links.import).hash.slice(3));
    expect(read.ok).toBe(true);
    expect(result.days).toHaveLength(2);
    expect(result.routes.estimated).toBe(result.routes.legs - result.routes.samePoint);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('길찾기를 끄더라도 장소 조회는 가짜 fetch로 수행한다', async () => {
    const p = plan();
    p.places[1] = { key: 'tofu', naverSid: '123' };
    const { deps, stdout } = setup(JSON.stringify(p));
    expect(await main(['build', FILE, '--no-routes', '--json'], deps)).toBe(0);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout()).routes.routed).toBe(0);
  });

  it('잘못된 참조는 입력 오류와 계획 경로를 JSON으로 돌려준다', async () => {
    const p = plan();
    p.days[0]!.stops[0]!.place = 'missing';
    const { deps, stdout } = setup(JSON.stringify(p));
    expect(await main(['build', FILE, '--json'], deps)).toBe(2);
    expect(JSON.parse(stdout())).toMatchObject({
      ok: false,
      command: 'build',
      errors: [{ path: 'days[0].stops[0].place', code: 'unknown-place' }],
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each(['잘못된 JSON', 'missing'])(
    '읽기·JSON 해석 실패(%s)는 경로가 빈 입력 오류다',
    async (text) => {
      const { deps, stdout } = setup(text);
      if (text === 'missing') deps.readFile.mockRejectedValue(new Error('파일 없음'));
      expect(await main(['build', FILE, '--json'], deps)).toBe(2);
      expect(JSON.parse(stdout())).toMatchObject({
        ok: false,
        errors: [{ code: 'schema', path: '' }],
      });
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );

  it('로컬 앱 주소로 보기·가져오기 링크를 만든다', async () => {
    const { deps, stdout } = setup();
    expect(
      await main(['build', FILE, '--no-routes', '--app', 'http://localhost:8798/', '--json'], deps),
    ).toBe(0);
    const { links } = JSON.parse(stdout());
    expect(links.view).toMatch(/^http:\/\/localhost:8798\/view#d=/);
    expect(links.import).toMatch(/^http:\/\/localhost:8798\/import#d=/);
  });

  it('--schema는 파일·네트워크 없이 JSON Schema 하나를 출력한다', async () => {
    const { deps, stdout, stderr } = setup();
    expect(await main(['--schema'], deps)).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { format: { enum: ['landmark-trip-plan'] }, version: { enum: [1] } },
    });
    expect(stdout().endsWith('\n')).toBe(true);
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(stderr()).toBe('');
  });

  it('사람용 출력은 제목·기간·Day 시각·이동·추정·경고·링크를 보여 준다', async () => {
    const p = plan();
    p.places.push({ key: 'unused', name: '안 쓰는 핀', lng: 127, lat: 37 });
    const { deps, stdout } = setup(JSON.stringify(p));
    expect(await main(['build', FILE, '--no-routes'], deps)).toBe(0);
    expect(stdout()).toContain('속초 1박 2일 · 2026-11-20~2026-11-21 · 장소 5곳');
    expect(stdout()).toMatch(
      /Day 1.*2026-11-20.*학사평 순두부마을.*\d{2}:\d{2}~\d{2}:\d{2}.*이동.*추정/,
    );
    expect(stdout()).toMatch(/Day 2.*2026-11-21/);
    expect(stdout()).toContain('경고 places[5]:');
    expect(stdout()).toContain('보기: https://landmark.sch0718.dev/view#d=');
    expect(stdout()).toContain('가져오기: https://landmark.sch0718.dev/import#d=');
  });

  it('사람용 실패는 표준 오류에만 쓴다', async () => {
    const { deps, stdout, stderr } = setup('{');
    expect(await main(['build', FILE], deps)).toBe(2);
    expect(stdout()).toBe('');
    expect(stderr()).toContain('schema');
  });

  it.each([
    [],
    ['build'],
    ['build', FILE, 'extra'],
    ['build', FILE, '--unknown'],
    ['build', FILE, '--out'],
    ['--schema', FILE],
    ['build', FILE, '--schema'],
  ])('잘못된 인자 %j는 스택 없는 입력 오류다', async (...args) => {
    const { deps, stdout } = setup();
    expect(await main([...args, '--json'], deps)).toBe(2);
    expect(JSON.parse(stdout())).toMatchObject({
      ok: false,
      errors: [{ code: 'schema', path: '' }],
    });
    expect(deps.readFile).not.toHaveBeenCalled();
  });

  it.each(['send', 'share', 'unshare'])(
    '%s는 인자가 없으면 서버를 부르지 않고 끝 코드 2를 낸다',
    async (command) => {
      const { deps, stdout } = setup();
      expect(await main([command, '--json'], deps)).toBe(2);
      expect(JSON.parse(stdout())).toMatchObject({
        ok: false,
        command,
        errors: [{ code: 'schema', message: '명령에 필요한 인자를 확인해 주세요' }],
      });
      expect(deps.readFile).not.toHaveBeenCalled();
      expect(deps.fetch).not.toHaveBeenCalled();
    },
  );

  it('whoami는 토큰이 없으면 서버를 부르지 않고 끝 코드 4 no-token을 낸다', async () => {
    const { deps, stdout } = setup();
    expect(await main(['whoami', '--json'], { ...deps, platform: 'linux' })).toBe(4);
    expect(JSON.parse(stdout())).toMatchObject({
      ok: false,
      command: 'whoami',
      errors: [{ code: 'no-token' }],
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('예상 밖 예외 메시지와 스택은 출력하지 않는다', async () => {
    const { deps, stdout, stderr } = setup();
    deps.now = () => {
      throw new Error('노출하면 안 되는 내부 내용');
    };
    expect(await main(['build', FILE, '--no-routes', '--json'], deps)).toBe(1);
    expect(JSON.parse(stdout())).toMatchObject({ ok: false, errors: [{ code: 'internal' }] });
    expect(stdout() + stderr()).not.toContain('노출하면 안 되는 내부 내용');
    expect(stdout() + stderr()).not.toContain(' at ');
  });

  it('문서만 들여쓰기·끝 줄바꿈으로 쓰며 메모 옵션과 요약·경고를 보존한다', async () => {
    const p = plan();
    p.places.push({ key: 'unused', name: '안 쓰는 핀', lng: 127, lat: 37 });
    const { deps } = setup(JSON.stringify(p));
    const r = await runBuild({ ...options, includeMemo: true, out: 'doc.json' }, deps);
    expect(r.plan).toEqual(p);
    expect(r.built.now).toBe(NOW.toISOString());
    expect(r.doc.doc.places.find((place) => place.memo)?.memo).toBe('점심 대기 시간 확인');
    expect(r.days).toHaveLength(2);
    expect(r.warnings).toContainEqual(
      expect.objectContaining({ code: 'unused-place', path: 'places[5]' }),
    );
    expect(deps.writeFile).toHaveBeenCalledExactlyOnceWith(
      'doc.json',
      JSON.stringify(r.doc.doc, null, 2) + '\n',
    );
    expect(await readShareHash(r.doc.importHash)).toEqual({ ok: true, doc: hashDoc(r.doc.doc) });
    expect(JSON.parse(successJson('build', r, {}))).toMatchObject({ trip: { places: 5 } });
  });

  it('main의 --out·--memo를 전달하며 기본 메모는 뺀다', async () => {
    const { deps } = setup();
    expect(
      await main(['build', FILE, '--no-routes', '--memo', '--out', 'doc.json', '--json'], deps),
    ).toBe(0);
    expect(
      JSON.parse(deps.writeFile.mock.calls[0]![1]).places.some((p: { memo?: string }) => p.memo),
    ).toBe(true);
    const plain = setup();
    const r = await runBuild(options, plain.deps);
    expect(r.doc.doc.places.every((p) => !Object.hasOwn(p, 'memo'))).toBe(true);
    expect(plain.deps.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['plan.json', 'doc.json', '/tmp/x/plan.json', '/tmp/x/doc.json'],
    ['/tmp/input.json', '/tmp/output.json', '/tmp/input.json', '/tmp/output.json'],
  ])(
    'INIT_CWD 기준으로 계획 %s와 출력 %s 경로를 푼다',
    async (file, out, expectedFile, expectedOut) => {
      const { deps } = setup();
      deps.env = { INIT_CWD: '/tmp/x' };
      expect(await main(['build', file, '--no-routes', '--out', out, '--json'], deps)).toBe(0);
      expect(deps.readFile).toHaveBeenCalledExactlyOnceWith(expectedFile);
      expect(deps.writeFile).toHaveBeenCalledExactlyOnceWith(expectedOut, expect.any(String));
    },
  );

  it('INIT_CWD가 없으면 계획과 출력의 상대 경로를 유지한다', async () => {
    const { deps } = setup();
    expect(await main(['build', FILE, '--no-routes', '--out', 'doc.json', '--json'], deps)).toBe(0);
    expect(deps.readFile).toHaveBeenCalledExactlyOnceWith(FILE);
    expect(deps.writeFile).toHaveBeenCalledExactlyOnceWith('doc.json', expect.any(String));
  });

  it.each(['ENOENT', 'EACCES', undefined])(
    '--out 쓰기 실패(%s)는 경로와 원인 코드가 있는 입력 오류다',
    async (code) => {
      const { deps, stdout, stderr } = setup();
      deps.writeFile.mockRejectedValue(
        Object.assign(new Error('노출하면 안 되는 내부 내용'), { code }),
      );
      expect(
        await main(['build', FILE, '--no-routes', '--out', '/nonexistent/x.json', '--json'], deps),
      ).toBe(2);
      expect(JSON.parse(stdout())).toEqual({
        ok: false,
        command: 'build',
        errors: [
          {
            path: '--out',
            code: 'schema',
            message: `문서 파일을 쓰지 못했어요 (/nonexistent/x.json): ${code ?? '알 수 없는 오류'}`,
          },
        ],
      });
      expect(stdout() + stderr()).not.toContain('노출하면 안 되는 내부 내용');
      expect(stdout() + stderr()).not.toContain(' at ');
    },
  );

  it('공통 출력은 빌드 결과 없이도 추가 정보와 오류 후보를 보존한다', () => {
    const extra = { inbox: { id: '公開ID' } };
    expect(JSON.parse(successJson('whoami', null, extra))).toEqual({
      ok: true,
      command: 'whoami',
      ...extra,
    });
    expect(successText('whoami', null, extra)).toContain('公開ID');
    const issues = [
      {
        path: 'places[0]',
        code: 'ambiguous' as const,
        message: '候補を選んでください',
        candidates: [{ naverSid: '123', name: '후보', address: '주소', category: '분류' }],
      },
    ];
    expect(JSON.parse(failureJson('build', issues))).toEqual({
      ok: false,
      command: 'build',
      errors: issues,
    });
    expect(failureText(issues)).toContain('places[0]');
    expect(failureText(issues)).toContain('123');
  });

  it.each(['json', 'text'])(
    '앞뒤 공백이 있는 제목의 %s 출력은 문서의 여행 제목을 쓴다',
    async (format) => {
      const p = plan();
      p.title = '  속초 1박 2일  ';
      const { deps } = setup(JSON.stringify(p));
      const r = await runBuild(options, deps);
      const title = r.doc.doc.trips[0]!.title;
      expect(title).toBe('속초 1박 2일');
      if (format === 'json') {
        expect(JSON.parse(successJson('build', r, {})).trip.title).toBe(title);
      } else {
        expect(successText('build', r, {}).split('\n')[0]).toBe(
          `${title} · ${p.startDate}~${p.endDate} · 장소 5곳`,
        );
      }
    },
  );
});

describe('CLI 앱 출처 선택', () => {
  it('주소 우선순위와 끝 슬래시 정리를 적용한다', () => {
    expect(pickApp(undefined, {}, false)).toBe('https://landmark.sch0718.dev');
    expect(pickApp(undefined, { LANDMARK_APP_URL: 'http://localhost:8798/' }, false)).toBe(
      'http://localhost:8798',
    );
    expect(
      pickApp('https://example.com/', { LANDMARK_APP_URL: 'http://localhost:8798' }, false),
    ).toBe('https://example.com');
  });
  it('토큰 없는 데이터 링크는 외부 출처를 허용하고 토큰은 거절한다', () => {
    expect(pickApp('https://evil.example', {}, false)).toBe('https://evil.example');
    expect(() => pickApp('https://evil.example', {}, true)).toThrow(TripFailure);
    try {
      pickApp('https://evil.example', {}, true);
    } catch (error) {
      expect(error).toMatchObject({ exit: 2, issues: [{ code: 'app-origin' }] });
    }
  });
  it.each([
    'https://landmark.sch0718.dev',
    'https://preview.landmark-c5f.pages.dev',
    'http://localhost:8798',
    'http://127.0.0.1:8798',
  ])('토큰 허용 출처 %s', (app) => {
    expect(pickApp(app, {}, true)).toBe(app);
  });
  it.each([
    '잘못된 주소',
    'file:///tmp',
    'javascript:alert(1)',
    'https://example.com/path',
    'https://example.com?q=1',
    'https://example.com#fragment',
    'https://user:pass@example.com',
  ])('잘못된 앱 주소 %s', (app) => {
    expect(() => pickApp(app, {}, false)).toThrow(TripFailure);
  });
});

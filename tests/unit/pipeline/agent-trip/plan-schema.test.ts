// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Schema } from 'effect';
import { safeParse } from 'src/schema/parse';
import {
  EXIT,
  exitFor,
  TripFailure,
  type TripErrorCode,
} from '../../../../pipeline/agent-trip/errors';
import {
  parsePlan,
  planJsonSchema,
  toPlanPath,
  TripPlanSchema,
  type TripPlan,
} from '../../../../pipeline/agent-trip/plan-schema';
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/agent-trip/plan.json', import.meta.url), 'utf8'),
) as TripPlan;

const plan = (): TripPlan => structuredClone(fixture) as TripPlan;

function failure(value: unknown): TripFailure {
  try {
    parsePlan(value);
  } catch (error) {
    expect(error).toBeInstanceOf(TripFailure);
    const result = error as TripFailure;
    expect(result.exit).toBe(EXIT.input);
    expect(result.issues.length).toBeGreaterThan(0);
    return result;
  }
  throw new Error('입력 오류를 거절해야 해요');
}

const issue = (value: unknown, path: string, code: TripErrorCode = 'schema') => {
  expect(failure(value).issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ path, code })]),
  );
};

describe('계획 파일 스키마', () => {
  it('모든 장소가 핀인 고정 계획을 그대로 읽는다', () => {
    expect(parsePlan(fixture)).toEqual(fixture);
    expect(fixture.places).toHaveLength(5);
    expectTypeOf<typeof TripPlanSchema.Type>().toEqualTypeOf<TripPlan>();
    expectTypeOf(parsePlan(fixture)).toEqualTypeOf<TripPlan>();
    const codec: Schema.Codec<TripPlan, unknown> = TripPlanSchema;
    expect(safeParse(codec, fixture).success).toBe(true);
  });

  it.each(['format', 'version', 'title', 'startDate', 'endDate', 'places', 'days'] as const)(
    '필수 필드 %s가 없으면 거절한다',
    (field) => {
      const value: Record<string, unknown> = { ...plan() };
      delete value[field];
      issue(value, field);
    },
  );

  it.each([
    ['format', '다른 계획'],
    ['version', 2],
    ['title', ''],
    ['title', '가'.repeat(61)],
    ['startDate', '2026-02-30'],
    ['startDate', '2026-2-01'],
    ['endDate', '날짜 아님'],
  ])('%s의 잘못된 값을 거절한다: %#', (field, value) => {
    issue({ ...plan(), [field as string]: value }, field as string);
  });

  it.each([
    ['key', ''],
    ['key', '한글'],
    ['key', 'a'.repeat(41)],
    ['naverSid', ''],
    ['naverSid', '12a'],
    ['naverSid', '1'.repeat(21)],
    ['link', ''],
    ['link', 'x'.repeat(2001)],
    ['name', ''],
    ['name', '가'.repeat(101)],
    ['address', '가'.repeat(201)],
    ['memo', '가'.repeat(10001)],
    ['lng', 123.99],
    ['lng', 132.01],
    ['lng', Infinity],
    ['lng', NaN],
    ['lng', '128'],
    ['lat', 32.99],
    ['lat', 39.01],
    ['foo', true],
  ])('장소 %s의 잘못된 값을 경로로 알린다: %#', (field, value) => {
    const input = plan();
    Object.assign(input.places[0]!, { [field as string]: value });
    issue(input, `places[0].${field}`);
  });

  it.each([
    [{ q: '' }, 'q'],
    [{ q: '가'.repeat(41) }, 'q'],
    [{ q: '식당', near: [123, 38] }, 'near[0]'],
    [{ q: '식당', near: [128, 40] }, 'near[1]'],
    [{ q: '식당', near: [128] }, 'near[1]'],
    [{ q: '식당', near: [128, 38, 1] }, 'near[2]'],
    [{ q: '식당', foo: true }, 'foo'],
  ] as const)('검색의 잘못된 값을 거절한다: %#', (search, path) => {
    const input = plan();
    Object.assign(input.places[0]!, { search });
    issue(input, `places[0].search.${path}`);
  });

  it.each([0, 201])('장소 %i개를 거절한다', (count) => {
    const input = plan();
    input.places = Array.from({ length: count }, (_, i) => ({ ...input.places[0]!, key: `p${i}` }));
    issue(input, 'places');
  });

  it.each([
    ['stayMin', -1],
    ['stayMin', 1441],
    ['stayMin', 0.5],
    ['fixedTime', '24:00'],
    ['note', '가'.repeat(501)],
    ['foo', true],
  ])('Stop %s의 잘못된 값을 거절한다: %#', (field, value) => {
    const input = plan();
    Object.assign(input.days[0]!.stops[0]!, { [field as string]: value });
    issue(input, `days[0].stops[0].${field}`);
  });

  it('Day·최상위의 모르는 필드와 잘못된 시간을 거절한다', () => {
    const input = { ...plan(), foo: true };
    Object.assign(input.days[0]!, { startTime: '9:00', foo: true });
    const errors = failure(input).issues;
    for (const path of ['foo', 'days[0].foo', 'days[0].startTime']) {
      expect(errors).toContainEqual(expect.objectContaining({ path, code: 'schema' }));
    }
  });

  it.each([{ naverSid: '1' }, { link: 'x' }, { search: { q: '식당' } }])(
    '출처 하나면 대체 이름·좌표 없이 통과한다: %#',
    (source) => {
      const input = plan();
      input.places[2] = { key: 'market', ...source };
      expect(parsePlan(input)).toEqual(input);
    },
  );

  it.each([
    { naverSid: '1', link: 'x' },
    { naverSid: '1', search: { q: '식당' } },
    { link: 'x', search: { q: '식당' } },
  ])('장소 출처가 둘이면 거절한다: %#', (sources) => {
    const input = plan();
    Object.assign(input.places[2]!, sources);
    issue(input, 'places[2]');
  });

  it.each(['name', 'lng', 'lat'] as const)('핀의 %s가 없으면 거절한다', (field) => {
    const input = plan();
    delete input.places[2]![field];
    issue(input, 'places[2]');
  });

  it('경계값과 생략 가능한 값·null을 허용한다', () => {
    const input = plan();
    input.title = '가'.repeat(60);
    Object.assign(input.places[0]!, {
      name: '가'.repeat(100),
      address: '가'.repeat(200),
      memo: '가'.repeat(10000),
      lng: 124,
      lat: 33,
    });
    Object.assign(input.places[1]!, { naverSid: '1'.repeat(20), lng: 132, lat: 39 });
    Object.assign(input.places[2]!, { link: 'x'.repeat(2000) });
    Object.assign(input.places[3]!, { search: { q: '가'.repeat(40), near: [124, 39] } });
    Object.assign(input.places[4]!, { key: 'a'.repeat(40) });
    input.days[0]!.lodging = null;
    Object.assign(input.days[0]!.stops[0]!, {
      stayMin: 0,
      fixedTime: '00:00',
      note: '가'.repeat(500),
    });
    Object.assign(input.days[0]!.stops[1]!, { stayMin: 1440, fixedTime: '23:59' });
    input.days[1]!.stops[0]!.stayMin = null;
    input.origin = null;
    delete input.days[1]!.startTime;
    delete input.candidates;
    expect(parsePlan(input)).toEqual(input);
  });
});

describe('계획 파일 의미 검사', () => {
  it('같은 key는 뒤 장소의 key 경로로 거절한다', () => {
    const input = plan();
    input.places[2]!.key = 'tofu';
    issue(input, 'places[2].key');
  });

  it('같은 네이버 sid는 뒤 장소 경로로 거절한다', () => {
    const input = plan();
    input.places[1]!.naverSid = '123';
    input.places[2]!.naverSid = '123';
    issue(input, 'places[2].naverSid', 'duplicate-sid');
  });

  it('모든 참조의 없는 key 오류를 한 번에 모은다', () => {
    const input = plan();
    input.origin = 'missing';
    input.days[0]!.lodging = 'missing';
    input.days[1]!.stops[0]!.place = 'missing';
    input.candidates = ['absent'];
    expect(failure(input).issues.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: 'origin', code: 'unknown-place' },
      { path: 'days[0].lodging', code: 'unknown-place' },
      { path: 'days[1].stops[0].place', code: 'unknown-place' },
      { path: 'candidates[0]', code: 'unknown-place' },
    ]);
  });

  it.each(['2026-11-19', '2026-12-20'])('1~30일 밖의 기간을 거절한다: %s', (endDate) => {
    issue({ ...plan(), endDate }, 'endDate');
  });

  it('기간과 Day 개수 불일치를 알린다', () => {
    const errors = failure({ ...plan(), endDate: '2026-11-22' }).issues;
    expect(errors).toContainEqual({
      path: 'days',
      code: 'day-count',
      message: '기간은 3일인데 days가 2개예요',
    });
  });

  it.each([1, 30])('기간 %i일의 경계값을 허용한다', (count) => {
    const input = plan();
    input.endDate = count === 1 ? '2026-11-20' : '2026-12-19';
    input.days = Array.from({ length: count }, () => ({ stops: [] }));
    expect(parsePlan(input)).toEqual(input);
  });

  it.each(['Stop', '후보', 'Stop과 후보'])('%s에서 중복이면 두 번째 경로를 알린다', (kind) => {
    const input = plan();
    let path: string;
    if (kind === 'Stop') {
      input.days[1]!.stops[0]!.place = 'tofu';
      path = 'days[1].stops[0].place';
    } else {
      input.candidates = kind === '후보' ? ['hotel', 'hotel'] : ['tofu'];
      path = kind === '후보' ? 'candidates[1]' : 'candidates[0]';
    }
    issue(input, path, 'duplicate-in-trip');
  });

  it('출발지·숙소의 중복은 허용한다', () => {
    const input = plan();
    input.days[0]!.lodging = 'tofu';
    input.days[1]!.lodging = 'tofu';
    input.origin = 'tofu';
    expect(parsePlan(input)).toEqual(input);
  });

  it('참조가 하나도 없으면 no-places다', () => {
    const input = plan();
    delete input.origin;
    input.days = [{ stops: [] }, { lodging: null, stops: [] }];
    delete input.legModes;
    issue(input, 'days', 'no-places');
  });

  it.each(['origin', 'lodging', 'stop', 'candidate'])('%s 참조 하나만 있어도 통과한다', (kind) => {
    const input = plan();
    delete input.origin;
    delete input.legModes;
    input.days = [{ stops: [] }, { stops: [] }];
    if (kind === 'origin') input.origin = 'gangnam';
    if (kind === 'lodging') input.days[0]!.lodging = 'hotel';
    if (kind === 'stop') input.days[0]!.stops = [{ place: 'tofu' }];
    if (kind === 'candidate') input.candidates = ['market'];
    expect(parsePlan(input)).toEqual(input);
  });

  it.each(['tofu', '>beach', 'tofu>', 'tofu>beach>hotel', 'missing>beach', 'tofu>missing'])(
    'legModes의 잘못된 키 %s를 알린다',
    (key) => {
      issue(
        { ...plan(), legModes: { [key]: 'walk' } },
        `legModes[${JSON.stringify(key)}]`,
        'leg-modes',
      );
    },
  );

  it('이웃 쌍 검사는 장소 순서가 정해지는 뒤 단계로 남긴다', () => {
    const input = { ...plan(), legModes: { 'gangnam>market': 'car' as const } };
    expect(parsePlan(input)).toEqual(input);
  });

  it('의미 오류를 서로 다른 규칙에서도 모은다', () => {
    const input = plan();
    delete input.places[2]!.name;
    input.days[1]!.stops[0]!.place = 'missing';
    input.endDate = '2026-11-22';
    const errors = failure(input).issues;
    for (const [path, code] of [
      ['places[2]', 'schema'],
      ['days[1].stops[0].place', 'unknown-place'],
      ['days', 'day-count'],
    ]) {
      expect(errors).toContainEqual(expect.objectContaining({ path, code }));
    }
  });
});

describe('계획 오류 경로와 JSON Schema', () => {
  it.each([
    ['days.0.stops.2.place', 'days[0].stops[2].place'],
    ['', ''],
    ['places.10.key', 'places[10].key'],
    ['legModes.tofu>beach', 'legModes["tofu>beach"]'],
  ])('%s 경로를 변환한다', (path, expected) => {
    expect(toPlanPath(path)).toBe(expected);
  });

  it('표준 문서 루트·닫힌 Struct·값 제한이 있는 Record를 내보낸다', () => {
    const document = planJsonSchema();
    const root = document as {
      $schema: string;
      properties: Record<string, unknown>;
      additionalProperties: boolean;
      $defs: Record<string, unknown>;
    };
    const resolve = (value: unknown): Record<string, unknown> => {
      const schema = value as Record<string, unknown>;
      return typeof schema.$ref === 'string'
        ? resolve(root.$defs[schema.$ref.split('/').at(-1)!])
        : schema;
    };
    expect(root.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(root.additionalProperties).toBe(false);
    const places = resolve(root.properties.places);
    expect(places.type).toBe('array');
    expect(resolve(places.items).additionalProperties).toBe(false);
    const modes = resolve(root.properties.legModes);
    expect(modes.type).toBe('object');
    expect(resolve(modes.additionalProperties).enum).toEqual(['car', 'walk']);
    expect(parsePlan({ ...plan(), legModes: { 'tofu>beach': 'car' } }).legModes).toEqual({
      'tofu>beach': 'car',
    });
    issue({ ...plan(), legModes: { 'tofu>beach': 'bike' } }, 'legModes["tofu>beach"]');
  });
});

describe('오류 끝 코드', () => {
  it.each<[TripErrorCode, number]>([
    ['schema', 2],
    ['unknown-place', 2],
    ['unknown-share', 2],
    ['share-store-full', 2],
    ['app-origin', 2],
    ['too-big', 2],
    ['unused-place', 2],
    ['share-store', 2],
    ['lookup-failed', 3],
    ['ambiguous', 3],
    ['not-found', 3],
    ['no-token', 4],
    ['unauthorized', 4],
    ['token-expired', 4],
    ['token-revoked', 4],
    ['not-allowed', 4],
    ['scope', 4],
    ['delete-token', 4],
    ['inbox-full', 5],
    ['rate-limited', 5],
    ['off', 5],
    ['config', 5],
    ['old-server', 5],
    ['offline', 5],
    ['timeout', 5],
    ['server', 5],
    ['internal', 1],
  ])('%s는 끝 코드 %i다', (code, expected) => {
    expect(exitFor(code)).toBe(expected);
  });

  it('TripFailure는 오류 목록과 끝 코드를 보존한다', () => {
    const issues = [{ path: '', code: 'internal' as const, message: '계획을 만들지 못했어요' }];
    const error = new TripFailure(issues, EXIT.internal);
    expect(error).toBeInstanceOf(Error);
    expect(error.issues).toBe(issues);
    expect(error.exit).toBe(1);
    expect(error.message).toContain(issues[0]!.message);
  });
});

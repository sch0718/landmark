import { describe, expect, it } from 'vitest';
import {
  assertEditLayerSize,
  editLayerByteLength,
  EditLayerSchema,
  newEditLayer,
  serializeEditLayerFile,
  type EditLayer,
} from 'src/schema/edit-layer';
import { makeEdit, sid, withBulkyMemos } from '../../fixtures/builders';

const NOW = '2026-10-03T01:00:00.000Z';
const stop = (id: string) => ({ id, placeKey: 'n:1' });
const stops = (n: number) =>
  Array.from({ length: n }, (_, i) => stop(`s${String(i).padStart(3, '0')}`));
const override = (list: { id: string; placeKey: string }[]) => ({
  mode: 'override' as const,
  stops: list,
  baseDayHash: 'abc',
  updatedAt: NOW,
});
const memoOf = (text: string | null, key = 'a-local') => ({
  memos: { [key]: { text, updatedAt: NOW } },
});
const tagsOf = (value: string[]) => ({ memos: {}, tags: { value, updatedAt: NOW } });
const categoryOf = (value: string | null) => ({
  memos: {},
  category: { value, updatedAt: NOW },
});
const tagList = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

const cases: { name: string; mutate: (e: EditLayer) => void; ok: boolean }[] = [
  { name: '기본값 통과', mutate: () => {}, ok: true },
  {
    name: 'memos 키가 authors에 없으면 거부',
    mutate: (e) => {
      e.places['n:1'] = memoOf('x', 'ghost');
    },
    ok: false,
  },
  {
    name: 'memos 키가 authors에 있으면 통과',
    mutate: (e) => {
      e.places['n:1'] = memoOf('x');
    },
    ok: true,
  },
  {
    name: '삭제 툼스톤(text null) 통과',
    mutate: (e) => {
      e.places['n:1'] = memoOf(null);
    },
    ok: true,
  },
  {
    name: '메모 2000자 통과',
    mutate: (e) => {
      e.places['n:1'] = memoOf('a'.repeat(2000));
    },
    ok: true,
  },
  {
    name: '메모 2001자 거부',
    mutate: (e) => {
      e.places['n:1'] = memoOf('a'.repeat(2001));
    },
    ok: false,
  },
  {
    name: '태그 20개 통과',
    mutate: (e) => {
      e.places['n:1'] = tagsOf(tagList(20));
    },
    ok: true,
  },
  {
    name: '태그 21개 거부',
    mutate: (e) => {
      e.places['n:1'] = tagsOf(tagList(21));
    },
    ok: false,
  },
  {
    name: '태그 30자 통과',
    mutate: (e) => {
      e.places['n:1'] = tagsOf(['a'.repeat(30)]);
    },
    ok: true,
  },
  {
    name: '태그 31자 거부',
    mutate: (e) => {
      e.places['n:1'] = tagsOf(['a'.repeat(31)]);
    },
    ok: false,
  },
  {
    name: 'override 안 stop id 중복 거부',
    mutate: (e) => {
      e.days['2026-11-14'] = override([stop(sid('X')), stop(sid('X'))]);
    },
    ok: false,
  },
  {
    name: 'stop 50개 통과',
    mutate: (e) => {
      e.days['2026-11-14'] = override(stops(50));
    },
    ok: true,
  },
  {
    name: 'stop 51개 거부',
    mutate: (e) => {
      e.days['2026-11-14'] = override(stops(51));
    },
    ok: false,
  },
  {
    name: 'authors 50명 통과',
    mutate: (e) => {
      for (let i = 0; i < 49; i++) e.authors[`a${i}`] = { nickname: `n${i}`, updatedAt: NOW };
    },
    ok: true,
  },
  {
    name: 'authors 51명 거부',
    mutate: (e) => {
      for (let i = 0; i < 50; i++) e.authors[`a${i}`] = { nickname: `n${i}`, updatedAt: NOW };
    },
    ok: false,
  },
  {
    name: 'reset 통과',
    mutate: (e) => {
      e.days['2026-11-14'] = { mode: 'reset', updatedAt: NOW };
    },
    ok: true,
  },
  {
    name: 'reset에 stops가 있으면 거부',
    mutate: (e) => {
      e.days['2026-11-14'] = { mode: 'reset', updatedAt: NOW, stops: [] } as never;
    },
    ok: false,
  },
  {
    name: '실제 날짜가 아닌 days 키 거부',
    mutate: (e) => {
      e.days['2026-02-30'] = { mode: 'reset', updatedAt: NOW };
    },
    ok: false,
  },
  {
    name: '분류 생략 통과',
    mutate: (e) => {
      e.places['n:1'] = { memos: {} };
    },
    ok: true,
  },
  {
    name: '분류 덮어쓰기 통과',
    mutate: (e) => {
      e.places['n:1'] = categoryOf('숙소');
    },
    ok: true,
  },
  {
    name: '분류 원본으로 되돌림(value null) 통과',
    mutate: (e) => {
      e.places['n:1'] = categoryOf(null);
    },
    ok: true,
  },
  {
    name: '분류 30자 통과',
    mutate: (e) => {
      e.places['n:1'] = categoryOf('a'.repeat(30));
    },
    ok: true,
  },
  {
    name: '분류 빈 문자열 거부',
    mutate: (e) => {
      e.places['n:1'] = categoryOf('');
    },
    ok: false,
  },
  {
    name: '분류 공백만 거부',
    mutate: (e) => {
      e.places['n:1'] = categoryOf('   ');
    },
    ok: false,
  },
  {
    name: '분류 31자 거부',
    mutate: (e) => {
      e.places['n:1'] = categoryOf('a'.repeat(31));
    },
    ok: false,
  },
];

describe('EditLayerSchema', () => {
  it.each(cases)('$name', ({ mutate, ok }) => {
    const e = structuredClone(makeEdit());
    mutate(e);
    expect(EditLayerSchema.safeParse(e).success).toBe(ok);
  });

  it('makeEdit()이 스키마를 통과한다', () => {
    expect(EditLayerSchema.safeParse(makeEdit()).success).toBe(true);
  });

  it('makeEdit overrides를 적용한다', () => {
    expect(makeEdit({ authorId: 'b' }).authorId).toBe('b');
  });

  it('memos 오류는 경로를 가리킨다', () => {
    const e = makeEdit();
    e.places['n:1'] = memoOf('x', 'ghost');
    const r = EditLayerSchema.safeParse(e);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['places', 'n:1', 'memos', 'ghost']);
  });

  it('newEditLayer는 작성자를 authors에 넣고 비어 있는 레이어를 만든다', () => {
    const e = newEditLayer({
      publicId: 'k3f9x2a7q1',
      baseDataVersion: NOW,
      authorId: 'u1',
      nickname: '나',
      now: NOW,
    });
    expect(e).toEqual({
      schemaVersion: 1,
      publicId: 'k3f9x2a7q1',
      baseDataVersion: NOW,
      authorId: 'u1',
      authors: { u1: { nickname: '나', updatedAt: NOW } },
      places: {},
      days: {},
    });
    expect(EditLayerSchema.safeParse(e).success).toBe(true);
  });
});

describe('editLayerByteLength', () => {
  it('내보내기 파일(들여쓴 JSON)의 UTF-8 바이트 수를 센다', () => {
    const e = withBulkyMemos(makeEdit(), 1, 1);
    const blob = new Blob([serializeEditLayerFile(e)]);
    expect(editLayerByteLength(e)).toBe(blob.size);
    expect(editLayerByteLength(e)).toBeGreaterThan(6000);
  });

  it('assertEditLayerSize는 1MB 이하면 통과, 넘으면 throw', () => {
    expect(() => assertEditLayerSize(withBulkyMemos(makeEdit(), 1, 90))).not.toThrow();
    expect(() => assertEditLayerSize(withBulkyMemos(makeEdit(), 1, 180))).toThrow('1MB');
  });
});

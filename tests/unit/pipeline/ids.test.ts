import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { ensureIds } from '../../../pipeline/ids';

const YAML = `title: 속초
startDate: 2026-10-10
days:
  - date: 2026-10-10
    stops:
      - place: "1" # 점심
      - place: home
`;

function seqRandom(values: string[]) {
  let i = 0;
  return () => values[i++] ?? 'zzzz';
}

describe('ensureIds', () => {
  it('publicId와 stop id를 쓰고 주석을 보존하며 두 번째 실행은 changed:false', () => {
    const doc = parseDocument(YAML);
    let n = 0;
    const random = (len: number) => String(n++).padStart(len, 'a').slice(-len);
    expect(ensureIds(doc, random)).toEqual({ changed: true });
    expect(doc.toString()).toContain('# 점심');
    const js = doc.toJS() as {
      publicId: string;
      startDate: string;
      days: { stops: { id: string }[] }[];
    };
    expect(js.publicId).toMatch(/^[a-z0-9]{10}$/);
    expect(js.startDate).toBe('2026-10-10');
    for (const s of js.days[0]!.stops) expect(s.id).toMatch(/^[a-z0-9]{4}$/);
    expect(ensureIds(doc, random)).toEqual({ changed: false });
  });

  it('기존 stop id와 충돌하면 다시 뽑는다', () => {
    const doc = parseDocument(`days:
  - date: 2026-10-10
    stops:
      - { id: abcd, place: "1" }
      - { place: "2" }
`);
    ensureIds(doc, seqRandom(['pubid12345', 'abcd', 'wxyz']));
    const js = doc.toJS() as { days: { stops: { id: string }[] }[] };
    expect(js.days[0]!.stops.map((s) => s.id)).toEqual(['abcd', 'wxyz']);
  });

  it('한 실행 안에서 새로 만든 id끼리도 충돌하지 않는다', () => {
    const doc = parseDocument(`days:
  - date: 2026-10-10
    stops:
      - { place: "1" }
      - { place: "2" }
`);
    ensureIds(doc, seqRandom(['pubid12345', 'same', 'same', 'diff']));
    const js = doc.toJS() as { days: { stops: { id: string }[] }[] };
    expect(js.days[0]!.stops.map((s) => s.id)).toEqual(['same', 'diff']);
  });
});

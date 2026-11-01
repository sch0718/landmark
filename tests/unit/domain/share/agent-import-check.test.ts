// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stableStringify } from 'src/domain/library-sync/items';
import { importedItemProblem, oversizedItems } from 'src/domain/share/agent-import-check';
import { emptyLibrary, type Library } from 'src/schema/library';
import type { ShareDocV2 } from 'src/schema/share';
import { importedAgentLibrary, largeAgentDoc } from '../../../helpers/agent-import-doc';

const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
  ) as ShareDocV2;

describe('가져온 항목 검사', () => {
  it('정상 고정 문서는 통과하며 입력을 바꾸지 않는다', () => {
    const doc = fixture();
    const before = structuredClone(doc);
    expect(importedItemProblem(doc)).toBeNull();
    expect(doc).toEqual(before);
    expect(importedItemProblem(doc)).toBeNull();
  });

  it('줄바꿈 메모로 가져온 여행이 동기화 크기 상한을 넘으면 item-too-large이다', () => {
    expect(importedItemProblem(largeAgentDoc())).toBe('item-too-large');
  });

  it('가져오기를 실패하면 import이다', () => {
    const doc = fixture();
    doc.trips[0]!.endDate = '2026-11-01';
    expect(importedItemProblem(doc)).toBe('import');
  });
});

describe('동기화 항목 크기', () => {
  it('빈 보관함에는 초과 항목이 없다', () => {
    expect(oversizedItems(emptyLibrary(), 0)).toEqual([]);
  });

  it.each(['place', 'label', 'trip'] as const)(
    '%s는 정확한 상한까지 받고 1자 초과부터 키를 돌려준다',
    (kind) => {
      const lib = importedAgentLibrary(fixture());
      const collection = kind === 'place' ? 'places' : kind === 'label' ? 'labels' : 'trips';
      const [id, item] = Object.entries(lib[collection])[0]!;
      const isolated: Library = { ...emptyLibrary(), [collection]: { [id]: item } };
      const size = stableStringify(item).length;
      expect(oversizedItems(isolated, size)).toEqual([]);
      expect(oversizedItems(isolated, size - 1)).toEqual([`${kind}:${id}`]);
    },
  );
});

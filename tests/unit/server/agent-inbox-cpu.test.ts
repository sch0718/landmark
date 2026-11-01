// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as codec from 'src/domain/codec';
import * as importCheck from 'src/domain/share/agent-import-check';
import { AGENT_INBOX_LIMITS } from 'src/domain/share/agent-limits';
import { readShareHash } from 'src/domain/share/read-share';
import * as parse from 'src/schema/parse';
import type { ShareDocV2 } from 'src/schema/share';
import { checkInboxDoc } from 'src/server/agent/inbox';
import { encodeShareHash, hashDoc } from 'src/share-viewer/encode';
import { largeAgentDoc } from '../../helpers/agent-import-doc';

const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../fixtures/agent-trip/doc.json', import.meta.url), 'utf8'),
  ) as ShareDocV2;

afterEach(() => vi.restoreAllMocks());

describe('받은함 CPU 회귀 방지', () => {
  it.each(['too-many', 'labels', 'path', 'leg-modes'] as const)(
    '%s 공격을 스키마 검사와 모의 가져오기 전에 거절한다',
    async (reason) => {
      const doc = fixture();
      if (reason === 'too-many') {
        // 관계도 틀린 문서: 값싼 장소 수 검사가 관계 검사보다 앞서야 한다.
        doc.places = Array.from({ length: 5000 }, (_, i) => ({
          id: `p${i}`,
          name: 'a',
          address: '',
          lng: 0,
          lat: 0,
          labelIds: [],
        }));
      } else if (reason === 'labels') {
        doc.labels = [{ id: 'l', name: '라벨', color: 'blue', order: 0 }];
      } else if (reason === 'path') {
        // 384KB 안에서 점 40,000개의 스키마 순회를 유발하는 입력.
        doc.trips[0]!.days[0]!.legs[0]!.path = Array.from({ length: 40_000 }, () => [0, 0]);
      } else {
        doc.trips[0]!.legModes = Object.fromEntries(
          Array.from({ length: 6700 }, (_, i) => [`p${i}>q`, 'car' as const]),
        );
      }
      expect(new TextEncoder().encode(JSON.stringify(doc)).byteLength).toBeLessThan(
        AGENT_INBOX_LIMITS.decodedBytes,
      );
      // hashDoc은 경로선을 지우므로 원시 입력을 그대로 압축한다.
      const d = await codec.encodeCompressedJson(doc);
      expect(d.length).toBeLessThanOrEqual(AGENT_INBOX_LIMITS.hashChars);
      const schema = vi.spyOn(parse, 'safeParse');
      const simulate = vi.spyOn(importCheck, 'importedItemProblem');
      const decode = vi.spyOn(codec, 'decodeCompressedJson');
      await expect(checkInboxDoc(d)).rejects.toMatchObject({
        status: 422,
        code: 'invalid',
        extra: { reason },
      });
      expect(schema).not.toHaveBeenCalled();
      expect(simulate).not.toHaveBeenCalled();
      expect(decode).toHaveBeenCalledExactlyOnceWith(d, {
        maxChars: AGENT_INBOX_LIMITS.hashChars,
        maxBytes: AGENT_INBOX_LIMITS.decodedBytes,
      });
    },
  );

  it('앱도 장소 한도를 스키마보다 먼저 검사하되 newer가 우선한다', async () => {
    const doc = { ...fixture(), places: Array.from({ length: 1001 }, () => null) };
    const d = await codec.encodeCompressedJson(doc);
    const newer = await codec.encodeCompressedJson({ ...doc, version: 3 });
    const schema = vi.spyOn(parse, 'safeParse');
    expect(await readShareHash(d)).toEqual({ ok: false, error: 'too-many' });
    expect(await readShareHash(newer)).toEqual({ ok: false, error: 'newer' });
    expect(schema).not.toHaveBeenCalled();
  });

  it('정상 문서는 한 번만 풀고 스키마와 실제 모의 가져오기를 실행한다', async () => {
    const d = await encodeShareHash(hashDoc(fixture()));
    const decode = vi.spyOn(codec, 'decodeCompressedJson');
    const schema = vi.spyOn(parse, 'safeParse');
    const simulate = vi.spyOn(importCheck, 'importedItemProblem');
    await expect(checkInboxDoc(d)).resolves.toMatchObject({ places: 5 });
    expect(decode).toHaveBeenCalledTimes(1);
    expect(schema).toHaveBeenCalled();
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it('상한 정상 문서가 384KB 안이며 검증 중앙값이 압축 해제의 12배 이하다', async () => {
    const doc = largeAgentDoc();
    const raw = hashDoc(doc);
    expect(new TextEncoder().encode(JSON.stringify(raw)).byteLength).toBeLessThan(393_216);
    const d = await encodeShareHash(raw);
    const decode = () =>
      codec.decodeCompressedJson(d, {
        maxChars: AGENT_INBOX_LIMITS.hashChars,
        maxBytes: AGENT_INBOX_LIMITS.decodedBytes,
      });
    const check = async () => {
      // 문서 자체는 유효하지만 모의 가져온 여행의 동기화 크기 검사는 끝까지 수행한다.
      try {
        await checkInboxDoc(d);
        throw new Error('동기화 상한 초과 문서를 허용함');
      } catch (error) {
        expect(error).toMatchObject({ status: 422, extra: { reason: 'item-too-large' } });
      }
    };
    const measure = async (run: () => Promise<unknown>) => {
      const started = performance.now();
      await run();
      return performance.now() - started;
    };
    for (let i = 0; i < 5; i++) {
      await decode();
      await check();
    }
    const decodes: number[] = [];
    const checks: number[] = [];
    for (let i = 0; i < 15; i++) {
      // 순서를 번갈아 바꿔 GC·실행 순서에 따른 편향을 줄인다.
      if (i % 2 === 0) {
        decodes.push(await measure(decode));
        checks.push(await measure(check));
      } else {
        checks.push(await measure(check));
        decodes.push(await measure(decode));
      }
    }
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    // 수정 전 로컬 warm 측정은 전체 4.47~5.10ms / 풀기 1.15~1.24ms(약 4배).
    // CI 부하·모의 가져오기 비용을 감안해 12배로 넉넉히 제한한다.
    expect(median(checks) / median(decodes)).toBeLessThanOrEqual(12);
  });
});

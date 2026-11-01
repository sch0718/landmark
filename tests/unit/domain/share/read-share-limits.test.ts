import { describe, expect, it } from 'vitest';
import { AGENT_INBOX_LIMITS } from 'src/domain/share/agent-limits';
import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import {
  readShareHash,
  SHARE_IMPORT_LIMITS,
  type ShareReadLimits,
} from 'src/domain/share/read-share';
import type { ShareDocV2 } from 'src/schema/share';
import { encodeShareHash } from 'src/share-viewer/encode';
import { buildLiveLibrary } from '../../../fixtures/builders';

const a: ShareReadLimits = SHARE_IMPORT_LIMITS;
const b: ShareReadLimits = AGENT_INBOX_LIMITS;

function makeDoc(count = 2): ShareDocV2 {
  const base = buildLiveLibrary();
  const sample = base.places.place00001!;
  const places = Object.fromEntries(
    Array.from({ length: count }, (_, i) => {
      const id = `place${String(i + 1).padStart(5, '0')}`;
      return [id, { ...sample, id, source: { kind: 'naver' as const, sid: String(i + 1) } }];
    }),
  );
  const trip = base.trips.trip000001!;
  const lib = {
    ...base,
    places,
    trips: {
      ...base.trips,
      trip000001: {
        ...trip,
        candidates: { ...trip.candidates, value: Object.keys(places).slice(2) },
      },
    },
  };
  return buildTripShareDoc(
    lib,
    'trip000001',
    () => {
      throw new Error('이 시험 문서에는 이동 구간이 없어야 한다');
    },
    {
      title: '한도 시험',
      includeMemo: true,
      includeCandidates: true,
      now: new Date('2026-11-01T00:00:00.000Z'),
    },
  )!;
}

describe('공유 해시 읽기 한도', () => {
  it('장소 201곳은 기본 한도에서 읽히고 받은함 한도에서는 too-many다', async () => {
    const doc = makeDoc(201);
    const hash = await encodeShareHash(doc);
    expect(await readShareHash(hash)).toEqual({ ok: true, doc });
    expect(await readShareHash(hash, b)).toEqual({ ok: false, error: 'too-many' });
  });

  it('장소 200곳은 받은함 한도에서도 읽힌다', async () => {
    const doc = makeDoc(200);
    expect(await readShareHash(await encodeShareHash(doc), b)).toEqual({ ok: true, doc });
  });

  it.each([1_048_576, 1_048_577])(
    '압축 해제 후 %i바이트에서 받은함 상한을 지킨다',
    async (bytes) => {
      const doc = makeDoc();
      doc.places[0]!.memo = '';
      const baseBytes = new TextEncoder().encode(JSON.stringify(doc)).byteLength;
      doc.places[0]!.memo = 'a'.repeat(bytes - baseBytes);
      expect(new TextEncoder().encode(JSON.stringify(doc)).byteLength).toBe(bytes);
      const hash = await encodeShareHash(doc);
      expect(await readShareHash(hash, a)).toEqual({ ok: true, doc });
      expect(await readShareHash(hash, b)).toEqual(
        bytes > b.decodedBytes ? { ok: false, error: 'corrupt' } : { ok: true, doc },
      );
    },
  );

  it('받은 hashChars 한도를 압축 해제에 적용한다', async () => {
    const hash = await encodeShareHash(makeDoc());
    expect(await readShareHash(hash, { ...a, hashChars: hash.length - 1 })).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });
});

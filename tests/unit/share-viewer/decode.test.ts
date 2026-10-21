import { describe, expect, it } from 'vitest';
import { encodeCompressedJson } from 'src/domain/codec';
import { readShareHash } from 'src/domain/share/read-share';
import { decodeShareHash } from 'src/share-viewer/decode';
import { makeShareV2Doc } from '../helpers/share-v2-doc';

describe('보기 화면 해시 풀기', () => {
  it('한글·이모지·<와 v2 경로선을 보존한다', async () => {
    const doc = makeShareV2Doc();
    doc.title = '서울 ☕ <여행>';
    doc.places[0]!.memo = '메모 🥐 <b>그대로</b>';
    expect(await decodeShareHash(await encodeCompressedJson(doc))).toEqual(doc);
  });

  it.each(['', '!!', 'a', 'A'.repeat(32_001)])('손상·초과 값은 null이다: %.20s', async (value) => {
    expect(await decodeShareHash(value)).toBeNull();
  });

  it('풀린 UTF-8 바이트가 5MB를 넘으면 거절한다', async () => {
    const doc = makeShareV2Doc();
    doc.places[0]!.memo = '가'.repeat(1_747_627);
    const value = await encodeCompressedJson(doc);
    expect(value.length).toBeLessThan(32_000);
    expect(await decodeShareHash(value)).toBeNull();
  });

  it.each([
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, extra: true }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, places: [] }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, places: [...d.places, d.places[0]] }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, labels: [...d.labels, d.labels[0]] }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, version: 3 }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, createdAt: '어제' }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, places: [{ ...d.places[0], lat: 90 }] }),
    (d: ReturnType<typeof makeShareV2Doc>) => ({ ...d, trips: [{ ...d.trips[0], extra: true }] }),
  ])('앱이 거절하는 문서는 보기 화면도 거절한다', async (change) => {
    const value = await encodeCompressedJson(change(makeShareV2Doc()));
    expect((await readShareHash(value)).ok).toBe(false);
    expect(await decodeShareHash(value)).toBeNull();
  });

  it('v1도 날짜·좌표·장소 수·모르는 필드를 검사한다', async () => {
    const source = makeShareV2Doc();
    const doc = {
      format: source.format,
      version: 1,
      title: source.title,
      createdAt: source.createdAt,
      labels: source.labels,
      places: source.places.map((p) => {
        const out = { ...p };
        delete out.review;
        return out;
      }),
    };
    const value = await encodeCompressedJson(doc);
    expect(await decodeShareHash(value)).toEqual(doc);
    for (const invalid of [
      { ...doc, createdAt: '어제' },
      { ...doc, places: [{ ...doc.places[0], lat: 90 }] },
      { ...doc, places: [{ ...doc.places[0], review: '모르는 필드' }] },
      {
        ...doc,
        places: Array.from({ length: 1001 }, (_, i) => ({ ...doc.places[0], id: `p${i}` })),
      },
    ]) {
      expect(await decodeShareHash(await encodeCompressedJson(invalid))).toBeNull();
    }
  });
});

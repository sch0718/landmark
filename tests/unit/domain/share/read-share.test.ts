import { describe, expect, it, vi } from 'vitest';
import { encodeCompressedJson } from 'src/domain/codec';
import { injectShareDoc } from 'src/domain/share/inject';
import {
  readShareFile,
  readShareHash,
  readShareHtml,
  SHARE_HASH_PREFIX,
  SHARE_IMPORT_LIMITS,
  SHARE_READ_MESSAGES,
} from 'src/domain/share/read-share';
import type { ShareDoc, SharePlace } from 'src/schema/share';

const TEMPLATE =
  '<!doctype html><html><head><script type="application/json" id="tripmap-share">__TRIPMAP_DATA__</script></head><body></body></html>';

function place(i: number, extra: Partial<SharePlace> = {}): SharePlace {
  return {
    id: `p${i}`,
    name: `장소 ${i}`,
    address: '강원 강릉시',
    lng: 124 + (i % 800) / 100,
    lat: 33 + (i % 600) / 100,
    labelIds: ['l1'],
    ...extra,
  };
}

function makeDoc(places: SharePlace[] = [place(1)]): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '강릉 여행',
    createdAt: '2026-10-11T03:04:05.678Z',
    labels: [{ id: 'l1', name: '맛집', color: 'red', order: 0 }],
    places,
  };
}

function manyPlaces(n: number): SharePlace[] {
  return Array.from({ length: n }, (_, i) => place(i));
}

const htmlBlob = (doc: unknown): Blob =>
  new Blob([TEMPLATE.replace('__TRIPMAP_DATA__', JSON.stringify(doc))], { type: 'text/html' });

describe('readShareHtml', () => {
  it('reads back the same doc (Korean, emoji, </script> in memo)', () => {
    const doc = makeDoc([
      place(1, { memo: '한글 메모 🍜 </script><!-- 끝', kakaoId: 'k1', googleId: 'g1' }),
    ]);
    const result = readShareHtml(injectShareDoc(TEMPLATE, doc));
    expect(result).toEqual({ ok: true, doc });
  });

  it('같은 id의 다른 요소가 앞에 있어도 진짜 데이터 블록을 읽는다', () => {
    const doc = makeDoc();
    const decoy = '<div id="tripmap-share">가짜 블록</div>';
    const decoyFirst = injectShareDoc(TEMPLATE, doc).replace('<head>', `<head>${decoy}`);
    expect(decoyFirst.indexOf(decoy)).toBeLessThan(decoyFirst.indexOf('<script'));
    expect(readShareHtml(decoyFirst)).toEqual({ ok: true, doc });
  });

  it('데이터 블록이 script가 아니면 not-share', () => {
    expect(readShareHtml('<html><body><div id="tripmap-share">{}</div></body></html>')).toEqual({
      ok: false,
      error: 'not-share',
    });
  });

  it('returns not-share without a data block', () => {
    expect(readShareHtml('<html><body>hi</body></html>')).toEqual({
      ok: false,
      error: 'not-share',
    });
  });
});

describe('readShareFile', () => {
  it('rejects oversize files as too-big without reading content', async () => {
    const blob = new Blob([new Uint8Array(SHARE_IMPORT_LIMITS.fileBytes + 1)]);
    const text = vi.spyOn(blob, 'text');
    expect(await readShareFile(blob)).toEqual({ ok: false, error: 'too-big' });
    expect(text).not.toHaveBeenCalled();
  });

  it('reads a valid file', async () => {
    const doc = makeDoc();
    expect(await readShareFile(htmlBlob(doc))).toEqual({ ok: true, doc });
  });

  it('returns not-share for html without a data block', async () => {
    const blob = new Blob(['<html><body></body></html>']);
    expect(await readShareFile(blob)).toEqual({ ok: false, error: 'not-share' });
  });

  it('returns corrupt for broken JSON', async () => {
    const blob = new Blob([TEMPLATE.replace('__TRIPMAP_DATA__', '{"format":')]);
    expect(await readShareFile(blob)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns corrupt for version 2', async () => {
    expect(await readShareFile(htmlBlob({ ...makeDoc(), version: 2 }))).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });

  it('returns corrupt for unknown fields on a place', async () => {
    const doc = makeDoc([{ ...place(1), extra: 'x' } as SharePlace]);
    expect(await readShareFile(htmlBlob(doc))).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns corrupt for places that share an id', async () => {
    const doc = makeDoc([place(1), place(2, { id: 'p1' })]);
    expect(await readShareFile(htmlBlob(doc))).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns corrupt for labels that share an id', async () => {
    const doc = {
      ...makeDoc(),
      labels: [
        { id: 'l1', name: '맛집', color: 'red', order: 0 },
        { id: 'l1', name: '카페', color: 'blue', order: 1 },
      ],
    };
    expect(await readShareFile(htmlBlob(doc))).toEqual({ ok: false, error: 'corrupt' });
  });

  it('checks duplicate ids before the empty and too-many limits', async () => {
    const dup = manyPlaces(1001).map((p) => ({ ...p, id: 'same' }));
    expect(await readShareFile(htmlBlob(makeDoc(dup)))).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns empty for zero places', async () => {
    expect(await readShareFile(htmlBlob(makeDoc([])))).toEqual({ ok: false, error: 'empty' });
  });

  it('returns too-many for 1,001 places', async () => {
    expect(await readShareFile(htmlBlob(makeDoc(manyPlaces(1001))))).toEqual({
      ok: false,
      error: 'too-many',
    });
  });

  it('accepts exactly 1,000 places', async () => {
    const result = await readShareFile(htmlBlob(makeDoc(manyPlaces(1000))));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.places).toHaveLength(1000);
  });
});

describe('readShareHash', () => {
  it('round-trips encodeCompressedJson', async () => {
    const doc = makeDoc([place(1, { memo: '메모 🍜' })]);
    expect(await readShareHash(await encodeCompressedJson(doc))).toEqual({ ok: true, doc });
  });

  it('returns corrupt for values over 32,000 chars', async () => {
    expect(await readShareHash('A'.repeat(SHARE_IMPORT_LIMITS.hashChars + 1))).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });

  it('returns corrupt for non-base64url input', async () => {
    expect(await readShareHash('!!!')).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns corrupt for base64url that is not compressed data', async () => {
    const plain = btoa('hello world, this is not deflate')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await readShareHash(plain)).toEqual({ ok: false, error: 'corrupt' });
  });

  it('returns corrupt for places that share an id', async () => {
    const doc = makeDoc([place(1), place(2, { id: 'p1' })]);
    expect(await readShareHash(await encodeCompressedJson(doc))).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });

  it('returns corrupt for labels that share an id', async () => {
    const doc = {
      ...makeDoc(),
      labels: [
        { id: 'l1', name: '맛집', color: 'red' as const, order: 0 },
        { id: 'l1', name: '카페', color: 'blue' as const, order: 1 },
      ],
    };
    expect(await readShareHash(await encodeCompressedJson(doc))).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });

  it('returns empty for a compressed doc with zero places', async () => {
    expect(await readShareHash(await encodeCompressedJson(makeDoc([])))).toEqual({
      ok: false,
      error: 'empty',
    });
  });
});

describe('constants', () => {
  it('hash prefix', () => {
    expect(SHARE_HASH_PREFIX).toBe('#d=');
  });

  it('SHARE_READ_MESSAGES matches the fixed copy', () => {
    expect(SHARE_READ_MESSAGES).toEqual({
      'too-big': '파일이 너무 커요',
      'not-share': 'Landmark 공유 파일이 아니에요',
      corrupt: '공유 파일을 읽지 못했어요. 파일이나 링크가 손상됐을 수 있어요',
      empty: '가져올 장소가 없는 파일이에요',
      'too-many': '장소가 너무 많은 파일이에요(최대 1,000곳)',
    });
  });
});

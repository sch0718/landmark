import { describe, expect, it } from 'vitest';
import type { ShareDoc } from 'src/schema/share';
import { parseShareDoc, readShareDoc } from 'src/share-viewer/parse';

function validDoc(): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '정자역 카페',
    createdAt: '2026-10-11T03:00:00.000Z',
    labels: [{ id: 'l1', name: '카페', color: 'orange', order: 0 }],
    places: [
      {
        id: 'p1',
        name: '서혜커피',
        address: '경기 성남시 분당구 정자동 1',
        lng: 127.1,
        lat: 37.36,
        labelIds: ['l1'],
        memo: '크로플',
        naverSid: '123',
      },
    ],
  };
}

describe('parseShareDoc', () => {
  it('정상 doc은 통과한다', () => {
    expect(parseShareDoc(validDoc())).toEqual(validDoc());
  });

  it('memo·naverSid가 없어도 통과한다', () => {
    const doc = validDoc();
    const { id, name, address, lng, lat, labelIds } = doc.places[0]!;
    doc.places = [{ id, name, address, lng, lat, labelIds }];
    expect(parseShareDoc(doc)).not.toBeNull();
  });

  it('kakaoId·googleId가 있으면 그대로 남는다', () => {
    const doc = validDoc();
    doc.places[0]!.kakaoId = '2345678';
    doc.places[0]!.googleId = '0x1a2b:0x3c4d';
    expect(parseShareDoc(doc)).toEqual(doc);
  });

  it('kakaoId·googleId가 없으면 키가 생기지 않는다', () => {
    const parsed = parseShareDoc(validDoc())!;
    expect('kakaoId' in parsed.places[0]!).toBe(false);
    expect('googleId' in parsed.places[0]!).toBe(false);
  });

  it.each(['kakaoId', 'googleId'])('%s가 문자열이 아니면 null', (key) => {
    const doc = validDoc();
    (doc.places[0] as unknown as Record<string, unknown>)[key] = 123;
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('JSON을 거친 값도 통과한다', () => {
    expect(parseShareDoc(JSON.parse(JSON.stringify(validDoc())))).not.toBeNull();
  });

  it.each([
    ['format이 다르다', { format: 'other' }],
    ['version이 2다', { version: 2 }],
    ['places가 배열이 아니다', { places: 'x' }],
    ['title이 문자열이 아니다', { title: 1 }],
    ['createdAt이 없다', { createdAt: undefined }],
    ['labels가 배열이 아니다', { labels: null }],
  ])('%s → null', (_name, patch) => {
    expect(parseShareDoc({ ...validDoc(), ...patch })).toBeNull();
  });

  it('lat이 문자열이면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { lat: unknown }).lat = '37.36';
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('lng가 유한하지 않으면 null', () => {
    const doc = validDoc();
    doc.places[0]!.lng = Number.NaN;
    expect(parseShareDoc(doc)).toBeNull();
  });

  it("라벨 color가 'black'이면 null", () => {
    const doc = validDoc();
    (doc.labels[0] as unknown as { color: string }).color = 'black';
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('labelIds에 문자열이 아닌 값이 있으면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { labelIds: unknown[] }).labelIds = [1];
    expect(parseShareDoc(doc)).toBeNull();
  });

  it('memo가 문자열이 아니면 null', () => {
    const doc = validDoc();
    (doc.places[0] as unknown as { memo: unknown }).memo = 3;
    expect(parseShareDoc(doc)).toBeNull();
  });

  it.each([null, undefined, 'x', 1, []])('객체가 아닌 %s → null', (v) => {
    expect(parseShareDoc(v)).toBeNull();
  });
});

describe('readShareDoc', () => {
  function docWithBlock(text: string | null): Document {
    const d = document.implementation.createHTMLDocument('x');
    if (text !== null) {
      const s = d.createElement('script');
      s.type = 'application/json';
      s.id = 'tripmap-share';
      s.textContent = text;
      d.body.append(s);
    }
    return d;
  }

  it('데이터 블록을 읽어 검사한다', () => {
    expect(readShareDoc(docWithBlock(JSON.stringify(validDoc())))).toEqual(validDoc());
  });

  it('블록이 없으면 null', () => {
    expect(readShareDoc(docWithBlock(null))).toBeNull();
  });

  it('JSON이 깨졌으면 null', () => {
    expect(readShareDoc(docWithBlock('{"format":'))).toBeNull();
  });

  it('형식이 맞지 않으면 null', () => {
    expect(readShareDoc(docWithBlock('{"format":"x"}'))).toBeNull();
  });
});

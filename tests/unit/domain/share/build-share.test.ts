import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { buildShareDoc } from 'src/domain/share/build-share';
import { ShareDocSchema } from 'src/schema/share';
import {
  L_FOOD,
  L_SEA,
  makePlace,
  sampleLibrary,
  T0,
  withPlaces,
} from '../../sections/library/fixtures';

const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const NOW = new Date('2026-10-11T03:04:05.678Z');
const opts = { title: '강릉 여행', includeMemo: true, now: NOW };

describe('buildShareDoc', () => {
  it('keeps the given order and drops deleted or unknown ids', () => {
    const lib = withPlaces(sampleLibrary(), [makePlace(9, { deletedAt: T0 })]);
    const doc = buildShareDoc(lib, [id(3), 'zzzzzzzzzz', id(1), id(9)], opts);
    expect(doc.places.map((p) => p.id)).toEqual([id(3), id(1)]);
  });

  it('includes only live labels used by exported places, in label order', () => {
    const doc = buildShareDoc(sampleLibrary(), [id(3)], opts);
    expect(doc.labels.map((l) => l.name)).toEqual(['맛집', '바다뷰']);
    expect(doc.labels[0]).toEqual({ id: L_FOOD, name: '맛집', color: 'red', order: 0 });
  });

  it('orders labels by order value, not by place order', () => {
    const base = sampleLibrary();
    const lib = {
      ...base,
      labels: {
        ...base.labels,
        [L_FOOD]: { ...base.labels[L_FOOD]!, order: { value: 5, updatedAt: T0 } },
      },
    };
    const doc = buildShareDoc(lib, [id(3)], opts);
    expect(doc.labels.map((l) => l.name)).toEqual(['바다뷰', '맛집']);
  });

  it('drops deleted label ids from labelIds and labels', () => {
    const base = sampleLibrary();
    const lib = {
      ...base,
      labels: { ...base.labels, [L_SEA]: { ...base.labels[L_SEA]!, deletedAt: T0 } },
    };
    const doc = buildShareDoc(lib, [id(3)], opts);
    expect(doc.places[0]!.labelIds).toEqual([L_FOOD]);
    expect(doc.labels.map((l) => l.id)).toEqual([L_FOOD]);
  });

  it('omits memo when includeMemo is false and drops empty memos', () => {
    const lib = sampleLibrary();
    const withMemo = buildShareDoc(lib, [id(5)], opts);
    expect(withMemo.places[0]!.memo).toBe('비밀 메모: 창가 자리가 좋아요');

    const withoutMemo = buildShareDoc(lib, [id(5)], { ...opts, includeMemo: false });
    expect('memo' in withoutMemo.places[0]!).toBe(false);

    const empty = buildShareDoc(lib, [id(1)], opts);
    expect('memo' in empty.places[0]!).toBe(false);
  });

  it('sets naverSid only for naver places', () => {
    const lib = withPlaces(sampleLibrary(), [
      makePlace(7, { sid: '123' }),
      { ...makePlace(8), source: { kind: 'pin' } },
    ]);
    const doc = buildShareDoc(lib, [id(7), id(8)], opts);
    expect(doc.places[0]!.naverSid).toBe('123');
    expect('naverSid' in doc.places[1]!).toBe(false);
  });

  it('카카오·구글 장소는 자기 id만 담고, 핀은 id 키가 없다', () => {
    const lib = withPlaces(sampleLibrary(), [
      { ...makePlace(7), source: { kind: 'kakao', kakaoId: '2345678' } },
      { ...makePlace(8), source: { kind: 'google', googleId: '0x1a2b:0x3c4d' } },
      { ...makePlace(9), source: { kind: 'pin' } },
    ]);
    const doc = buildShareDoc(lib, [id(7), id(8), id(9)], opts);
    const [kakao, google, pin] = doc.places;
    expect(kakao!.kakaoId).toBe('2345678');
    expect('naverSid' in kakao!).toBe(false);
    expect('googleId' in kakao!).toBe(false);
    expect(google!.googleId).toBe('0x1a2b:0x3c4d');
    expect('naverSid' in google!).toBe(false);
    expect('kakaoId' in google!).toBe(false);
    for (const key of ['naverSid', 'kakaoId', 'googleId']) expect(key in pin!).toBe(false);
    // 모르는 필드를 거절하는 검증을 그대로 통과해야 한다.
    expect(() =>
      Schema.decodeUnknownSync(ShareDocSchema, { onExcessProperty: 'error' })(doc),
    ).not.toThrow();
  });

  it('copies name, address and coordinates', () => {
    const doc = buildShareDoc(sampleLibrary(), [id(3)], opts);
    expect(doc.places[0]).toMatchObject({
      id: id(3),
      name: '속초 횟집',
      lng: 128.95,
      lat: 37.77,
      labelIds: [L_FOOD, L_SEA],
    });
  });

  it('writes header fields', () => {
    const doc = buildShareDoc(sampleLibrary(), [id(1)], { ...opts, title: '  강릉 여행  ' });
    expect(doc.format).toBe('tripmap-share');
    expect(doc.version).toBe(1);
    expect(doc.title).toBe('강릉 여행');
    expect(doc.createdAt).toBe(NOW.toISOString());
  });

  it('passes ShareDocSchema', () => {
    const doc = buildShareDoc(sampleLibrary(), [id(1), id(3), id(5)], opts);
    expect(() =>
      Schema.decodeUnknownSync(ShareDocSchema)(doc, { onExcessProperty: 'error' }),
    ).not.toThrow();
  });

  it('rejects documents with excess properties or wrong header', () => {
    const doc = buildShareDoc(sampleLibrary(), [id(1)], opts);
    const decode = (v: unknown) =>
      Schema.decodeUnknownSync(ShareDocSchema)(v, { onExcessProperty: 'error' });
    expect(() => decode({ ...doc, extra: 1 })).toThrow();
    expect(() => decode({ ...doc, version: 2 })).toThrow();
    expect(() => decode({ ...doc, format: 'other' })).toThrow();
  });

  it('handles 300 places', () => {
    const many = Array.from({ length: 300 }, (_, i) => makePlace(100 + i, { labelIds: [L_FOOD] }));
    const lib = withPlaces(sampleLibrary(), many);
    const ids = many.map((p) => p.id);
    const doc = buildShareDoc(lib, ids, opts);
    expect(doc.places).toHaveLength(300);
    expect(doc.places.map((p) => p.id)).toEqual(ids);
    expect(doc.labels.map((l) => l.id)).toEqual([L_FOOD]);
  });
});

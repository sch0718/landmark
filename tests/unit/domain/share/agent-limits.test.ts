import { describe, expect, it } from 'vitest';
import { agentDocProblem, agentRawProblem } from 'src/domain/share/agent-limits';
import type { SharePlace } from 'src/schema/share';
import { makeShareV2Doc } from '../../helpers/share-v2-doc';
import { hashDoc } from 'src/share-viewer/encode';

describe('에이전트 원시 문서 사전 검사', () => {
  it('경로선을 뺀 정상 가져오기 사본은 통과하며 입력을 바꾸지 않는다', () => {
    const doc = hashDoc(makeShareV2Doc());
    const before = structuredClone(doc);
    expect(agentRawProblem(doc)).toBeNull();
    expect(doc).toEqual(before);
  });

  it.each([
    null,
    false,
    1,
    '문서',
    [],
    {},
    { labels: {} },
    { labels: [], trips: null },
    { labels: [], trips: [] },
    { labels: [], trips: [null] },
    { labels: [], trips: [{ days: null }] },
    { labels: [], trips: [{ days: [null] }] },
    { labels: [], trips: [{ days: [{ stops: {}, legs: [] }] }] },
    { labels: [], trips: [{ days: [{ stops: [], legs: null }] }] },
    { labels: [], trips: [{ days: [{ stops: [], legs: [null] }] }] },
    { labels: [], trips: [{ days: [{ stops: [], legs: [{ path: {} }] }] }] },
    { labels: [], trips: [{ days: [], legModes: [] }] },
    { labels: [], trips: [{ days: [], legModes: null }] },
  ])('모양이 틀린 원시 값은 스키마 검사에 맡긴다: %#', (value) => {
    expect(agentRawProblem(value)).toBeNull();
  });

  it('비어 있지 않은 라벨 배열은 원소 검사 없이 labels이다', () => {
    expect(agentRawProblem({ labels: [null] })).toBe('labels');
  });

  it('모든 여행·날짜·구간의 비어 있지 않은 경로선을 찾는다', () => {
    const doc = hashDoc(makeShareV2Doc());
    if (doc.version !== 2) throw new Error('v2 시험 문서여야 함');
    const other = structuredClone(doc.trips[0]!);
    other.days[1]!.legs[0]!.path = [[0, 0]];
    doc.trips.push(other);
    expect(agentRawProblem(doc)).toBe('path');
  });

  it('첫 여행의 Stop 수 + 날짜 수만큼 구간 설정을 허용하고 하나 초과하면 거절한다', () => {
    const doc = hashDoc(makeShareV2Doc());
    if (doc.version !== 2) throw new Error('v2 시험 문서여야 함');
    const trip = doc.trips[0]!;
    const max = trip.days.reduce((sum, day) => sum + day.stops.length + 1, 0);
    trip.legModes = Object.fromEntries(Array.from({ length: max }, (_, i) => [`k${i}`, 'car']));
    expect(agentRawProblem(doc)).toBeNull();
    trip.legModes.extra = 'walk';
    expect(agentRawProblem(doc)).toBe('leg-modes');
  });
});

describe('에이전트 공유 문서 내용 한도', () => {
  it('정상 문서는 통과한다', () => {
    expect(agentDocProblem(makeShareV2Doc())).toBeNull();
  });

  it.each(['문서', '여행'])('%s 제목 61자는 title이다', (target) => {
    const doc = makeShareV2Doc();
    if (target === '문서') doc.title = '가'.repeat(61);
    else doc.trips[0]!.title = '가'.repeat(61);
    expect(agentDocProblem(doc)).toBe('title');
  });

  it('두 제목 모두 60자까지 허용한다', () => {
    const doc = makeShareV2Doc();
    doc.title = '가'.repeat(60);
    doc.trips[0]!.title = '나'.repeat(60);
    expect(agentDocProblem(doc)).toBeNull();
  });

  it('라벨을 싣거나 장소가 라벨을 가리키면 labels이다', () => {
    const withLabel = makeShareV2Doc();
    withLabel.labels = [{ id: 'l1', name: '라벨', color: 'blue', order: 0 }];
    expect(agentDocProblem(withLabel)).toBe('labels');
    const withRef = makeShareV2Doc();
    withRef.places[0] = { ...withRef.places[0]!, labelIds: ['l1'] };
    expect(agentDocProblem(withRef)).toBe('labels');
  });

  it.each<Partial<SharePlace>>([
    { name: '가'.repeat(101) },
    { address: '가'.repeat(201) },
    { memo: '가'.repeat(10_001) },
    { naverSid: '1'.repeat(21) },
    { kakaoId: '1'.repeat(21) },
    { naverSid: 'place123' },
    { kakaoId: 'place123' },
    { naverSid: '' },
    { kakaoId: '' },
    { googleId: 'g'.repeat(65) },
  ])('장소 내용이나 출처 id가 한도 밖이면 place-too-long: %#', (extra) => {
    const doc = makeShareV2Doc();
    doc.places[doc.places.length - 1] = { ...doc.places.at(-1)!, ...extra };
    expect(agentDocProblem(doc)).toBe('place-too-long');
  });

  it.each<Partial<SharePlace>>([
    { name: '가'.repeat(100) },
    { address: '가'.repeat(200) },
    { memo: '가'.repeat(10_000) },
    { naverSid: '1'.repeat(20) },
    { kakaoId: '1'.repeat(20) },
    { googleId: 'g'.repeat(64) },
  ])('장소 내용과 출처 id는 경계값까지 허용한다: %#', (extra) => {
    const doc = makeShareV2Doc();
    doc.places[0] = { ...doc.places[0]!, ...extra };
    expect(agentDocProblem(doc)).toBeNull();
  });
});

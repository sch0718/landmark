import { describe, expect, it } from 'vitest';
import { validateShareValue } from 'src/domain/share/read-share';
import { parseLinkDoc, parseShareDoc } from 'src/share-viewer/parse';
import { hashDoc, importLink } from 'src/share-viewer/encode';
import { readShareHash } from 'src/domain/share/read-share';
import { importSharedTrip } from 'src/domain/library/import-share-trip';
import { emptyLibrary, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { ShareDocV2Schema, ShareDocV3Schema, type ShareDocV3 } from 'src/schema/share';
import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import { parseLiveDoc } from 'src/domain/trip-live/live-doc';
import { agentRawProblem } from 'src/domain/share/agent-limits';
import { checkInboxDoc } from 'src/server/agent/inbox';
import { encodeCompressedJson } from 'src/domain/codec';
import { IDS, leg, makeShareV2Doc } from '../../helpers/share-v2-doc';

const key = `${IDS.home}>${IDS.a}`;
function docV3(): ShareDocV3 {
  const doc: ShareDocV3 = { ...makeShareV2Doc(), version: 3 };
  const trip = doc.trips[0]!;
  trip.legModes[key] = 'transit';
  trip.legMinutes = { [key]: 30 };
  Object.assign(trip.days[0]!.legs[0]!, {
    mode: 'transit',
    status: 'manual',
    durationS: 1800,
    tollFare: null,
    path: [],
    queriedAt: null,
  });
  return doc;
}

describe('공유 v3', () => {
  it('앱·보기의 엄격한 읽기가 대중교통과 직접 입력 분을 유지한다', async () => {
    const doc = docV3();
    expect(safeParse(ShareDocV3Schema, doc, { onExcessProperty: 'error' }).success).toBe(true);
    expect(validateShareValue(doc)).toEqual({ ok: true, doc });
    expect(parseLinkDoc(doc)).toEqual(doc);
    expect(parseShareDoc(doc)).toEqual(doc);
    const link = await importLink(doc, 'https://example.com');
    expect(link.kind).toBe('direct');
    if (link.kind !== 'direct') throw new Error('직접 링크 필요');
    expect(await readShareHash(link.href.split('#d=')[1]!)).toEqual({
      ok: true,
      doc: hashDoc(doc),
    });
  });
  it.each(['mode', 'status', 'minutes'] as const)('v2는 새 %s 값을 받아들이지 않는다', (field) => {
    const doc = makeShareV2Doc();
    if (field === 'mode') doc.trips[0]!.days[0]!.legs[0]!.mode = 'transit';
    if (field === 'status') doc.trips[0]!.days[0]!.legs[0]!.status = 'manual';
    if (field === 'minutes') doc.trips[0]!.legMinutes = { [key]: 30 };
    expect(safeParse(ShareDocV2Schema, doc, { onExcessProperty: 'error' }).success).toBe(false);
    expect(validateShareValue(doc)).toEqual({ ok: false, error: 'corrupt' });
    expect(parseLinkDoc(doc)).toBeNull();
  });
  it.each([0, 1441, 1.5, null, '30'])('잘못된 분 %s를 양쪽 읽기가 거절한다', (minutes) => {
    const doc = docV3();
    Object.assign(doc.trips[0]!.legMinutes!, { [key]: minutes });
    expect(validateShareValue(doc).ok).toBe(false);
    expect(parseLinkDoc(doc)).toBeNull();
  });
  it('모르는 필드와 잘못된 분 키를 거절한다', () => {
    const doc = docV3();
    Object.assign(doc.trips[0]!, { future: true });
    expect(validateShareValue(doc).ok).toBe(false);
    expect(parseLinkDoc(doc)).toBeNull();
    delete (doc.trips[0] as unknown as Record<string, unknown>).future;
    doc.trips[0]!.legMinutes = { 'unknown>place': 30 };
    expect(validateShareValue(doc).ok).toBe(false);
    expect(parseLinkDoc(doc)).toBeNull();
  });
  it('새 장소 id로 가져온 뒤 다시 공유해도 대중교통과 분이 남는다', () => {
    let seq = 0;
    const imported = importSharedTrip(
      emptyLibrary(),
      docV3(),
      { titleLabel: null, appendMemo: true },
      {
        now: '2026-11-17T00:00:00.000Z',
        newId: (kind) =>
          kind === 'stop'
            ? `s${String(seq++).padStart(7, '0')}`
            : `p${String(seq++).padStart(9, '0')}`,
      },
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('가져오기 실패');
    expect(safeParse(LibrarySchema, imported.lib).success).toBe(true);
    const trip = imported.lib.trips[imported.createdId!]!;
    expect(Object.values(trip.legModes.value)).not.toContain('transit');
    expect(trip.legTransit!.value).toHaveLength(1);
    expect(Object.values(trip.legMinutes!.value)).toEqual([30]);
    const rebuilt = buildTripShareDoc(
      imported.lib,
      trip.id,
      () => ({
        status: 'estimated',
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        queriedAt: null,
        path: [],
      }),
      {
        title: '왕복',
        includeMemo: true,
        includeCandidates: true,
        now: new Date('2026-11-17T00:00:00.000Z'),
      },
    )!;
    expect(rebuilt.version).toBe(3);
    expect(rebuilt.trips[0]!.days[0]!.legs[0]).toMatchObject({
      mode: 'transit',
      status: 'manual',
      durationS: 1800,
    });
  });
  it('지금 이웃하지 않은 구간의 대중교통·분만 남았으면 v2로 쓴다', () => {
    let seq = 0;
    const imported = importSharedTrip(
      emptyLibrary(),
      docV3(),
      { titleLabel: null, appendMemo: true },
      {
        now: '2026-11-17T00:00:00.000Z',
        newId: (kind) =>
          kind === 'stop'
            ? `s${String(seq++).padStart(7, '0')}`
            : `p${String(seq++).padStart(9, '0')}`,
      },
    );
    if (!imported.ok) throw new Error('가져오기 실패');
    const trip = imported.lib.trips[imported.createdId!]!;
    // 순서가 바뀌어 더는 쓰이지 않는 옛 키(방향을 뒤집은 키): 두 장소는 문서에 있다.
    const [from, to] = trip.legTransit!.value[0]!.split('>');
    const stale = `${to}>${from}`;
    const at = '2026-11-17T00:00:00.000Z';
    const lib = {
      ...imported.lib,
      trips: {
        ...imported.lib.trips,
        [trip.id]: {
          ...trip,
          legTransit: { value: [stale], updatedAt: at },
          legMinutes: { value: { [stale]: 30 }, updatedAt: at },
        },
      },
    };
    const rebuilt = buildTripShareDoc(
      lib,
      trip.id,
      () => ({
        status: 'estimated',
        durationS: 0,
        distanceM: 0,
        tollFare: null,
        queriedAt: null,
        path: [],
      }),
      { title: '옛 키', includeMemo: true, includeCandidates: true, now: new Date(at) },
    )!;
    expect(rebuilt.version).toBe(2);
    expect(rebuilt.trips[0]!.legMinutes).toBeUndefined();
    expect(Object.values(rebuilt.trips[0]!.legModes)).not.toContain('transit');
    expect(safeParse(ShareDocV2Schema, rebuilt, { onExcessProperty: 'error' }).success).toBe(true);
  });
  it('실시간 문서 v는 유지하고 share v3를 읽는다', () => {
    const share = docV3();
    expect(
      parseLiveDoc({
        format: 'landmark-trip-live',
        v: 1,
        share,
        ids: { days: ['day00001', 'day00002'], stops: [['stop0001', 'stop0002'], ['stop0003']] },
        options: { includeMemo: true, includeCandidates: true },
      })?.share,
    ).toEqual(share);
  });
  it('받은함은 v3를 읽고 실제 구간이 아닌 분 설정을 거절한다', async () => {
    const doc = hashDoc(docV3());
    expect((await checkInboxDoc(await encodeCompressedJson(doc))).places).toBe(6);
    if (doc.version === 1) throw new Error('여행 필요');
    doc.trips[0]!.legMinutes = { [`${IDS.a}>${IDS.home}`]: 30 };
    await expect(checkInboxDoc(await encodeCompressedJson(doc))).rejects.toMatchObject({
      extra: { reason: 'leg-modes' },
    });
  });
  it('받은함은 과도한 분 설정을 스키마 검사 전에 거절한다', () => {
    const doc = hashDoc(docV3());
    if (doc.version === 1) throw new Error('여행 필요');
    doc.trips[0]!.legMinutes = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`a${i}>b`, 10]),
    );
    expect(agentRawProblem(doc)).toBe('leg-modes');
  });
});

it('장소가 합쳐져 구간 키가 겹치면 먼저 나온 수단·분 묶음을 유지한다', () => {
  const doc = docV3();
  doc.places = [
    { ...doc.places[0]!, id: 'a100000001', name: '같은 출발', lng: 127, lat: 37 },
    { ...doc.places[0]!, id: 'a200000001', name: '같은 출발', lng: 127, lat: 37 },
    { ...doc.places[1]!, id: 'b100000001', name: '같은 도착', lng: 127.1, lat: 37 },
    { ...doc.places[1]!, id: 'b200000001', name: '같은 도착', lng: 127.1, lat: 37 },
  ];
  const [a1, a2, b1, b2] = doc.places.map((p) => p.id) as [string, string, string, string];
  Object.assign(doc.trips[0]!, {
    originId: a1,
    candidateIds: [],
    days: [
      { startTime: '09:00', lodgingId: b1, stops: [], legs: [leg(a1, b1)] },
      {
        startTime: '09:00',
        lodgingId: b2,
        stops: [{ placeId: a2, stayMin: null, fixedTime: null }],
        legs: [leg(b1, a2), leg(a2, b2)],
      },
    ],
    legModes: { [`${a1}>${b1}`]: 'walk', [`${a2}>${b2}`]: 'transit' },
    legMinutes: { [`${a1}>${b1}`]: 12, [`${a2}>${b2}`]: 30 },
  });
  expect(validateShareValue(doc).ok).toBe(true);
  let seq = 0;
  const result = importSharedTrip(
    emptyLibrary(),
    doc,
    { titleLabel: null, appendMemo: true },
    {
      now: doc.createdAt,
      newId: (kind) =>
        kind === 'stop'
          ? `s${String(seq++).padStart(7, '0')}`
          : `p${String(seq++).padStart(9, '0')}`,
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('가져오기 실패');
  const trip = result.lib.trips[result.createdId!]!;
  expect(Object.values(trip.legModes.value)).toEqual(['walk']);
  expect(trip.legTransit?.value ?? []).toEqual([]);
  expect(Object.values(trip.legMinutes!.value)).toEqual([12]);
});

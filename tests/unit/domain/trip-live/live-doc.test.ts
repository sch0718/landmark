// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildTripShareDoc } from 'src/domain/share/build-trip-share';
import {
  alignDayIds,
  liveDocBytes,
  liveExpiresAt,
  liveLinks,
  parseLiveDoc,
  readLiveHash,
  readOwnerHash,
} from 'src/domain/trip-live/live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';

export const fixture = () => ({
  format: 'landmark-trip-live' as const,
  v: 1 as const,
  share: buildTripShareDoc(
    buildLiveLibrary(),
    'trip000001',
    () => ({
      durationS: 0,
      distanceM: 0,
      tollFare: null,
      status: 'estimated',
      queriedAt: null,
      path: [],
    }),
    {
      title: '시험 여행',
      includeMemo: false,
      includeCandidates: true,
      now: new Date('2026-11-01T00:00:00.000Z'),
    },
  )!,
  ids: { days: ['day00001', 'day00002'], stops: [['stop0001'], ['stop0002']] },
  options: { includeMemo: false, includeCandidates: true },
});
describe('갱신 공유 문서', () => {
  it('정상 문서를 통과시키고 새 객체를 돌려준다', () => {
    const input = fixture();
    const result = parseLiveDoc(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result?.share).not.toBe(input.share);
    expect(result?.ids.days).not.toBe(input.ids.days);
    expect(liveDocBytes(input)).toBe(new TextEncoder().encode(JSON.stringify(input)).length);
  });
  it.each(['root', 'ids', 'options'])('모르는 %s 키를 거절한다', (key) => {
    const input = fixture();
    Object.assign(key === 'root' ? input : input[key as 'ids' | 'options'], { unknown: true });
    expect(parseLiveDoc(input)).toBeNull();
  });
  it.each([
    (d: ReturnType<typeof fixture>) => d.ids.days.pop(),
    (d: ReturnType<typeof fixture>) => d.ids.stops[0]!.pop(),
    (d: ReturnType<typeof fixture>) => {
      d.ids.days[1] = d.ids.days[0]!;
    },
    (d: ReturnType<typeof fixture>) => {
      d.ids.stops[1] = [...d.ids.stops[0]!];
    },
    (d: ReturnType<typeof fixture>) => {
      d.ids.days[0] = 'INVALID';
    },
    (d: ReturnType<typeof fixture>) => {
      Object.assign(d, { v: 2 });
    },
    (d: ReturnType<typeof fixture>) => {
      Object.assign(d.share, { version: 1 });
    },
    (d: ReturnType<typeof fixture>) => {
      d.share.places = [];
    },
  ])('길이·중복·패턴·버전·장소를 검사한다 %#', (mutate) => {
    const d = fixture();
    mutate(d);
    expect(parseLiveDoc(d)).toBeNull();
  });
  it('이상한 값에도 던지지 않는다', () => {
    for (const x of [null, [], undefined, {}, '문서']) expect(parseLiveDoc(x)).toBeNull();
  });
  it('미래 여행은 한국 자정 직전에서 30일 뒤다', () =>
    expect(liveExpiresAt('2026-12-10', new Date('2026-11-01T00:00:00Z')).toISOString()).toBe(
      '2027-01-09T14:59:59.999Z',
    ));
  it.each(['2020-01-01', '이상한 날짜', '2026-99-99'])(
    '지난 여행·잘못된 날짜는 지금부터 30일이다: %s',
    (date) =>
      expect(liveExpiresAt(date, new Date('2026-11-01T00:00:00Z')).toISOString()).toBe(
        '2026-12-01T00:00:00.000Z',
      ),
  );
  it('180일을 넘지 않는다', () =>
    expect(liveExpiresAt('2027-12-31', new Date('2026-11-01T00:00:00Z')).toISOString()).toBe(
      '2027-04-30T00:00:00.000Z',
    ));
  it('Day id를 유지·자르기·중복 없이 늘리며 입력을 지킨다', () => {
    const prev = ['day00001', 'day00002'];
    const next = ['day00001', 'day00003'];
    expect(alignDayIds(prev, 2, () => '')).toEqual(prev);
    expect(alignDayIds(prev, 1, () => '')).toEqual(['day00001']);
    expect(alignDayIds(prev, 3, () => next.shift()!)).toEqual([...prev, 'day00003']);
    expect(prev).toHaveLength(2);
  });
  it('링크를 만들고 맞는 해시만 읽는다', () => {
    const token = 'a'.repeat(43);
    expect(
      liveLinks('https://example.com/', 'abcdefghij', { viewToken: token, ownerToken: token }),
    ).toEqual({
      view: `https://example.com/view#t=abcdefghij.${token}`,
      owner: `https://example.com/trips/live/abcdefghij#h=${token}`,
    });
    expect(readLiveHash(`#t=abcdefghij.${token}`)).toEqual({ id: 'abcdefghij', token });
    expect(readOwnerHash(`#h=${token}`)).toBe(token);
    expect(liveLinks('', 'abcdefghij', { viewToken: token }).owner).toBeNull();
    for (const hash of [
      '#t=ABCDEFGHIJ.' + token,
      '#t=abcdefghij.a',
      '#t=abcdefghij' + token,
      '#t=abcdefghij.' + token + '&x=1',
    ])
      expect(readLiveHash(hash)).toBeNull();
    expect(readOwnerHash('#h=a')).toBeNull();
  });
});

import { expect, it } from 'vitest';
import {
  bookingsOn,
  filterNotes,
  noteRegions,
  phraseLangs,
  phraseSituations,
  putPhrase,
  putPrepNote,
  removePrepNote,
  sortNotes,
} from 'src/domain/trips/prep';
import { PREP_NOTES_MAX, type Booking, type PrepNote } from 'src/schema/trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { booking, phrase, prepNote } from '../../../fixtures/trip-prep';

const ID = 'trip000001';
const ctx = { now: '2026-11-28T00:00:00.000Z', newId: () => 'note0002' };
const globalNote = { ...prepNote, id: 'note0003', region: '', unsure: false };
const frenchNote = { ...prepNote, id: 'note0004', region: '프랑스', unsure: true };
const money: PrepNote = { ...prepNote, id: 'note0005', topic: 'money' };

it('주제순으로 정렬하고 같은 주제에서는 저장 순서를 지킨다', () => {
  expect(sortNotes([globalNote, prepNote, money])).toEqual([money, globalNote, prepNote]);
});

it('지역 목록에서는 빈칸과 중복을 빼고 처음 나온 순서를 지킨다', () => {
  expect(noteRegions([frenchNote, globalNote, prepNote, money])).toEqual(['프랑스', '스페인']);
});

it('지역을 고르면 여행 전체 정보를 함께 보이고 확인 필요 조건도 적용한다', () => {
  const list = [frenchNote, globalNote, prepNote];
  expect(filterNotes(list, { region: '스페인', unsure: false })).toEqual([globalNote, prepNote]);
  expect(filterNotes(list, { region: '스페인', unsure: true })).toEqual([prepNote]);
  expect(filterNotes(list, { region: null, unsure: true })).toEqual([frenchNote, prepNote]);
});

it('정보를 넣고 마지막 정보를 지우면 새 시각과 빈 배열을 저장한다', () => {
  const input = { ...prepNote, id: undefined };
  const first = putPrepNote(buildLiveLibrary(), ID, input, ctx);
  if (!first.ok) throw new Error(JSON.stringify(first.error));
  expect(first.lib.trips[ID]?.prepNotes).toEqual({
    value: [{ ...input, id: 'note0002' }],
    updatedAt: ctx.now,
  });
  const later = { ...ctx, now: '2026-11-28T01:00:00.000Z' };
  const removed = removePrepNote(first.lib, ID, 'note0002', later);
  if (!removed.ok) throw new Error(JSON.stringify(removed.error));
  expect(removed.lib.trips[ID]?.prepNotes).toEqual({ value: [], updatedAt: later.now });
});

it('정보 개수 상한을 넘는 추가를 거절한다', () => {
  const lib = buildLiveLibrary();
  const trip = lib.trips[ID]!;
  const value = Array.from({ length: PREP_NOTES_MAX }, (_, i) => ({
    ...prepNote,
    id: String(i).padStart(8, '0'),
  }));
  const full = {
    ...lib,
    trips: { ...lib.trips, [ID]: { ...trip, prepNotes: { value, updatedAt: ctx.now } } },
  };
  expect(putPrepNote(full, ID, { ...prepNote, id: 'another1' }, ctx)).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining(String(PREP_NOTES_MAX)) },
  });
});

it('문장의 잘못된 언어 태그를 거절한다', () => {
  expect(putPhrase(buildLiveLibrary(), ID, { ...phrase, lang: 'es_ES' }, ctx).ok).toBe(false);
});

it('언어는 처음 나온 순서로, 언어별 상황은 스키마 순서로 고른다', () => {
  const list = [
    { ...phrase, situation: 'lodging' as const },
    { ...phrase, lang: 'fr-FR', situation: 'restaurant' as const },
    phrase,
  ];
  expect(phraseLangs(list)).toEqual(['es-ES', 'fr-FR']);
  expect(phraseSituations(list, 'es-ES')).toEqual(['greet', 'lodging']);
});

it('해당 날짜의 예약을 시각순으로 고르고 시각 없는 예약은 저장 순서로 끝에 둔다', () => {
  const late = { ...booking, at: '2026-12-31T15:00' };
  const noTime = { ...booking, id: 'book0002', at: null };
  const second = { ...noTime, id: 'book0003' };
  const skipped: Booking = { ...booking, status: 'skipped' };
  const otherDay = { ...booking, date: '2026-12-30' };
  expect(bookingsOn([noTime, late, skipped, booking, otherDay, second], booking.date!)).toEqual([
    booking,
    late,
    noTime,
    second,
  ]);
});

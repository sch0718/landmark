import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ITEM_DOC_MAX_CHARS, stableStringify } from 'src/domain/library-sync/items';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import { LIBRARY_LIMITS } from 'src/schema/library-base';
import { PREP_FIELD_CHARS } from 'src/schema/trip';
import { LIBRARY_KEY } from 'src/services/library-store';
import { libraryAtom } from 'src/stores/library-state';
import { booking, phrase, prepNote } from '../../../fixtures/trip-prep';
import { makePlace, withPlaces } from '../library/fixtures';
import { f, makeTrip, open, plannerLibrary, TRIP, withTrip } from './planner-fixtures';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));

const path = `/trips/${TRIP}/prep`;

afterEach(() => {
  setAppRuntimeForTest(null);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('휴대폰에서 예약을 추가하고 예약함으로 바꾸면 진행 숫자가 갱신된다', async () => {
  await open(withTrip(plannerLibrary(), makeTrip()), { path, width: 390, ids: [booking.id] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /예약 더하기/ }));
  let sheet = within(screen.getByRole('dialog', { name: '예약 더하기' }));
  await user.type(sheet.getByRole('textbox', { name: /제목/ }), '미술관 입장권');
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('예약함 0 / 1')).toBeVisible();

  await user.click(screen.getByRole('button', { name: /미술관 입장권/ }));
  sheet = within(screen.getByRole('dialog', { name: '예약 편집' }));
  await user.click(sheet.getByRole('button', { name: '예약함' }));
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('예약함 1 / 1')).toBeVisible();
});

it('다른 탭에서 늘린 일정 때문에 문서가 상한을 넘으면 삭제를 되돌리지 않는다', async () => {
  const places = Array.from({ length: 350 }, (_, i) => makePlace(100 + i));
  const initial = { ...makeTrip(), bookings: f([booking]) };
  const lib = withTrip(withPlaces(plannerLibrary(), places), initial);
  const { store, storage } = await open(lib, { path });
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: /입장권/ }));
  const sheet = within(screen.getByRole('dialog', { name: '예약 편집' }));
  await user.click(sheet.getByRole('button', { name: '지우기' }));
  await waitFor(() => expect(store.get(libraryAtom).trips[TRIP]?.bookings?.value).toEqual([]));

  const latest: Library = JSON.parse(storage.getItem(LIBRARY_KEY)!);
  const trip = latest.trips[TRIP]!;
  const expanded = makeTrip({ stops: [places.map(({ id }) => id)] });
  const days = [
    {
      ...expanded.days[0]!,
      stops: { ...expanded.days[0]!.stops, updatedAt: '2026-11-27T04:00:00.000Z' },
    },
    trip.days[1]!,
  ];
  const padding = ITEM_DOC_MAX_CHARS - stableStringify({ ...trip, days }).length;
  const stops = days[0]!.stops.value.map((stop, i) => ({
    ...stop,
    note: '가'.repeat(
      Math.min(
        LIBRARY_LIMITS.stopNoteChars,
        Math.max(0, padding - i * LIBRARY_LIMITS.stopNoteChars),
      ),
    ),
  }));
  const day = days[0]!;
  const enlarged = { ...trip, days: [{ ...day, stops: { ...day.stops, value: stops } }, days[1]!] };
  expect(stableStringify(enlarged).length).toBe(ITEM_DOC_MAX_CHARS);
  expect(stableStringify({ ...enlarged, bookings: initial.bookings }).length).toBeGreaterThan(
    ITEM_DOC_MAX_CHARS,
  );
  storage.setItem(LIBRARY_KEY, JSON.stringify({ ...latest, trips: { [TRIP]: enlarged } }));

  const undo = toastMock.mock.calls.findLast(([message]) => message === '예약을 지웠어요')?.[1]
    ?.action;
  expect(undo?.label).toBe('되돌리기');
  await act(async () => undo.onClick());
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('여행 문서가 너무 커요'));
  const saved: Library = JSON.parse(storage.getItem(LIBRARY_KEY)!);
  expect(saved.trips[TRIP]?.bookings?.value).toEqual([]);
  expect(saved.trips[TRIP]?.days[0]?.stops.value).toEqual(stops);
});

it('통화별 금액 합계에 부동소수점 오차를 보이지 않는다', async () => {
  const bookings = [
    { ...booking, id: 'price001', price: { amount: 1.1, currency: 'EUR' } },
    { ...booking, id: 'price002', price: { amount: 2.2, currency: 'EUR' } },
  ];
  await open(withTrip(plannerLibrary(), { ...makeTrip(), bookings: f(bookings) }), { path });
  expect(await screen.findByText(/€3\.30/)).toBeVisible();
  expect(screen.queryByText(/3\.3000000/)).toBeNull();
});

it('여행 전체 정보만 있어도 확인 필요 칩으로 새 정보를 걸러 볼 수 있다', async () => {
  const initial = { ...prepNote, region: '', text: '콘센트 규격 확인 완료', unsure: false };
  await open(withTrip(plannerLibrary(), { ...makeTrip(), prepNotes: f([initial]) }), {
    path,
    width: 390,
    ids: ['note0002'],
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: '정보' }));
  await user.click(screen.getByRole('button', { name: /정보 더하기/ }));
  const sheet = within(screen.getByRole('dialog', { name: '정보 더하기' }));
  await user.type(sheet.getByRole('textbox', { name: '내용' }), '카드 결제 가능 여부');
  expect(sheet.getByRole('textbox', { name: '지역' })).toHaveValue('');
  await user.click(sheet.getByRole('checkbox', { name: '확인 필요' }));
  await user.click(sheet.getByRole('button', { name: '저장' }));

  const panel = within(screen.getByRole('tabpanel', { name: '정보' }));
  expect(await panel.findByText('카드 결제 가능 여부')).toBeVisible();
  expect(panel.getByText('콘센트 규격 확인 완료')).toBeVisible();
  expect(panel.queryByRole('group', { name: '지역' })).toBeNull();
  const filter = panel.getByRole('button', { name: '확인 필요 1' });
  await user.click(filter);
  expect(filter).toHaveAttribute('aria-pressed', 'true');
  expect(panel.getByText('카드 결제 가능 여부')).toBeVisible();
  expect(panel.queryByText('콘센트 규격 확인 완료')).toBeNull();
});

const phrasesPath = `${path}?tab=phrases`;

it('음성 기능이 없으면 문장에 구글 번역 링크와 전송 안내를 보인다', async () => {
  vi.stubGlobal('speechSynthesis', undefined);
  await open(withTrip(plannerLibrary(), { ...makeTrip(), phrases: f([phrase]) }), {
    path: phrasesPath,
  });
  expect(await screen.findByText('이 기기에서 스페인어 음성을 쓸 수 없어요')).toBeVisible();
  expect(screen.getByText('문장이 Google로 전송돼요')).toBeVisible();
  expect(screen.getByRole('link', { name: '구글 번역에서 듣기' })).toHaveAttribute(
    'href',
    'https://translate.google.com/?sl=es&tl=ko&text=Hola&op=translate',
  );
});

it('문장을 더하고 고친 뒤 지워도 되돌리면 수정된 내용이 다시 보인다', async () => {
  await open(withTrip(plannerLibrary(), makeTrip()), { path: phrasesPath, ids: [phrase.id] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /문장 더하기/ }));
  let sheet = within(screen.getByRole('dialog', { name: '문장 더하기' }));
  await user.type(sheet.getByRole('textbox', { name: '한국어' }), phrase.ko);
  await user.type(sheet.getByRole('textbox', { name: '현지어' }), phrase.text);
  await user.type(sheet.getByRole('textbox', { name: '언어' }), phrase.lang);
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText(phrase.text)).toBeVisible();

  const menuButton = () => screen.getByRole('button', { name: `${phrase.ko} 메뉴` });
  await user.click(menuButton());
  await user.click(screen.getByRole('menuitem', { name: '고치기' }));
  sheet = within(screen.getByRole('dialog', { name: '문장 편집' }));
  const local = sheet.getByRole('textbox', { name: '현지어' });
  await user.clear(local);
  await user.type(local, 'Buenos días');
  await user.click(sheet.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('Buenos días')).toBeVisible();

  await user.click(menuButton());
  await user.click(screen.getByRole('menuitem', { name: '지우기' }));
  await waitFor(() => expect(screen.queryByText('Buenos días')).toBeNull());
  const undo = toastMock.mock.calls.findLast(([message]) => message === '문장을 지웠어요')?.[1]
    ?.action;
  expect(undo?.label).toBe('되돌리기');
  await act(async () => undo.onClick());
  expect(await screen.findByText('Buenos días')).toBeVisible();
});

it('문장 필드 크기를 넘으면 저장을 막고 시트에 입력과 사유를 남긴다', async () => {
  const phrases = [];
  const full = { ...phrase, text: 'a'.repeat(500), reading: '' };
  while (JSON.stringify([...phrases, full]).length <= PREP_FIELD_CHARS.phrases) {
    phrases.push({ ...full, id: String(phrases.length).padStart(8, '0') });
  }
  await open(withTrip(plannerLibrary(), { ...makeTrip(), phrases: f(phrases) }), {
    path: phrasesPath,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /문장 더하기/ }));
  const sheet = within(screen.getByRole('dialog', { name: '문장 더하기' }));
  const text = sheet.getByRole('textbox', { name: '현지어' });
  fireEvent.change(sheet.getByRole('textbox', { name: '한국어' }), {
    target: { value: phrase.ko },
  });
  fireEvent.change(text, { target: { value: full.text } });

  expect(sheet.getByRole('button', { name: '저장' })).toBeDisabled();
  expect(sheet.getByRole('alert')).toHaveTextContent('문장을 모두 합치면 너무 길어요');
  expect(text).toHaveValue(full.text);
});

it('여행 문서 크기를 넘으면 저장을 거절하고 시트에 입력과 사유를 남긴다', async () => {
  const places = Array.from({ length: 350 }, (_, i) => makePlace(100 + i));
  const trip = makeTrip({ stops: [places.map(({ id }) => id)] });
  const padding = ITEM_DOC_MAX_CHARS - stableStringify(trip).length;
  const day = trip.days[0]!;
  const stops = day.stops.value.map((stop, i) => ({
    ...stop,
    note: '가'.repeat(
      Math.min(
        LIBRARY_LIMITS.stopNoteChars,
        Math.max(0, padding - i * LIBRARY_LIMITS.stopNoteChars),
      ),
    ),
  }));
  const atLimit = {
    ...trip,
    days: [{ ...day, stops: { ...day.stops, value: stops } }, ...trip.days.slice(1)],
  };
  expect(stableStringify(atLimit).length).toBe(ITEM_DOC_MAX_CHARS);
  const lib = withTrip(withPlaces(plannerLibrary(), places), atLimit);
  const { store } = await open(lib, { path: phrasesPath, ids: [phrase.id] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /문장 더하기/ }));
  const sheet = within(screen.getByRole('dialog', { name: '문장 더하기' }));
  const text = sheet.getByRole('textbox', { name: '현지어' });
  fireEvent.change(sheet.getByRole('textbox', { name: '한국어' }), {
    target: { value: phrase.ko },
  });
  fireEvent.change(text, { target: { value: phrase.text } });
  fireEvent.change(sheet.getByRole('textbox', { name: '언어' }), {
    target: { value: phrase.lang },
  });
  await user.click(sheet.getByRole('button', { name: '저장' }));

  expect(await sheet.findByRole('alert')).toHaveTextContent('여행 문서가 너무 커요');
  expect(text).toHaveValue(phrase.text);
  expect(store.get(libraryAtom).trips[TRIP]?.phrases).toBeUndefined();
});

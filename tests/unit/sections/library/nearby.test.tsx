import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { createMemoryStorage } from 'src/repositories/edit-layer-repo';
import { emptyLibrary, type Library, type Place } from 'src/schema/library';
import { QUERY_PERSIST_DELAY_MS } from 'src/sections/library/use-library-query';
import { SLOW_LOCATE_MS } from 'src/sections/nearby/NearbyBar';
import { CURRENT_OPTIONS, Geolocation } from 'src/services/geolocation';
import { PREFS_KEY } from 'src/services/prefs-store';
import { fakeGeolocation, type FakeCoords } from '../../helpers/fake-geolocation';
import { L_CAFE, L_FOOD, makeLabel, makePlace, renderLibrary } from './fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

/** 2026-10-16 14:05(한국 시각, 시험은 `TZ=Asia/Seoul`). */
const FIX_AT = Date.parse('2026-10-16T05:05:00.000Z');

// 기기 시각을 위치를 잰 때 1분 뒤로 고정한다. 위치 서비스는 하루보다 오래됐거나 미래인 `timestamp`를
// 받은 때로 바꾸므로, 고정하지 않으면 `14:05 기준`이 실제 날짜에 따라 달라진다.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIX_AT + 60_000);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

/** 기준점. 장소 좌표와 겹치지 않는 자릿수라 storage에서 이 글자를 찾으면 위치가 샌 것이다. */
const BASE: FakeCoords = { longitude: 128.90031, latitude: 37.75517, accuracy: 30 };
const BASE_STRINGS = ['37.75517', '128.90031'];
/** `haversineM`의 지구 반지름 기준 위도 1도의 길이(m). */
const M_PER_LAT_DEGREE = (6_371_008.8 * Math.PI) / 180;

/** 기준점에서 북쪽으로 `m`미터. 경도는 기준과 1e-5도(약 0.9m) 달라 좌표 글자가 겹치지 않는다. */
const northOf = (place: Place, m: number): Place => ({
  ...place,
  lng: 128.9003,
  lat: BASE.latitude + m / M_PER_LAT_DEGREE,
});

/**
 * 기준점에서 0.5km `가 식당`(맛집), 2km `라 카페`(카페), 4km `나 식당`(맛집), 20km `다 카페`(카페).
 * 최근 저장순: 다 → 나 → 라 → 가. 이름순: 가 → 나 → 다 → 라.
 */
function nearbyLibrary(options: { dropNearest?: boolean; visited?: boolean } = {}): Library {
  const labels = [
    makeLabel(L_FOOD, '맛집', 'red', 'utensils', 0),
    makeLabel(L_CAFE, '카페', 'yellow', 'coffee', 1),
  ];
  const places = [
    northOf(
      makePlace(1, {
        name: '가 식당',
        labelIds: [L_FOOD],
        deletedAt: options.dropNearest === true ? '2026-10-09T00:00:00.000Z' : null,
      }),
      500,
    ),
    northOf(
      makePlace(2, {
        name: '라 카페',
        labelIds: [L_CAFE],
        ...(options.visited === true ? { visitedOn: '2026-10-01' } : {}),
      }),
      2000,
    ),
    northOf(makePlace(3, { name: '나 식당', labelIds: [L_FOOD] }), 4000),
    northOf(makePlace(4, { name: '다 카페', labelIds: [L_CAFE] }), 20_000),
  ];
  return {
    ...emptyLibrary(),
    labels: Object.fromEntries(labels.map((l) => [l.id, l])),
    places: Object.fromEntries(places.map((p) => [p.id, p])),
  };
}

const LIST = { libraryView: 'list' as const };

async function setup(options: { library?: Library; storage?: Storage; noApi?: boolean } = {}) {
  const fake = fakeGeolocation();
  const rendered = await renderLibrary(options.library ?? nearbyLibrary(), {
    prefs: LIST,
    storage: options.storage,
    geolocation: Geolocation.layerWith({
      api: options.noApi === true ? undefined : fake.api,
      secure: true,
    }),
  });
  return { fake, ...rendered };
}

/** 목록 보기에서 보이는 행 글자(행 순서대로). */
const shown = () =>
  within(screen.getByRole('list', { name: '장소 목록' }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
const order = () => shown().map((text) => text.match(/^[가-힣] (식당|카페)/)?.[0] ?? text);

const sortButton = (name: string) => screen.getByRole('button', { name });
const radiusChip = (name: string) =>
  within(screen.getByRole('group', { name: '반경' })).getByRole('button', { name });
const labelChip = (name: string) =>
  within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name });
const statusOf = (text: string) => screen.getByText(text).closest('[role="status"]');
const nearbyBarShown = () => screen.queryByRole('group', { name: '반경' }) !== null;

const SEARCHING = '내 위치를 찾는 중…';
const RECENT = ['다 카페', '나 식당', '라 카페', '가 식당'];

async function pickSort(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.click(sortButton(from));
  await user.click(screen.getByRole('menuitemradio', { name: to }));
}

async function startNearby(
  user: ReturnType<typeof userEvent.setup>,
  fake: ReturnType<typeof fakeGeolocation>,
  from = '최근 저장순',
) {
  await pickSort(user, from, '가까운 순');
  await waitFor(() => expect(fake.requests).toHaveLength(1));
}

async function answer(
  fake: ReturnType<typeof fakeGeolocation>,
  coords: FakeCoords = BASE,
  index = 0,
) {
  await act(async () => fake.succeed(index, coords, FIX_AT));
}

describe('library 가까운 순', () => {
  it('asks only when picked, then sorts by straight-line distance inside the radius', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    expect(fake.requests).toHaveLength(0);

    await user.click(sortButton('최근 저장순'));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      '최근 저장순',
      '이름순',
      '라벨순',
      '다녀온 날순',
      '가까운 순',
    ]);
    await user.click(screen.getByRole('menuitemradio', { name: '가까운 순' }));

    // 찾는 중: 목록은 이전 정렬 그대로, 거리는 없다.
    expect(statusOf(SEARCHING)).not.toBeNull();
    expect(order()).toEqual(RECENT);
    expect(shown().join()).not.toMatch(/\d(m|km)/);
    await waitFor(() => expect(fake.requests).toHaveLength(1));
    expect(fake.requests[0]!.options).toEqual(CURRENT_OPTIONS);

    await answer(fake);
    expect(statusOf('내 위치에서 3km 안 · 2곳 · 14:05 기준')).not.toBeNull();
    expect(screen.getByText('직선거리')).toBeInTheDocument();
    expect(order()).toEqual(['가 식당', '라 카페']);
    expect(shown()[0]).toContain('500m');
    expect(shown()[1]).toContain('2.0km');
    expect(sortButton('가까운 순')).toBeInTheDocument();
    expect(radiusChip('3km')).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(screen.getByRole('group', { name: '반경' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['500m', '1km', '3km', '5km', '10km', '전체']);

    await user.click(radiusChip('1km'));
    expect(radiusChip('1km')).toHaveAttribute('aria-pressed', 'true');
    expect(radiusChip('3km')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('내 위치에서 1km 안 · 1곳 · 14:05 기준')).toBeInTheDocument();
    expect(order()).toEqual(['가 식당']);

    await user.click(radiusChip('전체'));
    expect(screen.getByText('내 위치에서 가까운 순 · 4곳 · 14:05 기준')).toBeInTheDocument();
    expect(order()).toEqual(['가 식당', '라 카페', '나 식당', '다 카페']);
    expect(shown().at(-1)).toContain('20km');

    // 라벨 필터와 겹친다.
    await user.click(labelChip('맛집 2'));
    expect(order()).toEqual(['가 식당', '나 식당']);
    expect(screen.getByText('내 위치에서 가까운 순 · 2곳 · 14:05 기준')).toBeInTheDocument();

    // 반경·필터를 바꿔도 위치를 다시 묻지 않는다.
    expect(fake.requests).toHaveLength(1);

    await user.click(sortButton('가까운 순'));
    expect(screen.getByRole('menuitemradio', { name: '가까운 순' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    for (const name of ['최근 저장순', '이름순', '라벨순', '다녀온 날순']) {
      expect(screen.getByRole('menuitemradio', { name })).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('shows the radius empty state and widens one step without asking again', async () => {
    const user = userEvent.setup();
    const { fake } = await setup({ library: nearbyLibrary({ dropNearest: true }) });
    await startNearby(user, fake);
    await answer(fake);

    await user.click(radiusChip('500m'));
    expect(screen.getByText('반경 500m 안에 저장한 곳이 없어요')).toBeInTheDocument();
    expect(screen.getByText('내 위치에서 500m 안 · 0곳 · 14:05 기준')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '반경 넓히기' }));
    expect(radiusChip('1km')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('반경 1km 안에 저장한 곳이 없어요')).toBeInTheDocument();
    expect(fake.requests).toHaveLength(1);
  });

  it('shows the filter empty state when the filter alone leaves nothing, and 필터 지우기 keeps nearby on', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    await answer(fake);

    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '없는 장소');
    expect(screen.getByText('조건에 맞는 장소가 없어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '반경 넓히기' })).not.toBeInTheDocument();
    expect(screen.queryByText(/저장한 곳이 없어요/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '필터 지우기' }));
    expect(order()).toEqual(['가 식당', '라 카페']);
    expect(nearbyBarShown()).toBe(true);
    expect(screen.getByText('내 위치에서 3km 안 · 2곳 · 14:05 기준')).toBeInTheDocument();
  });

  it('warns when the accuracy is worse than 1km', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    await answer(fake, { ...BASE, accuracy: 1000 });
    expect(screen.queryByText(/위치 오차가 커요/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '다시 찾기' }));
    await waitFor(() => expect(fake.requests).toHaveLength(2));
    await answer(fake, { ...BASE, accuracy: 2400 }, 1);
    expect(statusOf('위치 오차가 커요(약 2.4km)')).not.toBeNull();
  });

  it.each([
    [1, '위치 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 켜 주세요'],
    [2, '지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요'],
    [3, '위치를 찾는 데 시간이 너무 오래 걸려요. 다시 해 주세요'],
  ] as const)('code %i shows its message and 다시 시도 asks again', async (code, message) => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    await act(async () => fake.fail(0, code));

    expect(statusOf(message)).not.toBeNull();
    // 목록은 이전 정렬로 계속 쓴다.
    expect(order()).toEqual(RECENT);
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(fake.requests).toHaveLength(2));
    // 다시 찾는 동안에는 지난 오류가 아니라 찾는 중이 보인다.
    expect(statusOf(SEARCHING)).not.toBeNull();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 찾기' })).toBeDisabled();
  });

  it('shows the unsupported message when there is no location API', async () => {
    const user = userEvent.setup();
    await setup({ noApi: true });
    await pickSort(user, '최근 저장순', '가까운 순');
    expect(await screen.findByText('이 브라우저에서는 위치를 쓸 수 없어요')).toBeInTheDocument();
    expect(statusOf('이 브라우저에서는 위치를 쓸 수 없어요')).not.toBeNull();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('adds the indoor hint after 5 seconds of searching', async () => {
    await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => void fireEvent.click(sortButton('최근 저장순')));
    act(() => void fireEvent.click(screen.getByRole('menuitemradio', { name: '가까운 순' })));
    expect(screen.getByText(SEARCHING)).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(SLOW_LOCATE_MS - 1));
    expect(screen.getByText(SEARCHING)).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(statusOf('내 위치를 찾는 중… 실내에서는 오래 걸릴 수 있어요')).not.toBeNull();
  });

  it('another sort or the close button turns nearby off', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    await answer(fake);

    await pickSort(user, '가까운 순', '이름순');
    expect(nearbyBarShown()).toBe(false);
    expect(sortButton('이름순')).toBeInTheDocument();
    expect(order()).toEqual(['가 식당', '나 식당', '다 카페', '라 카페']);
    expect(shown().join()).not.toMatch(/\d(m|km)/);

    // 다시 켜면 얻은 위치로 바로 거른다. 끄기는 이전 정렬(이름순)로 돌아간다.
    await pickSort(user, '이름순', '가까운 순');
    expect(order()).toEqual(['가 식당', '라 카페']);
    await user.click(screen.getByRole('button', { name: '가까운 순 끄기' }));
    expect(nearbyBarShown()).toBe(false);
    expect(sortButton('이름순')).toBeInTheDocument();
    expect(order()).toEqual(['가 식당', '나 식당', '다 카페', '라 카페']);
  });

  it('keeps the time the distances are based on when a re-search fails', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    const UNAVAILABLE = '지금은 위치를 알 수 없어요. 잠시 뒤 다시 해 주세요';
    await act(async () => fake.fail(0, 2));
    // 아직 얻은 위치가 없으면 기준 문장도 없다.
    expect(statusOf(UNAVAILABLE)).not.toBeNull();
    expect(screen.queryByText(/기준$/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(fake.requests).toHaveLength(2));
    await answer(fake, BASE, 1);
    await user.click(screen.getByRole('button', { name: '다시 찾기' }));
    await waitFor(() => expect(fake.requests).toHaveLength(3));
    await act(async () => fake.fail(2, 2));

    // 목록은 지난 위치 기준 그대로이고, 그 기준 시각을 오류 문장 아래에 남긴다.
    const status = statusOf(UNAVAILABLE)!;
    expect(status).toHaveTextContent('내 위치에서 3km 안 · 2곳 · 14:05 기준');
    expect(order()).toEqual(['가 식당', '라 카페']);
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('moves focus to the sort button after the close button', async () => {
    const user = userEvent.setup();
    const { fake } = await setup();
    await startNearby(user, fake);
    await answer(fake);

    await user.click(screen.getByRole('button', { name: '가까운 순 끄기' }));

    expect(nearbyBarShown()).toBe(false);
    expect(document.activeElement).toBe(sortButton('최근 저장순'));
  });

  it('moves focus to the new radius chip after 반경 넓히기', async () => {
    const user = userEvent.setup();
    const { fake } = await setup({ library: nearbyLibrary({ dropNearest: true }) });
    await startNearby(user, fake);
    await answer(fake);
    await user.click(radiusChip('500m'));

    await user.click(screen.getByRole('button', { name: '반경 넓히기' }));
    expect(document.activeElement).toBe(radiusChip('1km'));
    await user.click(screen.getByRole('button', { name: '반경 넓히기' }));

    // 3km 안에는 장소가 있어 빈 상태(와 그 단추)가 사라진다. 포커스는 새 반경 칩에 있다.
    expect(screen.queryByRole('button', { name: '반경 넓히기' })).not.toBeInTheDocument();
    expect(radiusChip('3km')).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(radiusChip('3km'));
  });

  it('가까운 순 and 다녀온 날순 switch each other off', async () => {
    const user = userEvent.setup();
    const { fake } = await setup({ library: nearbyLibrary({ visited: true }) });
    await pickSort(user, '최근 저장순', '다녀온 날순');
    expect(sortButton('다녀온 날순')).toBeInTheDocument();

    await startNearby(user, fake, '다녀온 날순');
    await answer(fake);
    expect(sortButton('가까운 순')).toBeInTheDocument();
    await user.click(sortButton('가까운 순'));
    expect(screen.getByRole('menuitemradio', { name: '다녀온 날순' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.click(screen.getByRole('menuitemradio', { name: '다녀온 날순' }));
    expect(nearbyBarShown()).toBe(false);
    expect(sortButton('다녀온 날순')).toBeInTheDocument();
    expect(order()[0]).toBe('라 카페');
  });

  it('never saves 가까운 순 or the location (Review Focus 3)', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const { fake } = await setup({ storage });
    await startNearby(user, fake);
    await answer(fake);

    // 다른 필터를 바꿔 선호 저장을 일으킨 뒤 읽는다(정렬만으로는 저장되지 않는다).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => void fireEvent.click(labelChip('맛집 2')));
    await act(async () => {
      vi.advanceTimersByTime(QUERY_PERSIST_DELAY_MS + 100);
      await Promise.resolve();
    });
    const saved = JSON.parse(storage.getItem(PREFS_KEY)!) as {
      query: { sort: string; labelIds: string[] };
    };
    expect(saved.query.labelIds).toEqual([L_FOOD]);
    expect(saved.query.sort).toBe('recent');

    const values = (store: Storage) =>
      Array.from({ length: store.length }, (_, i) => store.getItem(store.key(i)!) ?? '');
    const everything = [...values(storage), ...values(localStorage), ...values(sessionStorage)];
    for (const text of BASE_STRINGS) {
      expect(everything.some((value) => value.includes(text))).toBe(false);
    }

    vi.useRealTimers();
    cleanup();
    setAppRuntimeForTest(null);
    await renderLibrary(nearbyLibrary(), { storage });
    expect(sortButton('최근 저장순')).toBeInTheDocument();
    expect(nearbyBarShown()).toBe(false);
  });
});

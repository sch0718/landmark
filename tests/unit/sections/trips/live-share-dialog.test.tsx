import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripLiveShareDialog } from 'src/sections/trips/live/TripLiveShareDialog';
import { tripLiveApi } from 'src/services/trip-live/client';
import {
  createTripLiveStore,
  tripLiveStore,
  type TripLiveRecord,
} from 'src/services/trip-live/store';
import { libraryAtom } from 'src/stores/library-state';
import { ESTIMATE_ONLY } from 'src/domain/trip-live/build-live-doc';
import { buildLiveLibrary } from '../../../fixtures/builders';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { downloadText } from 'src/lib/download-text';
import { toast } from 'sonner';
import { getTurnstileToken } from 'src/services/meet-online/turnstile-loader';
vi.mock('src/services/trip-live/client', () => ({
  tripLiveApi: { create: vi.fn(), get: vi.fn(), rotate: vi.fn(), remove: vi.fn() },
}));
vi.mock('src/services/meet-online/turnstile-loader', () => ({
  getTurnstileToken: vi.fn(async () => 'dev'),
}));
vi.mock('src/sections/trips/live/use-trip-live-publish', () => ({
  useTripLivePublish: () => ({
    state: 'published',
    publishedAt: null,
    resume: vi.fn(),
    pause: vi.fn(),
    overwrite: vi.fn(),
  }),
}));
vi.mock('src/sections/share-export/use-trip-legs', () => ({
  useTripLegs: () => ({ routeOf: ESTIMATE_ONLY, total: 0, answered: 0 }),
  legStatus: () => null,
}));
vi.mock('src/sections/share-export/kakao', () => ({
  useKakao: () => ({ enabled: false }),
  kakaoUrlFits: () => true,
}));
vi.mock('src/lib/effect/runtime', () => ({
  startEffect: async () => '<script>__TRIPMAP_DATA__</script>',
}));
vi.mock('src/lib/download-text', () => ({ downloadText: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const record = (): TripLiveRecord => ({
  tripId: 'trip000001',
  liveId: 'abcdefghij',
  status: 'live',
  ownerToken: 'o'.repeat(43),
  viewToken: 'v'.repeat(43),
  rev: 1,
  dayIds: ['day00001', 'day00002'],
  options: { title: '시험 여행', includeMemo: false, includeCandidates: true },
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-01-01',
});
const state = () => ({
  rev: 1,
  updatedAt: '2026-11-01',
  expiresAt: '2027-01-01',
  role: 'owner' as const,
  doc: buildLiveDoc(),
  viewToken: 'v'.repeat(43),
  sourceTripId: 'trip000001',
});
const mount = () => {
  const store = createStore();
  store.set(libraryAtom, buildLiveLibrary());
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <TripLiveShareDialog open onClose={() => {}} tripId="trip000001" />
      </MemoryRouter>
    </Provider>,
  );
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(tripLiveApi.create).mockImplementation(async (x) => ({
    ok: true,
    value: { id: x.id, rev: 1, created: true, expiresAt: '2027-01-01' },
  }));
  vi.mocked(tripLiveApi.get).mockResolvedValue({ ok: true, value: state() });
  vi.mocked(tripLiveApi.rotate).mockResolvedValue({ ok: true, value: { rev: 1 } });
  vi.mocked(tripLiveApi.remove).mockResolvedValue({ ok: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});
describe('갱신 링크 창', () => {
  it('메모 기본 꺼짐과 서버 일반 저장 안내를 보인다', async () => {
    mount();
    expect(screen.getByRole('checkbox', { name: '메모 포함' })).not.toBeChecked();
    expect(screen.getByText(/서버에는 암호화하지 않고 저장해요/)).toBeVisible();
    await userEvent.click(screen.getByRole('checkbox', { name: '메모 포함' }));
    expect(screen.getByText('링크를 받은 사람은 누구나 메모를 볼 수 있어요')).toBeVisible();
  });
  it('만들기 전에 기록을 두고 성공하면 보기 링크와 live 기록을 보인다', async () => {
    vi.mocked(tripLiveApi.create).mockImplementationOnce(async (x) => {
      expect(tripLiveStore.get('trip000001')?.status).toBe('pending');
      return { ok: true, value: { id: x.id, rev: 1, created: true, expiresAt: '2027-01-01' } };
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    expect(
      ((await screen.findByRole('textbox', { name: '보기 링크' })) as HTMLInputElement).value,
    ).toMatch(/\/view#t=[a-z0-9]{10}\.[A-Za-z0-9_-]{43}$/);
    expect(tripLiveStore.get('trip000001')).toMatchObject({
      status: 'live',
      publishedKey: expect.any(String),
    });
  });
  it('응답 유실 뒤 같은 id와 토큰으로 다시 보낸다', async () => {
    vi.mocked(tripLiveApi.create).mockResolvedValueOnce({ ok: false, error: 'offline' });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    await screen.findByText(/인터넷 연결을 확인해 주세요/);
    const first = vi.mocked(tripLiveApi.create).mock.calls[0]![0];
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    await screen.findByRole('textbox', { name: '보기 링크' });
    expect(vi.mocked(tripLiveApi.create).mock.calls[1]![0]).toMatchObject({
      id: first.id,
      ownerToken: first.ownerToken,
      viewToken: first.viewToken,
    });
  });
  it('taken이면 새 id와 새 Turnstile 토큰으로 한 번 더 만든다', async () => {
    vi.mocked(tripLiveApi.create).mockResolvedValueOnce({ ok: false, error: 'taken' });
    vi.mocked(getTurnstileToken).mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    mount();
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    await screen.findByRole('textbox', { name: '보기 링크' });
    expect(tripLiveApi.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(tripLiveApi.create).mock.calls[0]![0].id).not.toBe(
      vi.mocked(tripLiveApi.create).mock.calls[1]![0].id,
    );
    expect(getTurnstileToken).toHaveBeenCalledTimes(2);
    expect(vi.mocked(tripLiveApi.create).mock.calls.map(([body]) => body.turnstile)).toEqual([
      'first',
      'second',
    ]);
  });
  it.each([
    ['switched-off', '지금은 갱신 링크를 만들 수 없어요'],
    ['rate-limited', '오늘은 더 만들 수 없어요'],
    ['turnstile', '확인에 실패했어요'],
  ])('%s 오류는 문구를 보이고 기록을 지운다', async (error, message) => {
    vi.mocked(tripLiveApi.create).mockResolvedValueOnce({ ok: false, error: error as 'turnstile' });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    await screen.findByText(new RegExp(message));
    expect(tripLiveStore.get('trip000001')).toBeUndefined();
  });
  it('링크를 복사한다', async () => {
    tripLiveStore.put(record());
    mount();
    await userEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/view#t='));
  });
  it.each(['보기', '소유자'])('%s 링크 다시 만들기는 확인 뒤 새 토큰을 저장한다', async (kind) => {
    tripLiveStore.put(record());
    mount();
    await userEvent.click(screen.getByRole('button', { name: `${kind} 링크 다시 만들기` }));
    const confirm = screen.getByRole('dialog', { name: `${kind} 링크 다시 만들기` });
    await userEvent.click(within(confirm).getByRole('button', { name: '다시 만들기' }));
    await waitFor(() => expect(tripLiveApi.rotate).toHaveBeenCalledOnce());
    const key = kind === '보기' ? 'viewToken' : 'ownerToken';
    await waitFor(() => expect(tripLiveStore.get('trip000001')![key]).not.toBe(record()[key]));
  });
  it('서버 삭제 성공 뒤 기록을 지운다', async () => {
    tripLiveStore.put(record());
    mount();
    await userEvent.click(screen.getByRole('button', { name: '서버에서 지우기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '서버에서 지우기' })).getByRole('button', {
        name: '지우기',
      }),
    );
    await waitFor(() => expect(tripLiveStore.get('trip000001')).toBeUndefined());
  });
  it('소유자 재발급 응답 유실 뒤 창을 다시 열면 저장한 새 토큰으로 복구한다', async () => {
    tripLiveStore.put(record());
    let persisted = false;
    vi.mocked(tripLiveApi.rotate).mockImplementationOnce(async (_id, tokens) => {
      persisted =
        'owner' in tokens &&
        createTripLiveStore().get('trip000001')?.nextOwnerToken === tokens.owner;
      return { ok: false, error: 'offline' };
    });
    const first = mount();
    await userEvent.click(screen.getByRole('button', { name: '소유자 링크 다시 만들기' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: '소유자 링크 다시 만들기' })).getByRole('button', {
        name: '다시 만들기',
      }),
    );
    await waitFor(() => expect(tripLiveApi.rotate).toHaveBeenCalledOnce());
    expect(persisted).toBe(true);
    const tokens = vi.mocked(tripLiveApi.rotate).mock.calls[0]![1];
    if (!('owner' in tokens)) throw new Error('소유자 재발급 요청이 아니에요');
    const next = tokens.owner;
    first.unmount();
    vi.mocked(tripLiveApi.get).mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    mount();
    await waitFor(() => expect(tripLiveApi.rotate).toHaveBeenCalledTimes(2));
    expect(vi.mocked(tripLiveApi.rotate).mock.calls[1]).toEqual([
      'abcdefghij',
      { owner: next },
      record().ownerToken,
    ]);
    await waitFor(() =>
      expect(tripLiveStore.get('trip000001')).toMatchObject({ status: 'live', ownerToken: next }),
    );
    expect(Object.keys(createTripLiveStore().get('trip000001')!)).not.toContain('nextOwnerToken');
  });
  it('재발급 실패는 만들기용 안내 대신 다시 만들기 오류를 보인다', async () => {
    tripLiveStore.put(record());
    vi.mocked(tripLiveApi.rotate).mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '보기 링크 다시 만들기' }));
    const confirm = screen.getByRole('dialog', { name: '보기 링크 다시 만들기' });
    await userEvent.click(within(confirm).getByRole('button', { name: '다시 만들기' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      '링크를 다시 만들지 못했어요. 잠시 뒤 다시 해 주세요',
    );
  });
  it.each(['보기 링크 다시 만들기', '서버에서 지우기', '공개본 파일 저장'])(
    '재발급 응답 유실 뒤 %s의 401도 대기 토큰을 복구한다',
    async (action) => {
      tripLiveStore.put(record());
      mount();
      await waitFor(() => expect(tripLiveApi.get).toHaveBeenCalledOnce());
      const nextOwnerToken = 'n'.repeat(43);
      act(() => tripLiveStore.update('trip000001', { nextOwnerToken }));
      const method =
        action === '보기 링크 다시 만들기'
          ? tripLiveApi.rotate
          : action === '서버에서 지우기'
            ? tripLiveApi.remove
            : tripLiveApi.get;
      vi.mocked(method).mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
      await userEvent.click(screen.getByRole('button', { name: action }));
      if (action !== '공개본 파일 저장')
        await userEvent.click(
          within(screen.getByRole('dialog', { name: action })).getByRole('button', {
            name: action === '서버에서 지우기' ? '지우기' : '다시 만들기',
          }),
        );
      await waitFor(() =>
        expect(tripLiveApi.rotate).toHaveBeenCalledWith(
          record().liveId,
          { owner: nextOwnerToken },
          record().ownerToken,
        ),
      );
      if (action === '서버에서 지우기') expect(tripLiveStore.get('trip000001')).toBeUndefined();
      else
        expect(tripLiveStore.get('trip000001')).toMatchObject({
          status: 'live',
          ownerToken: nextOwnerToken,
        });
    },
  );
  it('공개본 파일 저장은 서버 문서를 틀에 넣는다', async () => {
    tripLiveStore.put(record());
    mount();
    await userEvent.click(screen.getByRole('button', { name: '공개본 파일 저장' }));
    await waitFor(() =>
      expect(downloadText).toHaveBeenCalledWith(
        expect.stringContaining(JSON.stringify(buildLiveDoc().share)),
        expect.stringMatching(/\.html$/),
        'text/html',
      ),
    );
  });
  it('멈춤과 끝난 공유에서 재개·새 만들기를 고를 수 있다', async () => {
    tripLiveStore.put({ ...record(), paused: true });
    mount();
    expect(screen.getByRole('button', { name: '다시 반영하기' })).toBeVisible();
    expect(screen.getByRole('button', { name: '공개본을 새 여행으로 가져오기' })).toBeVisible();
    act(() => tripLiveStore.update('trip000001', { status: 'ended', paused: undefined }));
    await userEvent.click(screen.getByRole('button', { name: '새 갱신 링크 만들기' }));
    expect(screen.getByRole('button', { name: '갱신 링크 만들기' })).toBeVisible();
  });
  it('열 때 전체 공개본을 받고 바뀐 보기 토큰과 다른 기기 갱신을 알린다', async () => {
    tripLiveStore.put(record());
    vi.mocked(tripLiveApi.get).mockResolvedValue({
      ok: true,
      value: { ...state(), rev: 3, viewToken: 'n'.repeat(43) },
    });
    mount();
    expect(await screen.findByText('다른 기기에서 마지막으로 반영했어요')).toBeVisible();
    expect(tripLiveApi.get).toHaveBeenCalledWith('abcdefghij', null, 'o'.repeat(43));
    expect(
      (screen.getByRole('textbox', { name: '보기 링크' }) as HTMLInputElement).value,
    ).toContain('n'.repeat(43));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

it('응답 유실 뒤 옵션을 바꿔 재시도하면 실제 서버 공개본의 지문을 기록한다', async () => {
  const { liveEditKey } = await import('src/domain/trip-live/build-live-doc');
  tripLiveStore.put({ ...record(), status: 'pending', rev: 0 });
  vi.mocked(tripLiveApi.create).mockResolvedValue({
    ok: true,
    value: { id: 'abcdefghij', rev: 1, created: false, expiresAt: '2027-01-01' },
  });
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: '메모 포함' }));
  await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
  await screen.findByRole('textbox', { name: '보기 링크' });
  expect(tripLiveStore.get('trip000001')?.publishedKey).toBe(await liveEditKey(buildLiveDoc()));
  expect(tripLiveStore.get('trip000001')?.options.includeMemo).toBe(true);
});
it.each(['turnstile', 'rate-limited', 'switched-off'] as const)(
  '이미 응답이 유실된 pending 기록은 %s 실패에도 보존한다',
  async (error) => {
    tripLiveStore.put({ ...record(), status: 'pending', rev: 0 });
    vi.mocked(tripLiveApi.create).mockResolvedValue({ ok: false, error });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '갱신 링크 만들기' }));
    await waitFor(() => expect(tripLiveApi.create).toHaveBeenCalledOnce());
    expect(tripLiveStore.get('trip000001')?.ownerToken).toBe(record().ownerToken);
  },
);

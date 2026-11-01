import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { ShareDocV2 } from 'src/schema/share';
import { LIBRARY_KEY } from 'src/services/library-store';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom } from 'src/stores/library-state';
import { createHeldLocks } from '../../../fixtures/fake-locks';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { SHARE_DOC } from './share-fixtures';

const inboxMock = vi.hoisted(() => ({
  load: vi.fn(),
  sameOwnerNow: vi.fn<(owner: string | null) => boolean>(),
  discardInboxItem: vi.fn<(id: string, owner: string | null) => Promise<boolean>>(),
}));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('src/services/agent-inbox/boot', () => ({ loadAgentInbox: inboxMock.load }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let currentOwner: string | null;
beforeEach(() => {
  currentOwner = 'owner-a';
  inboxMock.sameOwnerNow.mockImplementation((owner) => owner !== null && owner === currentOwner);
  inboxMock.discardInboxItem.mockResolvedValue(true);
  inboxMock.load.mockResolvedValue(inboxMock);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const INBOX = { id: 'inbox00000000001', from: 'Claude Code', owner: 'owner-a' };
const OWNER_CHANGED = '로그인한 계정이 바뀌어 받은 일정을 닫았어요';
const KEPT = '받은 일정은 받은함에 남겨 둘게요. 다 쓰셨으면 버려 주세요';
const IDS = ['newlab01', 'newplace01', 'newplace02', 'stop0001', 'stop0002', 'tripnew001'];

function makeDoc(): ShareDocV2 {
  return {
    ...SHARE_DOC,
    version: 2,
    labels: [],
    places: SHARE_DOC.places.map((place) => ({ ...place, labelIds: [] })),
    trips: [
      {
        title: '강릉 당일 여행',
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        originId: null,
        candidateIds: [],
        legModes: {},
        days: [
          {
            startTime: '09:00',
            lodgingId: null,
            stops: SHARE_DOC.places.map((place) => ({
              placeId: place.id,
              stayMin: 60,
              fixedTime: null,
            })),
            legs: [],
          },
        ],
      },
    ],
  };
}

const panel = () => within(screen.getByRole('region', { name: '장소 추가' }));
const tripButton = () => panel().getByRole('button', { name: '여행 가져오기' });
async function openShare(
  inbox: { id: string; from: string | null; owner: string | null } | null = INBOX,
  libraryLocks?: LockManager,
) {
  const user = userEvent.setup();
  const rendered = await renderLibrary(sampleLibrary(), { ids: IDS, libraryLocks });
  const flow = { step: 'share' as const, doc: makeDoc(), ...(inbox === null ? {} : { inbox }) };
  act(() => rendered.store.set(addFlowAtom, flow));
  await panel().findByRole('heading', { name: '강릉 여행 · 2곳' });
  return { ...rendered, user };
}

describe('받은함 일정 가져오기', () => {
  it('다른 받은함 항목을 열면 여행 스위치를 다시 켜요', async () => {
    const { user, store } = await openShare();
    const tripSwitch = () => panel().getByRole('switch', { name: '여행 계획도 가져오기' });
    await user.click(tripSwitch());
    expect(tripSwitch()).not.toBeChecked();
    act(() =>
      store.set(addFlowAtom, {
        step: 'share',
        doc: { ...makeDoc(), title: '속초 여행' },
        inbox: { ...INBOX, id: 'inbox00000000002' },
      }),
    );
    await panel().findByRole('heading', { name: '속초 여행 · 2곳' });
    expect(tripSwitch()).toBeChecked();
  });

  it.each(['Claude Code', null, '<img src=x onerror=alert(1)>'])(
    '보낸 연결 이름 %s을 머리에 텍스트로 보여요',
    async (from) => {
      await openShare({ ...INBOX, from });
      expect(
        panel().getByText(`AI 연결 「${from ?? '이름 없는 연결'}」이 보낸 일정`),
      ).toBeInTheDocument();
      expect(screen.getByRole('region', { name: '장소 추가' }).querySelector('img')).toBeNull();
      expect(inboxMock.load).not.toHaveBeenCalled();
    },
  );

  it('여행째 가져오면 저장하고 받은함 항목을 한 번 지워요', async () => {
    const { user, store, storage } = await openShare();
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(Object.keys(JSON.parse(storage.getItem(LIBRARY_KEY)!).trips)).toHaveLength(1);
    expect(inboxMock.discardInboxItem).toHaveBeenCalledExactlyOnceWith(INBOX.id, INBOX.owner);
  });

  it('장소만 가져오면 여행과 받은함 삭제 없이 남김을 알려요', async () => {
    const { user, store } = await openShare();
    await user.click(panel().getByRole('switch', { name: '여행 계획도 가져오기' }));
    await user.click(panel().getByRole('button', { name: '2곳 가져오기' }));
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).places)).toHaveLength(7);
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(0);
    expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(KEPT);
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it('받은함 삭제가 실패해도 가져온 여행을 두고 실패를 알려요', async () => {
    inboxMock.discardInboxItem.mockResolvedValue(false);
    const { user, store } = await openShare();
    await user.click(tripButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('받은함에서 지우지 못했어요'));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it.each(['owner-b', null])(
    '현재 계정이 %s이면 보관함을 바꾸거나 받은함을 지우지 않아요',
    async (owner) => {
      const { user, store, storage } = await openShare();
      const before = store.get(libraryAtom);
      const raw = storage.getItem(LIBRARY_KEY);
      currentOwner = owner;
      await user.click(tripButton());
      await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
      expect(store.get(libraryAtom)).toEqual(before);
      expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
      expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledExactlyOnceWith(OWNER_CHANGED);
    },
  );

  it('받은 일정의 계정이 null이면 가져오지 않아요', async () => {
    const { user, store } = await openShare({ ...INBOX, owner: null });
    const before = store.get(libraryAtom);
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(store.get(libraryAtom)).toEqual(before);
    expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledExactlyOnceWith(OWNER_CHANGED);
  });

  it('보관함 잠금을 기다리다 계정이 바뀌면 잠금 안에서 다시 확인하고 중단해요', async () => {
    const held = createHeldLocks();
    const { user, store, storage } = await openShare(INBOX, held.locks);
    const before = store.get(libraryAtom);
    const raw = storage.getItem(LIBRARY_KEY);
    held.hold();
    try {
      await user.click(tripButton());
      await waitFor(() => expect(held.requested).toHaveLength(1));
      expect(inboxMock.sameOwnerNow).toHaveBeenCalledExactlyOnceWith(INBOX.owner);
      expect(store.get(libraryAtom)).toEqual(before);
      currentOwner = 'owner-b';
    } finally {
      held.release();
    }
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(inboxMock.sameOwnerNow).toHaveBeenCalledTimes(2);
    expect(store.get(libraryAtom)).toEqual(before);
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledExactlyOnceWith(OWNER_CHANGED);
  });

  it('일반 공유 흐름은 받은함 모듈을 부르지 않아요', async () => {
    const { user, store } = await openShare(null);
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(inboxMock.load).not.toHaveBeenCalled();
    expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('모듈을 받지 못하면 저장하지 않고 버튼을 다시 켜 재시도할 수 있어요', async () => {
    inboxMock.load.mockRejectedValueOnce(new Error('조각을 받지 못했어요'));
    const { user, store, storage } = await openShare();
    const raw = storage.getItem(LIBRARY_KEY);
    await user.click(tripButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('잠시 뒤 다시 시도해 주세요'));
    expect(tripButton()).toBeEnabled();
    expect(storage.getItem(LIBRARY_KEY)).toBe(raw);
    expect(inboxMock.discardInboxItem).not.toHaveBeenCalled();
    await user.click(tripButton());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
  });

  it('저장 중 칸을 닫아도 여행을 가져온 뒤 받은함 삭제는 진행해요', async () => {
    const held = createHeldLocks();
    const { user, store, router } = await openShare(INBOX, held.locks);
    held.hold();
    try {
      await user.click(tripButton());
      await waitFor(() => expect(held.requested).toHaveLength(1));
      act(() => store.set(addFlowAtom, { step: 'closed' }));
      act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
    } finally {
      held.release();
    }
    await waitFor(() =>
      expect(inboxMock.discardInboxItem).toHaveBeenCalledExactlyOnceWith(INBOX.id, INBOX.owner),
    );
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('빠르게 두 번 눌러도 여행과 받은함 삭제는 한 번씩만 진행해요', async () => {
    const { store } = await openShare();
    const button = tripButton();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'closed' }));
    expect(Object.keys(store.get(libraryAtom).trips)).toHaveLength(1);
    expect(inboxMock.discardInboxItem).toHaveBeenCalledExactlyOnceWith(INBOX.id, INBOX.owner);
  });
});

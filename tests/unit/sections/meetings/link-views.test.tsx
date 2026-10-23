import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { Provider } from 'jotai';
import { MemoryRouter } from 'react-router';
import { InviteView } from 'src/sections/meetings/InviteView';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  finalFromMeeting,
  inviteFromMeeting,
  meetLink,
  type InviteDoc,
  type ReplyDoc,
} from 'src/domain/meeting/link';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { libraryAtom } from 'src/stores/library-state';
import { RouteLookup } from 'src/services/route-lookup';
import { saveMeetDraft } from 'src/sections/meetings/meet-drafts';
import { buildMeeting } from '../../../fixtures/builders';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

const shared = vi.hoisted(() => vi.fn());
vi.mock('src/sections/meetings/share-link', () => ({ shareMeetingDoc: shared }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/components/map/MapView', () => ({ MapView: () => <div data-testid="meeting-map" /> }));
afterEach(() => {
  window.localStorage.clear();
  cleanup();
  setAppRuntimeForTest(null);
  shared.mockReset();
  vi.unstubAllGlobals();
});
const now = '2026-10-23T00:00:00.000Z';
const f = <T,>(value: T) => ({ value, updatedAt: now });
const meeting = () =>
  buildMeeting({
    participants: f([
      { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
      { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
      { id: 'person03', name: '출발지 없는 친구', origin: null },
    ]),
    candidates: f([
      { id: 'choice01', name: '강남역', kind: 'hub', lng: 127, lat: 37.5 },
      { id: 'choice02', name: '시청역', kind: 'hub', lng: 126.97, lat: 37.56 },
    ]),
  });
const invite = (): InviteDoc =>
  inviteFromMeeting(
    meeting(),
    { choice01: { person01: 10, person02: 20 }, choice02: { person01: 30, person02: 40 } },
    'min',
    now,
  );
async function link(doc: Parameters<typeof meetLink>[0]) {
  const result = await meetLink(doc, 'http://localhost');
  if (!result.ok) throw new Error('시험 링크 생성 실패');
  return new URL(result.url).pathname + new URL(result.url).hash;
}
async function renderLinked(...args: Parameters<typeof renderLibrary>) {
  const rendered = await renderLibrary(...args);
  await waitFor(() =>
    expect(screen.queryByText('약속 링크를 읽는 중이에요')).not.toBeInTheDocument(),
  );
  return rendered;
}
const reply = (patch: Partial<ReplyDoc> = {}): ReplyDoc => ({
  format: 'tripmap-meet',
  v: 1,
  kind: 'r',
  meetingId: 'meeting001',
  participantId: 'person02',
  likes: ['choice01'],
  sentAt: now,
  ...patch,
});

describe('친구 후보 화면', () => {
  it.each([
    [null, '2026-10-24T09:20', '내 줄은 지금 기준으로 다시 조회했어요'],
    [{ date: '2026-10-31', time: '18:19' }, '2026-10-31T17:10', null],
  ] as const)(
    '출발지 변경 시 약속 일시 %j에 맞춰 조회하고 기준을 안내한다',
    async (at, departure, notice) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-24T09:20:00+09:00'));
      const calls: (string | undefined)[] = [];
      const routeLookup = Layer.succeed(
        RouteLookup,
        RouteLookup.of({
          leg: (mode, _from, _to, options) => {
            calls.push(options?.at);
            return Effect.succeed({
              mode,
              durationS: 4200,
              distanceM: 1000,
              tollFare: null,
              path: [],
              queriedAt: now,
              seq: 1,
              fresh: false,
            });
          },
        }),
      );
      try {
        await renderLinked(sampleLibrary(), { path: await link({ ...invite(), at }), routeLookup });
        expect(screen.queryByText('내 줄은 지금 기준으로 다시 조회했어요')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: '친구' }));
        await userEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
        const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
        await userEvent.click(within(picker).getByRole('tab', { name: '보관함에서' }));
        await userEvent.click(within(picker).getByRole('button', { name: /강남 한 곳/ }));
        await waitFor(() => expect(screen.getAllByText('1시간 10분')).toHaveLength(2));
        expect(calls).toEqual([departure, departure]);
        expect(screen.getByText('10분')).toBeInTheDocument();
        if (notice) expect(screen.getByText(notice)).toBeInTheDocument();
        else
          expect(
            screen.queryByText('내 줄은 지금 기준으로 다시 조회했어요'),
          ).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('신원 선택·여러 좋아요를 답장으로 보내며 보관함은 바꾸지 않는다', async () => {
    const { store } = await renderLinked(sampleLibrary(), { path: await link(invite()) });
    const before = store.get(libraryAtom);
    expect(screen.getByRole('radiogroup', { name: '나는 누구?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '답장 링크 보내기' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: '친구' }));
    await userEvent.click(screen.getByRole('button', { name: '강남역 좋아요' }));
    await userEvent.click(screen.getByRole('button', { name: '시청역 좋아요' }));
    await userEvent.click(await screen.findByRole('button', { name: '답장 링크 보내기' }));
    expect(shared).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'r',
        participantId: 'person02',
        likes: ['choice01', 'choice02'],
      }),
      '친구 모임',
    );
    expect(store.get(libraryAtom)).toBe(before);
  });
  it('새 이름은 필수이고 좋아요가 없어도 답장할 수 있다', async () => {
    await renderLinked(sampleLibrary(), { path: await link(invite()) });
    await userEvent.click(screen.getByRole('radio', { name: '목록에 없어요' }));
    expect(screen.getByRole('button', { name: '답장 링크 보내기' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '내 이름' }), {
      target: { value: ' 민지 ' },
    });
    await userEvent.click(await screen.findByRole('button', { name: '답장 링크 보내기' }));
    expect(shared).toHaveBeenCalledWith(
      expect.objectContaining({ newName: '민지', likes: [] }),
      '친구 모임',
    );
  });
  it('출발지를 바꾸면 내 줄만 조회하며 다른 사람 값은 유지한다', async () => {
    const calls: number[][] = [];
    const routeLookup = Layer.succeed(
      RouteLookup,
      RouteLookup.of({
        leg: (mode, from) => {
          calls.push(from);
          return Effect.succeed({
            mode,
            distanceM: 1000,
            durationS: 4200,
            tollFare: null,
            path: [],
            queriedAt: now,
            seq: 1,
            fresh: false,
          });
        },
      }),
    );
    await renderLinked(sampleLibrary(), { path: await link(invite()), routeLookup });
    await userEvent.click(screen.getByRole('radio', { name: '친구' }));
    await userEvent.click(screen.getByRole('button', { name: '내 출발지 고르기' }));
    const picker = screen.getByRole('dialog', { name: '출발지 고르기' });
    await userEvent.click(within(picker).getByRole('tab', { name: '보관함에서' }));
    await userEvent.click(within(picker).getByRole('button', { name: /강남 한 곳/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      [128.95, 37.77],
      [128.95, 37.77],
    ]);
    expect(screen.getAllByText('1시간 10분')).toHaveLength(2);
    expect(screen.getByText('10분')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '답장 링크 보내기' }));
    expect(shared).toHaveBeenCalledWith(
      expect.objectContaining({ origin: expect.objectContaining({ placeId: 'place00004' }) }),
      '친구 모임',
    );
  });
  it('다른 신원을 고르면 좋아요와 출발지 수정이 섞이지 않고 출발지 지우기도 답장한다', async () => {
    await renderLinked(sampleLibrary(), { path: await link(invite()) });
    await userEvent.click(screen.getByRole('radio', { name: '친구' }));
    await userEvent.click(screen.getByRole('button', { name: '강남역 좋아요' }));
    await userEvent.click(screen.getByRole('button', { name: '내 출발지 지우기' }));
    await userEvent.click(await screen.findByRole('button', { name: '답장 링크 보내기' }));
    expect(shared).toHaveBeenLastCalledWith(expect.objectContaining({ origin: null }), '친구 모임');
    await userEvent.click(screen.getByRole('radio', { name: '나' }));
    expect(screen.getByRole('button', { name: '강남역 좋아요' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByText('집')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '답장 링크 보내기' }));
    const doc = shared.mock.calls.at(-1)![0];
    expect(doc.participantId).toBe('person01');
    expect(doc).not.toHaveProperty('origin');
    expect(doc.likes).toEqual([]);
  });
  it('초안을 현재 후보·참석자에 맞춰 복원하고 내 기기의 약속 단추를 보인다', async () => {
    const lib = { ...sampleLibrary(), meetings: { meeting001: meeting() } };
    const { storage, router } = await renderLinked(lib, { path: '/meetings' });
    vi.stubGlobal('localStorage', storage);
    saveMeetDraft(
      'meeting001',
      { participantId: 'person02', likes: ['choice01', 'gone0001'], origin: null },
      storage,
    );
    await import('@testing-library/react').then(async ({ act }) =>
      act(async () => {
        await router.navigate(await link(invite()));
      }),
    );
    expect(await screen.findByRole('radio', { name: '친구' })).toBeChecked();
    expect(screen.getByRole('button', { name: '강남역 좋아요' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('link', { name: '내 약속 열기' })).toHaveAttribute(
      'href',
      '/meetings/meeting001',
    );
  });
});

describe('답장 반영', () => {
  it('좋아요·출발지 변경과 없어진 후보를 미리 보고 반영하면 편집 화면으로 간다', async () => {
    const lib = { ...sampleLibrary(), meetings: { meeting001: meeting() } };
    const { store, router } = await renderLinked(lib, {
      path: await link(reply({ origin: null, likes: ['choice01', 'gone0001'] })),
    });
    expect(screen.getByText('친구님 답장: 좋아요 1곳, 출발지 바뀜')).toBeInTheDocument();
    expect(screen.getByText('없어진 후보 1곳 제외')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '반영' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/meetings/meeting001'));
    expect(store.get(libraryAtom).meetings?.meeting001?.participants.value[1]?.origin).toBeNull();
    expect(store.get(libraryAtom).meetings?.meeting001?.replies.value.person02?.likes).toEqual([
      'choice01',
    ]);
  });
  it('이 기기에 약속이 없으면 아무것도 바꾸지 않는다', async () => {
    const { store } = await renderLinked(sampleLibrary(), { path: await link(reply()) });
    const before = store.get(libraryAtom);
    expect(screen.getByText('이 기기에 없는 약속의 답장이에요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
    expect(store.get(libraryAtom)).toBe(before);
  });
  it('오래된 답장은 반영하지 못하고 반영하지 않기로 편집 화면에 돌아간다', async () => {
    const current = {
      ...meeting(),
      replies: f({
        person02: {
          likes: [],
          sentAt: '2026-10-24T00:00:00.000Z',
          receivedAt: '2026-10-24T00:00:00.000Z',
        },
      }),
    };
    const { router } = await renderLinked(
      { ...sampleLibrary(), meetings: { meeting001: current } },
      { path: await link(reply()) },
    );
    expect(screen.getByText('더 오래된 답장이에요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '반영하지 않기' }));
    expect(router.state.location.pathname).toBe('/meetings/meeting001');
  });
});

describe('확정 장소 화면', () => {
  it.each([1280, 390])(
    '%i 폭에서 기기에 맞는 길찾기를 보이고 출발지 없는 참석자는 이름만 보인다',
    async (width) => {
      const doc = finalFromMeeting({ ...meeting(), mode: f('straight'), decided: f('choice01') })!;
      await renderLinked(sampleLibrary(), { path: await link(doc), width });
      expect(screen.getByRole('heading', { level: 1, name: '친구 모임' })).toBeInTheDocument();
      expect(screen.getByTestId('meeting-map')).toBeInTheDocument();
      const directions = screen.getByRole('link', { name: '친구 출발 길찾기' });
      expect(directions.getAttribute('href')).toContain(
        width === 390 ? 'nmap://route/public?' : '/-/transit',
      );
      if (width === 1280) expect(directions).toHaveAttribute('target', '_blank');
      else expect(directions).not.toHaveAttribute('target');
      expect(
        screen.queryByRole('link', { name: '출발지 없는 친구 출발 길찾기' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('출발지 없는 친구')).toBeInTheDocument();
    },
  );
});

it('StrictMode에서도 복원한 친구 출발지의 계산이 끝나 답장을 보낼 수 있다', async () => {
  const routeLookup = Layer.succeed(
    RouteLookup,
    RouteLookup.of({
      leg: (mode) =>
        Effect.succeed({
          mode,
          durationS: 4200,
          distanceM: 1000,
          tollFare: null,
          path: [],
          queriedAt: now,
          seq: 1,
          fresh: false,
        }),
    }),
  );
  const { store, storage } = await renderLinked(sampleLibrary(), {
    path: '/meetings',
    routeLookup,
  });
  cleanup();
  vi.stubGlobal('localStorage', storage);
  saveMeetDraft(
    'meeting001',
    {
      participantId: 'person02',
      likes: [],
      origin: { name: '새 집', lng: 127.2, lat: 37.5 },
    },
    storage,
  );
  render(
    <Provider store={store}>
      <MemoryRouter>
        <InviteView doc={invite()} />
      </MemoryRouter>
    </Provider>,
    { wrapper: StrictMode },
  );
  await waitFor(() => expect(screen.getAllByText('1시간 10분')).toHaveLength(2));
  expect(screen.getByText('10분')).toBeInTheDocument();
  expect(screen.queryByText('내 소요시간을 다시 찾는 중이에요')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '답장 링크 보내기' })).toBeEnabled();
});

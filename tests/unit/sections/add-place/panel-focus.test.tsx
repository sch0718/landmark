import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PlaceLookupError } from 'src/services/errors';
import type { FolderResult } from 'src/server/resolve';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addOpenerAtom } from 'src/stores/add-place';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });
const plus = () => screen.getByRole('button', { name: '장소 추가' });

/** ＋추가 → 시트 항목을 고른다. */
async function openFrom(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(plus());
  const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
  await user.click(within(sheet).getByRole('button', { name: new RegExp(item) }));
  await waitFor(() => expect(sheet).not.toBeInTheDocument());
}

/** 늘 같은 네이버 장소를 돌려주는 장소 조회. */
const placeLookup = Layer.succeed(
  PlaceLookup,
  PlaceLookup.of({
    lookupLink: () =>
      Effect.succeed({
        kind: 'place',
        provider: 'naver',
        providerId: '1958911015',
        name: '콤포트',
        address: '서울특별시 용산구 두텁바위로60길 45',
        lng: 126.977,
        lat: 37.546,
        category: '카페,디저트',
      } as const),
    lookupFolder: () => Effect.fail(new PlaceLookupError({ code: 'OFFLINE' })),
  }),
);

describe('추가 칸 포커스 (넓은·중간 화면)', () => {
  it.each([
    ['넓은 화면', 1280],
    ['중간 화면', 1024],
  ])(
    '%s: ＋ → 링크 붙여넣기면 링크 입력칸에 포커스, Esc면 칸을 닫고 ＋로 돌아온다',
    async (_, width) => {
      const user = userEvent.setup();
      const { store } = await renderLibrary(sampleLibrary(), { width });
      await openFrom(user, '링크 붙여넣기');
      const input = await within(panel()).findByRole('textbox', { name: '링크' });
      await waitFor(() => expect(input).toHaveFocus());

      await user.keyboard('{Escape}');
      expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
      expect(queryPanel()).not.toBeInTheDocument();
      expect(plus()).toHaveFocus();
    },
  );

  it('단계 파일을 받은 뒤에 그려져도 링크 입력칸에 포커스한다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { preloadPanels: false });
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('다음 단계(확인 카드)가 열리면 그 단계의 첫 입력칸에 포커스한다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { placeLookup });
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.paste('https://naver.me/Fk73Vab5');
    await user.keyboard('{Enter}');
    const address = await within(panel()).findByRole('textbox', { name: '주소' });
    await waitFor(() => expect(address).toHaveFocus());
  });

  it('공유 파일 가져오기를 고르면 파일 고르기 버튼에 포커스한다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary());
    await openFrom(user, '공유 파일 가져오기');
    const pick = await screen.findByRole('button', { name: '파일 고르기' });
    await waitFor(() => expect(pick).toHaveFocus());
  });

  it('칸 안의 요소가 먼저 받아 기본 동작을 막은 Esc로는 칸을 닫지 않는다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    // 열린 메뉴처럼 칸 안의 요소가 Esc를 자기 몫으로 처리한다.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.preventDefault();
    });
    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
    expect(input).toHaveFocus();
  });

  it('칸 안의 요소가 전파를 멈춘 Esc로도 칸을 닫지 않는다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopPropagation();
    });
    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'link', hint: 'place' });
  });

  it('＋가 아닌 곳에서 연 흐름을 Esc로 닫으면 본문으로 포커스한다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    act(() => store.set(addFlowAtom, { step: 'link', hint: 'place' }));
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(queryPanel()).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('추가 시트 포커스 (좁은 화면)', () => {
  it('＋ → 링크 붙여넣기면 시트가 아니라 링크 입력칸에 포커스한다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { width: 390 });
    await openFrom(user, '링크 붙여넣기');
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    const input = await within(sheet).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
  });
});

/** 폴더 링크로 답하고, 폴더 조회는 `folder`가 풀릴 때까지 "찾는 중"인 장소 조회. */
function folderLookup() {
  let resolve!: (value: FolderResult) => void;
  const folder = new Promise<FolderResult>((r) => (resolve = r));
  const layer = Layer.succeed(
    PlaceLookup,
    PlaceLookup.of({
      lookupLink: () => Effect.succeed({ kind: 'folder', shareId: 'abc123' } as const),
      lookupFolder: () => Effect.promise(() => folder),
    }),
  );
  return { layer, resolve };
}

describe('추가 칸 포커스 — 폴더 단계', () => {
  it('목록이 오면 첫 조작 요소로 포커스를 옮기고, Esc로 닫으면 ＋로 돌아온다', async () => {
    const user = userEvent.setup();
    const lookup = folderLookup();
    const { store } = await renderLibrary(sampleLibrary(), { placeLookup: lookup.layer });
    await openFrom(user, '네이버 폴더 가져오기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.paste('https://naver.me/5Iiuye7j');
    await user.keyboard('{Enter}');
    // 찾는 중에는 `취소`가 첫 조작 요소다.
    const cancel = await within(panel()).findByRole('button', { name: '취소' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await act(async () =>
      lookup.resolve({
        folderName: '속초 맛집',
        places: [
          {
            sid: '9101',
            name: '폴더 장소',
            address: '강원특별자치도 속초시 해맞이로 1',
            lng: 128.5,
            lat: 38.2,
            memo: '',
          },
        ],
      }),
    );
    await within(panel()).findByRole('heading', { name: /속초 맛집/ });
    // `찾는 중` 화면이 목록으로 바뀌어도 포커스가 본문(body)으로 빠지지 않고 목록의 첫 조작 요소로 간다.
    const first = within(panel()).getByRole('textbox', { name: '붙일 라벨 이름' });
    await waitFor(() => expect(first).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(plus()).toHaveFocus();
  });
});

describe('추가 칸을 닫으면 포커스를 돌려준다', () => {
  it.each(['닫기', '취소'])('%s를 누르면 칸을 닫고 ＋로 돌아온다', async (button) => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.click(within(panel()).getByRole('button', { name: button }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
    expect(queryPanel()).not.toBeInTheDocument();
    expect(plus()).toHaveFocus();
  });

  it('보관함 밖 화면(라벨 관리)의 떠 있는 칸을 닫아도 ＋로 돌아온다', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { path: '/labels' });
    await openFrom(user, '링크 붙여넣기');
    const input = await within(panel()).findByRole('textbox', { name: '링크' });
    await waitFor(() => expect(input).toHaveFocus());
    await user.click(within(panel()).getByRole('button', { name: '닫기' }));
    expect(queryPanel()).not.toBeInTheDocument();
    expect(plus()).toHaveFocus();
  });

  it('흐름이 닫히면 연 요소를 잊어, 다음에 ＋ 없이 연 흐름은 본문으로 돌아온다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    await openFrom(user, '링크 붙여넣기');
    expect(store.get(addOpenerAtom)).toBe(plus());
    await user.click(within(panel()).getByRole('button', { name: '취소' }));
    expect(store.get(addOpenerAtom)).toBeNull();

    // 공유 파일을 끌어 놓거나 `/import`로 들어온 것처럼 ＋ 없이 흐름을 연다.
    act(() => store.set(addFlowAtom, { step: 'share-pick' }));
    const pick = await screen.findByRole('button', { name: '파일 고르기' });
    await waitFor(() => expect(pick).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('＋로 연 시트를 항목 없이 닫았다면 연 요소를 잊어, 다음에 ＋ 없이 연 흐름은 본문으로 돌아온다', async () => {
    const user = userEvent.setup();
    const { store } = await renderLibrary(sampleLibrary());
    const opener = plus();
    await user.click(opener);
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    expect(store.get(addOpenerAtom)).toBe(opener);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(store.get(addOpenerAtom)).toBeNull();

    act(() => store.set(addFlowAtom, { step: 'share-pick' }));
    const pick = await screen.findByRole('button', { name: '파일 고르기' });
    await waitFor(() => expect(pick).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom } from 'src/stores/add-place';
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

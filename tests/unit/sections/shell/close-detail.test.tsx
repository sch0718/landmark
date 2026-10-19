import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { installMapResources } from '../../components/helpers/map-resources';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  resources = installMapResources();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  resources.restore();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const detail = () => screen.getByRole('region', { name: '장소 상세' });
const closeButton = () => within(detail()).getByRole('button', { name: '닫기' });
/** 중간 폭의 상세 패널은 장소를 연 뒤에야 그려지므로 나타날 때까지 기다린다. */
/**
 * jsdom은 배치를 하지 않는다. 목록 행은 `rowTop`부터 56px 높이, 나머지 요소(스크롤 칸 포함)는 0~600px 자리에
 * 있는 것처럼 심는다.
 */
function placeRows(rowTop: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top, height] = this.hasAttribute('data-place-id') ? [rowTop, 56] : [0, 600];
    return DOMRect.fromRect({ x: 0, y: top, width: 360, height });
  });
}
const findCloseButton = async () =>
  within(await screen.findByRole('region', { name: '장소 상세' })).findByRole('button', {
    name: '닫기',
  });

describe('상세 닫기 (넓은·중간)', () => {
  it('넓은 화면 상세 칸에도 닫기가 있고, 누르면 목록으로 돌아가 안내만 남는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 1280,
      path: `/place/${id(2)}`,
    });
    await user.click(closeButton());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(detail()).toHaveTextContent('장소를 고르면 여기에 보여요');
    expect(within(detail()).queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();
  });

  it.each([1280, 1100])('%ipx: 지도 화면에서 열었으면 닫을 때 /map으로 돌아간다', async (width) => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width, path: '/map' });
    await router.navigate(`/place/${id(2)}`);
    await user.click(await findCloseButton());
    await waitFor(() => expect(router.state.location.pathname).toBe('/map'));
  });

  it('중간 화면에서 목록에서 열었으면 /로 돌아간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1100, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await user.click(await findCloseButton());
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('Esc로 닫는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await findCloseButton();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('입력칸에서 누른 Esc로는 닫지 않는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await findCloseButton();
    await user.click(screen.getByRole('searchbox', { name: '장소 검색' }));
    await user.keyboard('{Escape}');
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('메뉴가 열려 있으면 Esc는 메뉴만 닫는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), { width: 1280, path: '/' });
    await router.navigate(`/place/${id(2)}`);
    await findCloseButton();
    // 정렬 메뉴(목록 칸)를 연다. 단추 이름은 지금 정렬이라 `aria-haspopup`으로 찾는다.
    await user.click(document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);
  });

  it('잘린 이름 툴팁이 열려 있으면 Esc는 툴팁만 닫고, 다음 Esc가 장소를 닫는다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 1280,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await router.navigate(`/place/${id(2)}`);
    await findCloseButton();
    const row = document.querySelector<HTMLElement>(`[data-place-id="${id(2)}"]`)!;
    const name = row.querySelector<HTMLElement>('[data-truncated-text]')!;
    // jsdom은 배치가 없어 넘침 크기를 심는다.
    Object.defineProperty(name, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 240 });
    // 키보드 입력 뒤의 포커스라 툴팁이 뜬다.
    await user.keyboard('{Shift}');
    row.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(name.textContent!);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`/place/${id(2)}`);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('닫기를 키보드로 누르면 포커스가 연 장소의 목록 행으로 간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 1280,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await router.navigate(`/place/${id(2)}`);
    placeRows(100); // 행이 목록 칸의 보이는 자리에 있다.
    (await findCloseButton()).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-place-id', id(2)));
  });

  it('연 장소의 행이 목록 칸의 보이는 자리 밖이면 닫은 뒤 포커스는 본문으로 간다', async () => {
    const user = userEvent.setup();
    const { router } = await renderLibrary(sampleLibrary(), {
      width: 1280,
      path: '/',
      prefs: { libraryView: 'list' },
    });
    await router.navigate(`/place/${id(2)}`);
    placeRows(650); // 스크롤 복원으로 행이 칸(0~600) 아래로 밀려났다. 창(768) 안이어도 칸 밖이다.
    (await findCloseButton()).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'main'));
  });
});

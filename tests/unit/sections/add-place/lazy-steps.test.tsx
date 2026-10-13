import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { addFlowAtom, type AddFlow } from 'src/stores/add-place';
import { SHARE_DOC } from '../share-import/share-fixtures';
import { mockViewport, renderApp } from '../shell/harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

// 단계 파일 받기를 문으로 붙잡아, 기다리는 동안의 칸을 볼 수 있게 한다. `React.lazy`와 모듈 상태는 이 파일 안에서
// 테스트끼리 이어지므로, 문을 붙잡는 단계는 자기 테스트에서만 처음 받는다.
const gates = vi.hoisted(() => {
  const make = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { open, opened };
  };
  return { link: make(), sharePick: make(), folder: make() };
});
vi.mock('src/sections/add-place/LinkInputPanel', async (importOriginal) => {
  await gates.link.opened;
  return importOriginal();
});
vi.mock('src/sections/share-import/SharePickPanel', async (importOriginal) => {
  await gates.sharePick.opened;
  return importOriginal();
});

vi.mock('src/sections/add-place/FolderPreview', async (importOriginal) => {
  await gates.folder.opened;
  return importOriginal();
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const panel = () => screen.getByRole('region', { name: '장소 추가' });
const queryPanel = () => screen.queryByRole('region', { name: '장소 추가' });

async function openStep(flow: AddFlow) {
  mockViewport(1280);
  const rendered = await renderApp({ preloadPanels: false });
  await act(async () => {
    rendered.store.set(addFlowAtom, flow);
  });
  return rendered;
}

describe('추가 칸 단계 나눠 받기', () => {
  it('단계 파일을 받는 동안 칸 안에 기다림 표시가 뜨고, 받으면 그 단계 화면이 나타난다', async () => {
    await openStep({ step: 'link', hint: 'place' });
    expect(within(panel()).getByText('불러오는 중…')).toHaveAttribute('role', 'status');
    expect(within(panel()).queryByRole('textbox', { name: '링크' })).not.toBeInTheDocument();

    gates.link.open();
    expect(await within(panel()).findByRole('textbox', { name: '링크' })).toBeInTheDocument();
    expect(within(panel()).queryByText('불러오는 중…')).not.toBeInTheDocument();
  });

  it('받는 중에 흐름을 닫으면 늦게 온 모듈이 칸을 다시 열지 않는다', async () => {
    const user = userEvent.setup();
    const { store } = await openStep({ step: 'share-pick' });
    expect(within(panel()).getByText('불러오는 중…')).toBeInTheDocument();

    await user.click(within(panel()).getByRole('button', { name: '닫기' }));
    expect(queryPanel()).not.toBeInTheDocument();

    gates.sharePick.open();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(queryPanel()).not.toBeInTheDocument();
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });

    // 받은 뒤에는 같은 단계가 바로 열린다.
    await act(async () => {
      store.set(addFlowAtom, { step: 'share-pick' });
    });
    expect(await within(panel()).findByLabelText('공유 파일 선택')).toBeInTheDocument();
  });

  // 좁은 화면 시트에는 닫기 버튼이 없고 단계의 `취소`는 파일이 와야 보이므로, 받는 동안에도 `취소`가 있어야 한다.
  it('좁은 화면은 받는 동안 시트에 취소 버튼이 있고 누르면 흐름이 닫힌다', async () => {
    const user = userEvent.setup();
    mockViewport(390);
    const { store } = await renderApp({ preloadPanels: false });
    await act(async () => {
      store.set(addFlowAtom, { step: 'folder', shareId: 'abc123' });
    });
    const sheet = await screen.findByRole('dialog', { name: '장소 추가' });
    expect(within(sheet).getByText('불러오는 중…')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '취소' }));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });

  it('넓은 화면은 받는 동안 따로 취소 버튼을 두지 않는다(닫기가 칸 머리에 있다)', async () => {
    mockViewport(1280);
    const { store } = await renderApp({ preloadPanels: false });
    await act(async () => {
      store.set(addFlowAtom, { step: 'folder', shareId: 'abc123' });
    });
    expect(within(panel()).getByText('불러오는 중…')).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  it('확인 카드·폴더 미리보기·핀 카드·공유 미리보기도 열리면 그 화면이 나타난다', async () => {
    const candidate = {
      source: { kind: 'naver' as const, sid: '1958911015' },
      name: '콤포트',
      address: '서울특별시 용산구 두텁바위로60길 45',
      lng: 126.977,
      lat: 37.546,
      category: null,
    };
    gates.folder.open();
    const { store } = await openStep({ step: 'candidate', candidate });
    expect(await within(panel()).findByRole('heading', { name: '콤포트' })).toBeInTheDocument();

    await act(async () => {
      store.set(addFlowAtom, { step: 'folder', shareId: 'abc123' });
    });
    expect(
      await within(panel()).findByRole('heading', { name: '네이버 폴더 가져오기' }),
    ).toBeInTheDocument();

    await act(async () => {
      store.set(addFlowAtom, { step: 'pin-card', name: '', lng: 128.9, lat: 37.7 });
    });
    expect(
      await within(panel()).findByRole('heading', { name: '지도에서 핀 찍기' }),
    ).toBeInTheDocument();

    await act(async () => {
      store.set(addFlowAtom, { step: 'share', doc: SHARE_DOC });
    });
    expect(
      await within(panel()).findByRole('button', { name: '2곳 가져오기' }),
    ).toBeInTheDocument();
  });
});

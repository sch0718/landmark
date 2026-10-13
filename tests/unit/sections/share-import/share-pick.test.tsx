import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { addFlowAtom } from 'src/stores/add-place';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { plainHtmlFile, SHARE_DOC, shareFile } from './share-fixtures';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

const NOT_SHARE = 'Landmark 공유 파일이 아니에요';

async function openPick(width = 1280) {
  const rendered = await renderLibrary(sampleLibrary(), { path: '/import', width });
  const panel = await screen.findByRole('region', { name: '공유 파일 가져오기' });
  return { ...rendered, panel };
}

describe('SharePickPanel', () => {
  it('shows the title, description and the pick button', async () => {
    const { panel } = await openPick();
    expect(within(panel).getByRole('heading', { name: '공유 파일 가져오기' })).toBeInTheDocument();
    expect(
      within(panel).getByText(
        '받은 Landmark 공유 파일(.html)을 고르면 장소를 미리 보고 내 보관함에 넣어요',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '파일 고르기' })).toBeEnabled();
    const input = panel.querySelector('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', '.html,.htm,text/html');
  });

  it('shows the drop hint only on wide/medium layouts', async () => {
    const wide = await openPick(1280);
    expect(within(wide.panel).getByText('여기로 끌어 놓아도 돼요')).toBeInTheDocument();
    cleanup();
    const compact = await openPick(390);
    expect(within(compact.panel).queryByText('여기로 끌어 놓아도 돼요')).toBeNull();
  });

  it('shows the error inside the panel and clears it on the next pick', async () => {
    const user = userEvent.setup();
    const { panel, store } = await openPick();
    const input = panel.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, plainHtmlFile());
    expect(await within(panel).findByText(NOT_SHARE)).toBeInTheDocument();
    expect(store.get(addFlowAtom)).toEqual({ step: 'share-pick' });

    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const file = shareFile();
    const realText = file.text.bind(file);
    vi.spyOn(file, 'text').mockImplementation(async () => {
      await gate;
      return realText();
    });
    await user.upload(input, file);
    expect(within(panel).queryByText(NOT_SHARE)).toBeNull();
    expect(within(panel).getByText('읽는 중…')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '파일 고르기' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(store.get(addFlowAtom).step).toBe('share'));
  });

  it('moves to the share step with the same doc on a valid file', async () => {
    const user = userEvent.setup();
    const { panel, store } = await openPick();
    await user.upload(panel.querySelector('input[type="file"]') as HTMLInputElement, shareFile());
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share', doc: SHARE_DOC }));
  });

  it('reads the first dropped file on wide layouts', async () => {
    const { panel, store } = await openPick(1280);
    const over = createEvent.dragOver(panel, { dataTransfer: { files: [] } });
    fireEvent(panel, over);
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(panel, { dataTransfer: { files: [shareFile(), plainHtmlFile()] } });
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share', doc: SHARE_DOC }));
  });

  it('ignores drops on the compact layout', async () => {
    const { panel, store } = await openPick(390);
    const over = createEvent.dragOver(panel, { dataTransfer: { files: [] } });
    fireEvent(panel, over);
    expect(over.defaultPrevented).toBe(false);
    fireEvent.drop(panel, { dataTransfer: { files: [shareFile()] } });
    await act(async () => undefined);
    expect(store.get(addFlowAtom)).toEqual({ step: 'share-pick' });
  });
});

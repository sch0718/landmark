import { act, cleanup, createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { addFlowAtom, openAddSheetAtom } from 'src/stores/add-place';
import { renderLibrary, sampleLibrary } from '../library/fixtures';
import { plainHtmlFile, SHARE_DOC, shareFile } from './share-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  toastMock.mockClear();
  toastMock.error.mockClear();
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
});

const OVERLAY = '여기에 놓으면 가져와요';
const FILES = { types: ['Files'] };

const dragEnter = (dataTransfer: object = FILES) => {
  const event = createEvent.dragEnter(window, { dataTransfer });
  act(() => {
    fireEvent(window, event);
  });
  return event;
};
const dragLeave = (dataTransfer: object = FILES) =>
  act(() => {
    fireEvent.dragLeave(window, { dataTransfer });
  });

describe('ShareDropOverlay', () => {
  it('shows the overlay while a file is dragged over and hides it on leave', async () => {
    await renderLibrary(sampleLibrary());
    expect(screen.queryByText(OVERLAY)).toBeNull();
    const enter = dragEnter();
    expect(enter.defaultPrevented).toBe(true);
    expect(screen.getByText(OVERLAY)).toBeInTheDocument();
    dragLeave();
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('works on the map route too', async () => {
    await renderLibrary(sampleLibrary(), { path: '/map' });
    dragEnter();
    expect(screen.getByText(OVERLAY)).toBeInTheDocument();
  });

  it('counts enters and leaves so crossing child elements does not flicker', async () => {
    await renderLibrary(sampleLibrary());
    dragEnter();
    dragEnter(); // 자식 요소로 들어감
    dragLeave(); // 부모에서 나감
    expect(screen.getByText(OVERLAY)).toBeInTheDocument();
    dragLeave();
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('allows dropping by cancelling dragover for files only', async () => {
    await renderLibrary(sampleLibrary());
    const over = createEvent.dragOver(window, { dataTransfer: FILES });
    fireEvent(window, over);
    expect(over.defaultPrevented).toBe(true);
    const text = createEvent.dragOver(window, { dataTransfer: { types: ['text/plain'] } });
    fireEvent(window, text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('ignores dragged text', async () => {
    await renderLibrary(sampleLibrary());
    const enter = dragEnter({ types: ['text/plain'] });
    expect(enter.defaultPrevented).toBe(false);
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('reads the first dropped file and opens the share preview', async () => {
    const { store } = await renderLibrary(sampleLibrary());
    dragEnter();
    const drop = createEvent.drop(window, {
      dataTransfer: { ...FILES, files: [shareFile(), plainHtmlFile()] },
    });
    act(() => {
      fireEvent(window, drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByText(OVERLAY)).toBeNull();
    await waitFor(() => expect(store.get(addFlowAtom)).toEqual({ step: 'share', doc: SHARE_DOC }));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('toasts the error for a file that is not a share file', async () => {
    const { store } = await renderLibrary(sampleLibrary());
    dragEnter();
    fireEvent.drop(window, { dataTransfer: { ...FILES, files: [plainHtmlFile()] } });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Landmark 공유 파일이 아니에요'));
    expect(store.get(addFlowAtom)).toEqual({ step: 'closed' });
  });

  it('shows nothing on the compact layout', async () => {
    await renderLibrary(sampleLibrary(), { width: 390 });
    const enter = dragEnter();
    expect(enter.defaultPrevented).toBe(false);
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('shows nothing outside the library and map routes', async () => {
    await renderLibrary(sampleLibrary(), { path: '/trips' });
    const enter = dragEnter();
    expect(enter.defaultPrevented).toBe(false);
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('shows nothing while an add flow is open', async () => {
    const { store } = await renderLibrary(sampleLibrary());
    act(() => store.set(openAddSheetAtom, null));
    act(() => store.set(addFlowAtom, { step: 'share-pick' }));
    const enter = dragEnter();
    expect(enter.defaultPrevented).toBe(false);
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });

  it('hides the overlay when an add flow opens during a drag', async () => {
    const { store } = await renderLibrary(sampleLibrary());
    dragEnter();
    expect(screen.getByText(OVERLAY)).toBeInTheDocument();
    act(() => store.set(addFlowAtom, { step: 'share-pick' }));
    expect(screen.queryByText(OVERLAY)).toBeNull();
  });
});

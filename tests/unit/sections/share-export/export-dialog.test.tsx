import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('src/lib/download-text', () => ({ downloadText: downloadMock }));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

const TEMPLATE_FAILED =
  '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요';
const SHARE_FAILED = '공유하지 못했어요. 파일 저장을 이용해 주세요';
const TEMPLATE = `<!doctype html><script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script>`;
const LIST = { libraryView: 'list' as const };

/** 공유 API를 흉내 낸다. 돌려준 정리 함수로 지운다. */
function stubShare(share: (data: ShareData) => Promise<void>) {
  const canShare = vi.fn(() => true);
  const shareFn = vi.fn(share);
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
  Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true });
  return { canShare, share: shareFn };
}

beforeEach(() => {
  // 파일 이름의 날짜를 고정한다(타이머는 진짜 그대로).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 11, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  toastMock.mockClear();
  toastMock.error.mockClear();
  downloadMock.mockClear();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

const dialog = () => screen.getByRole('dialog', { name: '내보내기' });
const saveButton = () => within(dialog()).getByRole('button', { name: '파일 저장' });
const titleInput = () => within(dialog()).getByRole('textbox', { name: '제목' });
const row = (name: RegExp) =>
  within(screen.getByRole('list', { name: '장소 목록' })).getByRole('button', { name });

/** 저장한 html의 데이터 블록을 읽는다. */
function savedDoc(): { title: string; places: Array<{ id: string; memo?: string }> } {
  const html = downloadMock.mock.calls[0]![0] as string;
  const m = /<script type="application\/json" id="tripmap-share">(.*)<\/script>/s.exec(html);
  return JSON.parse(m![1]!) as ReturnType<typeof savedDoc>;
}

async function openFromToolbar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '내보내기' }));
  return dialog();
}

describe('export html dialog', () => {
  it('toolbar button opens the dialog with the target summary and default title', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);
    expect(within(d).getByText('지금 보이는 5곳을 내보냅니다')).toBeInTheDocument();
    expect(titleInput()).toHaveValue('장소 5곳');
    expect(within(d).getByRole('checkbox', { name: '메모 포함' })).toBeChecked();
    expect(saveButton()).toBeEnabled();
  });

  it('save downloads the html once, toasts and closes', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await openFromToolbar(user);
    await user.click(saveButton());

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [html, fileName, type] = downloadMock.mock.calls[0]!;
    expect(html).toContain('<script type="application/json" id="tripmap-share">');
    expect(html).not.toContain(SHARE_DATA_PLACEHOLDER);
    expect(fileName).toBe('장소-5곳-20261011.html');
    expect(type).toBe('text/html;charset=utf-8');
    const doc = savedDoc();
    expect(doc.title).toBe('장소 5곳');
    // 목록과 같은 순서(최근 저장순).
    expect(doc.places.map((p) => p.id)).toEqual([
      'place00005',
      'place00004',
      'place00003',
      'place00002',
      'place00001',
    ]);
    expect(html).toContain('비밀 메모');
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
    expect(toastMock.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('uses the trimmed title and leaves memos out when unchecked', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await openFromToolbar(user);
    await user.clear(titleInput());
    await user.type(titleInput(), '  강릉 여행  ');
    await user.click(within(dialog()).getByRole('checkbox', { name: '메모 포함' }));
    await user.click(saveButton());

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(downloadMock.mock.calls[0]![1]).toBe('강릉-여행-20261011.html');
    expect(savedDoc().title).toBe('강릉 여행');
    expect(downloadMock.mock.calls[0]![0]).not.toContain('비밀 메모');
  });

  it('a fast double click saves only once (busy guard)', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await openFromToolbar(user);
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요'));
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('nothing to export → buttons disabled with a reason', async () => {
    const user = userEvent.setup();
    stubShare(() => Promise.resolve());
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await user.type(screen.getByRole('searchbox', { name: '장소 검색' }), '없는말');
    const d = await openFromToolbar(user);
    expect(within(d).getByText('지금 보이는 0곳을 내보냅니다 (검색: 없는말)')).toBeInTheDocument();
    expect(within(d).getByText('내보낼 장소가 없어요')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(within(d).getByRole('button', { name: '공유' })).toBeDisabled();
  });

  it('label filter names the label and becomes the default title', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await user.click(
      within(screen.getByRole('group', { name: '라벨' })).getByRole('button', { name: /카페/ }),
    );
    const d = await openFromToolbar(user);
    expect(within(d).getByText('지금 보이는 1곳을 내보냅니다 (라벨: 카페)')).toBeInTheDocument();
    expect(titleInput()).toHaveValue('카페');
  });

  it('title must be 1–60 characters after trimming', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);

    await user.clear(titleInput());
    await user.type(titleInput(), '   ');
    expect(saveButton()).toBeDisabled();
    expect(within(d).getByText('제목은 1~60자로 써 주세요')).toBeInTheDocument();

    await user.clear(titleInput());
    await user.type(titleInput(), '가'.repeat(61));
    expect(saveButton()).toBeDisabled();

    await user.type(titleInput(), '{Backspace}');
    expect(saveButton()).toBeEnabled();
    expect(within(d).queryByText('제목은 1~60자로 써 주세요')).not.toBeInTheDocument();
  });

  it('template failure shows the message in the dialog and can be retried', async () => {
    const user = userEvent.setup();
    let body: string | Error = new Error('offline');
    await renderLibrary(sampleLibrary(), { prefs: LIST, shareTemplate: () => body });
    const d = await openFromToolbar(user);
    await user.click(saveButton());

    expect(await within(d).findByRole('alert')).toHaveTextContent(TEMPLATE_FAILED);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();

    body = TEMPLATE;
    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요');
  });

  it('reopening resets title, memo checkbox and error', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), {
      prefs: LIST,
      shareTemplate: new Error('offline'),
    });
    await openFromToolbar(user);
    await user.clear(titleInput());
    await user.type(titleInput(), '바꾼 제목');
    await user.click(within(dialog()).getByRole('checkbox', { name: '메모 포함' }));
    await user.click(saveButton());
    await within(dialog()).findByRole('alert');

    await user.click(within(dialog()).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const d = await openFromToolbar(user);
    expect(titleInput()).toHaveValue('장소 5곳');
    expect(within(d).getByRole('checkbox', { name: '메모 포함' })).toBeChecked();
    expect(within(d).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('share button only when files can be shared', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);
    expect(within(d).queryByRole('button', { name: '공유' })).not.toBeInTheDocument();
  });

  it('share sends the html file with the title, then toasts and closes', async () => {
    const user = userEvent.setup();
    const { canShare, share } = stubShare(() => Promise.resolve());
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);
    expect(canShare).toHaveBeenCalled();
    await user.click(within(d).getByRole('button', { name: '공유' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0]![0];
    expect(data.title).toBe('장소 5곳');
    const file = data.files![0]!;
    expect(file.name).toBe('장소-5곳-20261011.html');
    expect(file.type).toBe('text/html');
    expect(await file.text()).toContain('비밀 메모');
    expect(downloadMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('파일을 만들었어요'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancelled share (AbortError) stays silent and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const { share } = stubShare(() => Promise.reject(new DOMException('취소', 'AbortError')));
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);
    const button = within(d).getByRole('button', { name: '공유' });
    await user.click(button);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).toBeEnabled());
    expect(within(d).queryByRole('alert')).not.toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it('other share errors show the share failure message', async () => {
    const user = userEvent.setup();
    stubShare(() => Promise.reject(new Error('NotAllowedError')));
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    const d = await openFromToolbar(user);
    await user.click(within(d).getByRole('button', { name: '공유' }));

    expect(await within(d).findByRole('alert')).toHaveTextContent(SHARE_FAILED);
    expect(toastMock).not.toHaveBeenCalled();
    expect(within(d).getByRole('button', { name: '공유' })).toBeEnabled();
  });

  it('bulk bar export uses the selection', async () => {
    const user = userEvent.setup();
    await renderLibrary(sampleLibrary(), { prefs: LIST });
    await user.keyboard('{Shift>}');
    await user.click(row(/속초 횟집/));
    await user.click(row(/창가 자리/));
    await user.keyboard('{/Shift}');

    const bar = screen.getByRole('toolbar', { name: '일괄 편집' });
    await user.click(within(bar).getByRole('button', { name: '내보내기' }));
    expect(within(dialog()).getByText('선택한 2곳을 내보냅니다')).toBeInTheDocument();
    expect(titleInput()).toHaveValue('장소 2곳');

    await user.click(saveButton());
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(savedDoc().places.map((p) => p.id)).toEqual(['place00005', 'place00003']);
  });
});

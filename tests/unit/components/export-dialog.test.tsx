import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore } from 'jotai';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from 'src/app';
import { installMapResources } from './helpers/map-resources';
import { decodeEditLayer, encodeEditLayer } from 'src/domain/codec';
import { createMemoryStorage, storageKey } from 'src/repositories/edit-layer-repo';
import { routes } from 'src/routes/router';
import type { EditLayer } from 'src/schema/edit-layer';
import type { TripData } from 'src/schema/trip-data';
import {
  buildExportLink,
  exportFileName,
  isLinkOverLimit,
  isLinkTooLong,
} from 'src/sections/share/store/export-link';
import { TripDepsContext } from 'src/stores/trip-store';
import { makeEdit, makeTrip } from '../../fixtures/builders';

const PID = 'testtrip0001';
const KEY = storageKey(PID);
const NOW_MS = 1759460000000;
const NOW_ISO = '2026-10-03T02:00:00.000Z';
const OLD = '2026-10-03T00:30:00.000Z';
const D1 = '2026-11-14';

const trip = makeTrip({ days: { [D1]: ['A', 'B'] } });

const memoEdit = (): EditLayer =>
  makeEdit({
    places: { 'n:1': { memos: { 'a-local': { text: '꼭 가 보기', updatedAt: OLD } } } },
  });

function renderPage(opts: { trip?: TripData; edit?: EditLayer; storage?: Storage } = {}) {
  vi.stubEnv('VITE_MAP_ADAPTER', 'fake');
  const storage = opts.storage ?? createMemoryStorage();
  if (opts.edit) storage.setItem(KEY, JSON.stringify(opts.edit));
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(JSON.stringify(opts.trip ?? trip), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [`/t/${PID}`] });
  render(
    <TripDepsContext
      value={{
        storage,
        fetchFn,
        now: () => NOW_MS,
        nowIso: () => NOW_ISO,
        jotaiStore: createStore(),
      }}
    >
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </TripDepsContext>,
  );
  return { storage };
}

type NavOverrides = { share?: unknown; clipboard?: unknown };
function setNavigator({ share, clipboard }: NavOverrides) {
  Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: clipboard });
}

async function openExport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '설정' }));
  await user.click(await screen.findByRole('menuitem', { name: /내보내기/ }));
  return screen.findByRole('dialog', { name: '편집 내보내기' });
}

/** 압축이 거의 안 되는 메모로 링크를 길게 만든다(기본 6개 → 8,000자 초과·16,000자 이하). */
function bigEdit(count = 6): EditLayer {
  let seed = 7;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789가나다라마바사';
  const text = () =>
    Array.from({ length: 2000 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return alphabet[seed % alphabet.length];
    }).join('');
  const places: EditLayer['places'] = {};
  for (let i = 1; i <= count; i++) {
    places[`n:${i}`] = { memos: { 'a-local': { text: text(), updatedAt: OLD } } };
  }
  return makeEdit({ places });
}

// 라우트가 TripPage를 지연 로드하므로, 부하가 큰 전체 실행에서 첫 테스트가 findBy 시간을 넘지 않게 미리 불러 둔다.
beforeAll(async () => {
  await import('src/pages/TripPage');
}, 20_000);

let mapResources: ReturnType<typeof installMapResources>;

beforeEach(() => {
  mapResources = installMapResources();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  mapResources.restore();
  setNavigator({ share: undefined, clipboard: undefined });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('export-link 헬퍼', () => {
  it('링크 형식', () => {
    expect(buildExportLink('https://x.dev', PID, 'abc')).toBe(`https://x.dev/t/${PID}#e=abc`);
  });

  it('8,000자까지는 그대로, 8,001자부터 파일 안내', () => {
    expect(isLinkTooLong('x'.repeat(8000))).toBe(false);
    expect(isLinkTooLong('x'.repeat(8001))).toBe(true);
  });

  it('16,000자까지는 링크 허용, 16,001자부터 링크 불가', () => {
    expect(isLinkOverLimit('x'.repeat(16000))).toBe(false);
    expect(isLinkOverLimit('x'.repeat(16001))).toBe(true);
  });

  it('파일명은 <제목>-<닉네임>-<YYYYMMDD>.tripedit.json(현지 날짜)', () => {
    expect(exportFileName('강원 여행', '나', new Date(2026, 9, 3, 23, 59))).toBe(
      '강원 여행-나-20261003.tripedit.json',
    );
    expect(exportFileName('a/b', 'c:d', new Date(2026, 0, 9))).toBe(
      'a_b-c_d-20260109.tripedit.json',
    );
  });
});

describe('ExportDialog', () => {
  it('share 없음·clipboard 있음 → 정확한 링크를 복사하고, 해독하면 원래 편집', async () => {
    const user = userEvent.setup();
    const edit = memoEdit();
    renderPage({ edit });
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    setNavigator({ share: undefined, clipboard: { writeText } });

    const dialog = await openExport(user);
    await user.click(await within(dialog).findByRole('button', { name: '링크 공유' }));

    expect(await within(dialog).findByText('링크를 복사했어요')).toBeInTheDocument();
    const expected = `${location.origin}/t/${PID}#e=${await encodeEditLayer(edit)}`;
    expect(writeText).toHaveBeenCalledWith(expected);
    const value = writeText.mock.calls[0]![0].split('#e=')[1]!;
    expect(await decodeEditLayer(value)).toEqual(edit);
  });

  it('share가 있으면 공유 시트를 먼저 띄운다', async () => {
    const user = userEvent.setup();
    const edit = memoEdit();
    renderPage({ edit });
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share, clipboard: { writeText } });

    const dialog = await openExport(user);
    await user.click(await within(dialog).findByRole('button', { name: '링크 공유' }));

    expect(await within(dialog).findByText('공유했어요')).toBeInTheDocument();
    expect(share).toHaveBeenCalledWith({
      title: '테스트 여행',
      url: `${location.origin}/t/${PID}#e=${await encodeEditLayer(edit)}`,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('share 실패 → clipboard로 넘어간다', async () => {
    const user = userEvent.setup();
    renderPage({ edit: memoEdit() });
    const share = vi.fn().mockRejectedValue(new Error('not allowed'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share, clipboard: { writeText } });

    const dialog = await openExport(user);
    await user.click(await within(dialog).findByRole('button', { name: '링크 공유' }));

    expect(await within(dialog).findByText('링크를 복사했어요')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('Review Focus 5: share·clipboard 모두 없음 → 링크 텍스트 필드', async () => {
    const user = userEvent.setup();
    const edit = memoEdit();
    renderPage({ edit });
    setNavigator({ share: undefined, clipboard: undefined });

    const dialog = await openExport(user);
    await user.click(await within(dialog).findByRole('button', { name: '링크 공유' }));

    const field = await within(dialog).findByRole('textbox', { name: '링크' });
    expect(field).toHaveValue(`${location.origin}/t/${PID}#e=${await encodeEditLayer(edit)}`);
    expect(field).toHaveAttribute('readonly');
  });

  it('Review Focus 5: share reject·clipboard reject → 링크 텍스트 필드', async () => {
    const user = userEvent.setup();
    const edit = memoEdit();
    renderPage({ edit });
    setNavigator({
      share: vi.fn().mockRejectedValue(new Error('no')),
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const dialog = await openExport(user);
    await user.click(await within(dialog).findByRole('button', { name: '링크 공유' }));

    const field = await within(dialog).findByRole('textbox', { name: '링크' });
    expect(field).toHaveValue(`${location.origin}/t/${PID}#e=${await encodeEditLayer(edit)}`);
  });

  it('8,000자 넘는 링크 → 파일 안내 문구와 파일 버튼 강조', async () => {
    const user = userEvent.setup();
    const edit = bigEdit();
    const link = buildExportLink(location.origin, PID, await encodeEditLayer(edit));
    expect(link.length).toBeGreaterThan(8000);
    expect(link.length).toBeLessThanOrEqual(16000);
    renderPage({ edit });

    const dialog = await openExport(user);
    expect(
      await within(dialog).findByText('링크가 길어요. 파일로 내보내 주세요'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '파일로 저장' })).toHaveClass(
      'MuiButton-contained',
    );
    // 16,000자 이하면 링크 공유는 여전히 가능하다.
    expect(within(dialog).getByRole('button', { name: '링크 공유' })).toBeEnabled();
  });

  it('16,000자 넘는 링크 → 링크 공유를 막고 파일 안내와 파일 버튼만 남긴다', async () => {
    const user = userEvent.setup();
    const share = vi.fn();
    const writeText = vi.fn();
    setNavigator({ share, clipboard: { writeText } });
    const edit = bigEdit(14);
    expect(
      buildExportLink(location.origin, PID, await encodeEditLayer(edit)).length,
    ).toBeGreaterThan(16000);
    renderPage({ edit });

    const dialog = await openExport(user);
    expect(
      await within(dialog).findByText('링크가 길어요. 파일로 내보내 주세요'),
    ).toBeInTheDocument();
    const shareButton = within(dialog).getByRole('button', { name: '링크 공유' });
    expect(shareButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '파일로 저장' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: '파일로 저장' })).toHaveClass(
      'MuiButton-contained',
    );
    expect(share).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('짧은 링크에는 파일 안내가 없다', async () => {
    const user = userEvent.setup();
    renderPage({ edit: memoEdit() });
    const dialog = await openExport(user);
    await within(dialog).findByRole('button', { name: '링크 공유' });
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '링크 공유' })).toBeEnabled(),
    );
    expect(within(dialog).queryByText('링크가 길어요. 파일로 내보내 주세요')).toBeNull();
  });

  it('파일로 저장 → 압축 안 한 JSON Blob을 파일명대로 내려받는다', async () => {
    const user = userEvent.setup();
    const edit = memoEdit();
    renderPage({ edit });
    let blob: Blob | undefined;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (b: Blob) => {
        blob = b;
        return 'blob:test';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    const dialog = await openExport(user);
    await user.click(within(dialog).getByRole('button', { name: '파일로 저장' }));

    expect(names).toEqual([exportFileName('테스트 여행', '나', new Date(NOW_MS))]);
    expect(blob?.type).toBe('application/json');
    expect(JSON.parse(await blob!.text())).toEqual(edit);
  });

  it('편집이 없으면 안내하고 버튼을 끈다', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openExport(user);
    expect(within(dialog).getByText(/아직 내보낼 편집이 없어요/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '링크 공유' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '파일로 저장' })).toBeDisabled();
  });

  it('저장소를 쓸 수 없으면 내보내기 메뉴를 강조한다', async () => {
    const user = userEvent.setup();
    const broken = createMemoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    renderPage({ storage: broken });
    await user.click(await screen.findByRole('button', { name: '설정' }));
    const item = await screen.findByRole('menuitem', { name: /내보내기/ });
    expect(item).toHaveAttribute('data-emphasized', 'true');
    expect(item).toHaveTextContent('이 브라우저에는 저장되지 않아요');
  });

  it('저장소가 정상이면 강조하지 않는다', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '설정' }));
    const item = await screen.findByRole('menuitem', { name: /내보내기/ });
    expect(item).toHaveAttribute('data-emphasized', 'false');
  });
});

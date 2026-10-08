import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRUNCATION_MARK } from 'src/domain/library/legacy-import';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import type { Library } from 'src/schema/library';
import type { TripData } from 'src/schema/legacy/trip-data';
import { LIBRARY_KEY } from 'src/services/library-store';
import { makePlace, renderLibrary, sampleLibrary, withPlaces } from '../library/fixtures';
import { dialog, jsonFile, NEW_IDS, tripOf } from './import-fixtures';

const toastMock = vi.hoisted(() => {
  const error = vi.fn();
  return Object.assign(vi.fn(), { error });
});
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

let blobs: Blob[];
let downloads: { name: string }[];

beforeEach(() => {
  toastMock.mockClear();
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:tripmap-test';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download });
  });
});
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LONG_NAME = '가'.repeat(31);
const HUGE_MEMO = '메'.repeat(10_001);
const stored = (storage: Storage) => JSON.parse(storage.getItem(LIBRARY_KEY)!) as Library;
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

/** 라벨 이름(31자)과 장소 A의 메모(10,001자)가 모두 확인 대상인 여행. */
function pendingTrip(): TripData {
  const trip = tripOf();
  trip.folders[0]!.name = LONG_NAME;
  trip.places['n:1']!.naverMemos = [{ folderId: 'f1', memo: HUGE_MEMO }];
  return trip;
}

async function openPreview(trip: TripData, extra: { library?: Library } = {}) {
  const user = userEvent.setup();
  const rendered = await renderLibrary(extra.library ?? sampleLibrary(), {
    path: '/settings',
    ids: NEW_IDS,
  });
  await user.click(screen.getByRole('button', { name: '옛 여행 가져오기' }));
  await user.upload(within(dialog()).getByLabelText('파일 선택(.json)'), jsonFile(trip));
  await within(dialog()).findByText(/^새로 추가/);
  return { user, ...rendered };
}

const importButton = () => within(dialog()).getByRole('button', { name: '가져오기' });
const summary = () => within(dialog()).getByText(/^새로 추가/).textContent;
const labelItem = () => within(dialog()).getByRole('listitem', { name: /라벨 이름 확인/ });
const memoItem = () => within(dialog()).getByRole('listitem', { name: /메모 길이 확인/ });
const nameInput = () => within(labelItem()).getByRole('textbox', { name: '라벨 이름' });

describe('ImportPreview decisions', () => {
  it('pending label and memo decisions gate the import button', async () => {
    const { user } = await openPreview(pendingTrip());
    expect(summary()).toBe('새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 0 · 확인 필요 2');
    expect(importButton()).toBeDisabled();
    // 제안값은 앞 30자. 사용자가 확인하기 전에는 결정이 아니다.
    expect(nameInput()).toHaveValue('가'.repeat(30));

    await user.click(
      within(memoItem()).getByRole('radio', { name: '최대 10,000자로 가져오기(생략 표시 포함)' }),
    );
    expect(summary()).toContain('확인 필요 1');
    expect(importButton()).toBeDisabled();

    await user.clear(nameInput());
    expect(labelItem()).toHaveTextContent('1–30자로 입력하세요');
    expect(importButton()).toBeDisabled();

    await user.type(nameInput(), '맛집');
    expect(labelItem()).toHaveTextContent('같은 이름의 라벨이 있어요');
    expect(importButton()).toBeDisabled();

    await user.clear(nameInput());
    await user.type(nameInput(), '가'.repeat(31));
    expect(labelItem()).toHaveTextContent('1–30자로 입력하세요');
    expect(importButton()).toBeDisabled();

    await user.clear(nameInput());
    await user.type(nameInput(), '바다 구경');
    expect(labelItem()).not.toHaveTextContent('입력하세요');
    expect(summary()).toBe('새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 1 · 확인 필요 0');
    expect(importButton()).toBeEnabled();
  });

  it('the suggested name counts only after the user confirms it or picks exclude', async () => {
    const { user } = await openPreview(pendingTrip());
    await user.click(within(memoItem()).getByRole('radio', { name: '이 장소 제외' }));
    expect(summary()).toBe('새로 추가 1 · 이미 있음 0(라벨만 합침) · 새 라벨 0 · 확인 필요 1');
    expect(importButton()).toBeDisabled();

    await user.click(within(labelItem()).getByRole('button', { name: '이 이름 사용' }));
    expect(importButton()).toBeEnabled();
    expect(summary()).toContain('새 라벨 1');

    await user.click(within(labelItem()).getByRole('checkbox', { name: '이 라벨 제외' }));
    expect(nameInput()).toBeDisabled();
    expect(summary()).toBe('새로 추가 1 · 이미 있음 0(라벨만 합침) · 새 라벨 0 · 확인 필요 0');
    expect(importButton()).toBeEnabled();
  });

  it('unticking exclude does not turn the suggested name into a decision', async () => {
    const { user } = await openPreview(pendingTrip());
    await user.click(within(memoItem()).getByRole('radio', { name: '이 장소 제외' }));
    const exclude = () => within(labelItem()).getByRole('checkbox', { name: '이 라벨 제외' });
    await user.click(exclude());
    expect(importButton()).toBeEnabled();

    await user.click(exclude());
    expect(nameInput()).toBeEnabled();
    expect(summary()).toBe('새로 추가 1 · 이미 있음 0(라벨만 합침) · 새 라벨 0 · 확인 필요 1');
    expect(importButton()).toBeDisabled();
    expect(within(labelItem()).getByRole('button', { name: '이 이름 사용' })).toBeEnabled();
  });

  it('unticking exclude keeps a name the user had already confirmed', async () => {
    const { user } = await openPreview(pendingTrip());
    await user.click(within(memoItem()).getByRole('radio', { name: '이 장소 제외' }));
    await user.click(within(labelItem()).getByRole('button', { name: '이 이름 사용' }));
    const exclude = () => within(labelItem()).getByRole('checkbox', { name: '이 라벨 제외' });
    await user.click(exclude());
    await user.click(exclude());
    expect(summary()).toContain('새 라벨 1');
    expect(importButton()).toBeEnabled();
  });

  it('applies the truncated memo and the chosen label name', async () => {
    const { user, storage } = await openPreview(pendingTrip());
    await user.click(
      within(memoItem()).getByRole('radio', { name: '최대 10,000자로 가져오기(생략 표시 포함)' }),
    );
    await user.clear(nameInput());
    await user.type(nameInput(), '바다 구경');
    await user.click(importButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('2곳을 가져왔어요'));

    const lib = stored(storage);
    const a = lib.places['newplace01']!;
    expect(a.memo.value).toHaveLength(10_000);
    expect(a.memo.value.endsWith(TRUNCATION_MARK)).toBe(true);
    const label = Object.values(lib.labels).find((l) => l.name.value === '바다 구경')!;
    expect(a.labelIds.value).toEqual([label.id]);
  });

  it('memo txt download contains full original', async () => {
    const { user } = await openPreview(pendingTrip());
    await user.click(within(memoItem()).getByRole('button', { name: '원문 받기(.txt)' }));
    expect(downloads).toEqual([{ name: 'A-memo.txt' }]);
    expect(await readBlob(blobs[0]!)).toBe(HUGE_MEMO);
    expect(blobs[0]!.type).toContain('text/plain');
  });

  it('stale apply shows recomputed preview and keeps decisions', async () => {
    const trip = tripOf();
    trip.folders[0]!.name = LONG_NAME;
    const { user, storage } = await openPreview(trip);
    await user.clear(nameInput());
    await user.type(nameInput(), '짧은 이름');
    expect(summary()).toBe('새로 추가 2 · 이미 있음 0(라벨만 합침) · 새 라벨 1 · 확인 필요 0');

    // 다른 탭이 같은 네이버 장소(sid 1)를 먼저 저장했다.
    const other = withPlaces(sampleLibrary(), [makePlace(9, { sid: '1', name: '이미 있는 A' })]);
    storage.setItem(LIBRARY_KEY, JSON.stringify(other));

    await user.click(importButton());
    expect(
      await within(dialog()).findByText('보관함이 바뀌어 미리보기를 다시 계산했어요'),
    ).toBeVisible();
    expect(toastMock).not.toHaveBeenCalled();
    expect(summary()).toBe('새로 추가 1 · 이미 있음 1(라벨만 합침) · 새 라벨 1 · 확인 필요 0');
    expect(nameInput()).toHaveValue('짧은 이름');
    expect(Object.keys(stored(storage).places)).toHaveLength(6);

    await user.click(importButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('1곳을 가져왔어요'));
    const lib = stored(storage);
    expect(Object.keys(lib.places)).toHaveLength(7);
    const label = Object.values(lib.labels).find((l) => l.name.value === '짧은 이름')!;
    expect(lib.places['place00009']!.labelIds.value).toEqual([label.id]);
    expect(lib.places['place00009']!.name.value).toBe('이미 있는 A');
  });
});

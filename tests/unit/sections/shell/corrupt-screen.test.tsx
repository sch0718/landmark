import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { CorruptScreen } from 'src/sections/shell/CorruptScreen';
import { LibraryCorrupt } from 'src/services/errors';
import { LIBRARY_KEY } from 'src/services/library-store';
import { mockViewport, renderApp } from './harness';

vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

const RAW = '{"version":99,"places":"망가짐"}';
const BACKUP_KEY = 'tripmap:library:v2:corrupt-2026-10-09T00:00:00.000Z';

let blobs: Blob[];
let downloads: { name: string; href: string }[];

beforeEach(() => {
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:tripmap-test';
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom은 링크 이동을 구현하지 않는다. 누른 링크만 기록한다.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, href: this.href });
  });
});

afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe('CorruptScreen', () => {
  it('downloads the backup copy as tripmap-backup-<ISO>.json', async () => {
    localStorage.setItem(BACKUP_KEY, RAW);
    localStorage.setItem(LIBRARY_KEY, 'LIBRARY와 다른 내용');
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: BACKUP_KEY, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    expect(screen.getByText('데이터를 읽지 못했어요')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toMatch(/^tripmap-backup-\d{4}-\d{2}-\d{2}T[\d:.]+Z\.json$/);
    expect(await readBlob(blobs[0]!)).toBe(RAW);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tripmap-test');
  });

  it('downloads the stored raw text when there is no backup key', async () => {
    localStorage.setItem(LIBRARY_KEY, RAW);
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: null, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await readBlob(blobs[0]!)).toBe(RAW);
  });

  it('says so instead of downloading an empty file when nothing can be read', async () => {
    render(
      <CorruptScreen
        error={new LibraryCorrupt({ backupKey: null, issues: [] })}
        onRecovered={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(downloads).toHaveLength(0);
    expect(screen.getByText('백업할 데이터를 찾지 못했어요')).toBeInTheDocument();
  });
});

describe('corrupt screen offers backup download and reset', () => {
  it('shows the corrupt screen for a broken document and returns to the library after reset', async () => {
    mockViewport(390);
    localStorage.setItem(LIBRARY_KEY, RAW);
    await renderApp({ storage: localStorage });

    expect(await screen.findByText('데이터를 읽지 못했어요')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    // 불러오면서 원문을 백업 키에 남겼다. 아직 덮어쓰지 않았다.
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(RAW);
    const backupKey = Object.keys(localStorage).find((key) =>
      key.startsWith(`${LIBRARY_KEY}:corrupt-`),
    );
    expect(backupKey).toBeDefined();
    expect(localStorage.getItem(backupKey!)).toBe(RAW);

    await userEvent.click(screen.getByRole('button', { name: '백업 파일 받기' }));
    expect(await readBlob(blobs[0]!)).toBe(RAW);
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(RAW);

    await userEvent.click(screen.getByRole('button', { name: '새로 시작' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '장소 목록' })).toBeInTheDocument();
    });
    expect(screen.queryByText('데이터를 읽지 못했어요')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!)).not.toEqual(JSON.parse(RAW));
    expect(localStorage.getItem(backupKey!)).toBe(RAW);
  });
});

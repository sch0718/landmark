import { createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_META_KEY } from 'src/services/backup-meta-store';
import { backupMetaAtom, markBackedUpAtom, snoozeReminderAtom } from 'src/stores/backup-state';

const AT = '2026-10-16T05:30:00.000Z';
const saved = () => JSON.parse(localStorage.getItem(BACKUP_META_KEY)!) as unknown;

afterEach(() => {
  localStorage.clear();
});

describe('backupMetaAtom', () => {
  it('저장된 기록을 동기로 읽는다', () => {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ lastBackupAt: AT, snoozedAt: null }));
    expect(createStore().get(backupMetaAtom)).toEqual({ lastBackupAt: AT, snoozedAt: null });
  });

  it('없으면 빈 기록', () => {
    expect(createStore().get(backupMetaAtom)).toEqual({ lastBackupAt: null, snoozedAt: null });
  });
});

describe('markBackedUpAtom', () => {
  it('마지막 백업 시각을 저장한다', async () => {
    const store = createStore();
    store.set(markBackedUpAtom, AT);
    expect(store.get(backupMetaAtom).lastBackupAt).toBe(AT);
    await waitForSave();
    expect(saved()).toEqual({ lastBackupAt: AT, snoozedAt: null });
  });

  it('더 이른 시각으로 다시 불러도 그대로 둔다', async () => {
    const store = createStore();
    store.set(markBackedUpAtom, AT);
    store.set(markBackedUpAtom, '2026-10-15T00:00:00.000Z');
    expect(store.get(backupMetaAtom).lastBackupAt).toBe(AT);
    await waitForSave();
    expect(saved()).toEqual({ lastBackupAt: AT, snoozedAt: null });
  });

  it('더 늦은 시각이면 바꾸고 미룸을 지운다', async () => {
    const store = createStore();
    store.set(snoozeReminderAtom, '2026-10-16T01:00:00.000Z');
    store.set(markBackedUpAtom, AT);
    const later = '2026-10-17T00:00:00.000Z';
    store.set(markBackedUpAtom, later);
    expect(store.get(backupMetaAtom)).toEqual({ lastBackupAt: later, snoozedAt: null });
    await waitForSave();
    expect(saved()).toEqual({ lastBackupAt: later, snoozedAt: null });
  });
});

describe('snoozeReminderAtom', () => {
  it('미룬 시각을 저장하고 마지막 백업은 건드리지 않는다', async () => {
    const store = createStore();
    store.set(markBackedUpAtom, AT);
    const at = '2026-10-20T00:00:00.000Z';
    store.set(snoozeReminderAtom, at);
    expect(store.get(backupMetaAtom)).toEqual({ lastBackupAt: AT, snoozedAt: at });
    await waitForSave();
    expect(saved()).toEqual({ lastBackupAt: AT, snoozedAt: at });
  });
});

/** 저장은 뒤에서(`forkEffect`) 하므로 한 틱 기다린다. */
const waitForSave = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

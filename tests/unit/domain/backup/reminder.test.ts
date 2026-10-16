import { describe, expect, it } from 'vitest';
import {
  REMIND_AFTER_DAYS,
  SNOOZE_DAYS,
  reminderState,
  reminderText,
} from 'src/domain/backup/reminder';
import { emptyLibrary } from 'src/schema/library';
import type { BackupMeta } from 'src/schema/backup';
import { f, label, makeLibrary, place, T0 } from './fixtures';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const t0 = Date.parse(T0);
const none: BackupMeta = { lastBackupAt: null, snoozedAt: null };
const lib = makeLibrary({ places: [place(1)] });
const iso = (ms: number) => new Date(ms).toISOString();

describe('reminderState', () => {
  it('상수', () => {
    expect(REMIND_AFTER_DAYS).toBe(7);
    expect(SNOOZE_DAYS).toBe(7);
  });

  it('메모리 모드는 null', () => {
    expect(
      reminderState({ library: lib, meta: none, persistence: 'memory', now: t0 + 30 * DAY }),
    ).toBeNull();
  });

  it('살아 있는 장소·여행이 없으면 null (라벨만 있어도)', () => {
    const labelsOnly = makeLibrary({ labels: [label(1)] });
    expect(
      reminderState({ library: labelsOnly, meta: none, persistence: 'local', now: t0 + 30 * DAY }),
    ).toBeNull();
    expect(
      reminderState({
        library: emptyLibrary(),
        meta: none,
        persistence: 'local',
        now: t0 + 30 * DAY,
      }),
    ).toBeNull();
    const dead = makeLibrary({ places: [place(1, { deletedAt: T0 })] });
    expect(
      reminderState({ library: dead, meta: none, persistence: 'local', now: t0 + 30 * DAY }),
    ).toBeNull();
  });

  it('백업 없음: 첫 createdAt에서 6일 23시간이면 null, 7일이면 never', () => {
    const at = (now: number) =>
      reminderState({ library: lib, meta: none, persistence: 'local', now });
    expect(at(t0 + 7 * DAY - HOUR)).toBeNull();
    expect(at(t0 + 7 * DAY)).toEqual({ kind: 'never' });
  });

  it('백업 없음: 변경이 더 늦어도 가장 이른 createdAt 기준', () => {
    const l = makeLibrary({
      places: [
        place(1),
        place(2, { createdAt: iso(t0 + 5 * DAY), memo: f('x', iso(t0 + 6 * DAY)) }),
      ],
    });
    expect(
      reminderState({ library: l, meta: none, persistence: 'local', now: t0 + 7 * DAY }),
    ).toEqual({ kind: 'never' });
  });

  it('백업 있음 + 그 뒤 변경 없음이면 10일이 지나도 null', () => {
    const meta: BackupMeta = { lastBackupAt: iso(t0 + DAY), snoozedAt: null };
    expect(
      reminderState({ library: lib, meta, persistence: 'local', now: t0 + 11 * DAY }),
    ).toBeNull();
  });

  it('백업 뒤 변경: 6일이면 null, 9일이면 stale(9)', () => {
    const backup = t0 + DAY;
    const changed = makeLibrary({ places: [place(1, { memo: f('수정', iso(backup + HOUR)) })] });
    const meta: BackupMeta = { lastBackupAt: iso(backup), snoozedAt: null };
    expect(
      reminderState({ library: changed, meta, persistence: 'local', now: backup + 6 * DAY }),
    ).toBeNull();
    expect(
      reminderState({ library: changed, meta, persistence: 'local', now: backup + 9 * DAY }),
    ).toEqual({ kind: 'stale', days: 9 });
  });

  it('미룸: 3일 전이면 null, 7일 전이면 다시 보인다', () => {
    const now = t0 + 20 * DAY;
    const at = (ago: number): BackupMeta => ({ lastBackupAt: null, snoozedAt: iso(now - ago) });
    expect(
      reminderState({ library: lib, meta: at(3 * DAY), persistence: 'local', now }),
    ).toBeNull();
    expect(reminderState({ library: lib, meta: at(7 * DAY), persistence: 'local', now })).toEqual({
      kind: 'never',
    });
  });
});

describe('reminderText', () => {
  it('문구', () => {
    expect(reminderText({ kind: 'never' })).toBe(
      '아직 백업하지 않았어요. 보관함은 이 기기에만 있어요',
    );
    expect(reminderText({ kind: 'stale', days: 9 })).toBe(
      '마지막 백업이 9일 전이에요. 그 뒤로 바뀐 내용이 있어요',
    );
  });
});

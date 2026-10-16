import { describe, expect, it } from 'vitest';
import { backupFileName, BACKUP_MIME, buildBackupText } from 'src/domain/backup/build-backup';
import { BACKUP_FORMAT, BACKUP_VERSION } from 'src/schema/backup';
import { DEFAULT_PREFS } from 'src/schema/prefs';
import { f, label, makeLibrary, place, T0, trip } from './fixtures';

const NOW = new Date('2026-10-16T05:30:00.000Z');

describe('buildBackupText', () => {
  it('저장소 원문을 봉투에 그대로 담는다', () => {
    const raw = makeLibrary({ places: [place(1)], labels: [label(1)], trips: [trip(1, 1)] });
    const text = buildBackupText({ rawLibrary: raw, prefs: DEFAULT_PREFS, now: NOW });
    expect(JSON.parse(text)).toEqual({
      format: 'tripmap-backup',
      v: 1,
      exportedAt: '2026-10-16T05:30:00.000Z',
      library: raw,
      prefs: DEFAULT_PREFS,
    });
  });

  it('상수가 형식과 같다', () => {
    expect(BACKUP_FORMAT).toBe('tripmap-backup');
    expect(BACKUP_VERSION).toBe(1);
    expect(BACKUP_MIME).toBe('application/json');
  });

  it('이 버전이 모르는 필드도 잃지 않는다', () => {
    const base = place(1);
    const raw = {
      ...makeLibrary({ places: [base] }),
      places: { [base.id]: { ...base, futureField: f(1) } },
    };
    const parsed = JSON.parse(buildBackupText({ rawLibrary: raw, prefs: null, now: NOW }));
    expect(parsed.library.places[base.id].futureField).toEqual({ value: 1, updatedAt: T0 });
  });

  it('prefs가 null이면 prefs 키가 없다', () => {
    const text = buildBackupText({ rawLibrary: makeLibrary(), prefs: null, now: NOW });
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'v', 'exportedAt', 'library']);
  });

  it('줄바꿈 없이 한 줄이다', () => {
    const text = buildBackupText({
      rawLibrary: makeLibrary({ places: [place(1, { memo: f('줄\n바꿈') })] }),
      prefs: DEFAULT_PREFS,
      now: NOW,
    });
    expect(text).not.toContain('\n');
  });
});

describe('backupFileName', () => {
  const pad = (n: number) => String(n).padStart(2, '0');

  it('이 기기 시간으로 landmark-backup-YYYY-MM-DD-HHmm.json', () => {
    const d = new Date('2026-10-16T05:30:00.000Z');
    const expected = `landmark-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    expect(backupFileName(d)).toBe(expected);
    expect(backupFileName(d)).toMatch(/^landmark-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  });

  it('한 자리 값은 두 자리로 채우고 ":"가 없다', () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(backupFileName(d)).toBe('landmark-backup-2026-01-02-0304.json');
    expect(backupFileName(d)).not.toContain(':');
  });
});

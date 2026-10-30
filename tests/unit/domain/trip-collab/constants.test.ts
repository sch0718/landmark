// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COLLAB_LIMITS,
  collabInviteLink,
  inviteExpiresAt,
  inviteKeyOf,
  normalizeDeviceLabel,
  normalizeInviteLabel,
  readInviteHash,
} from 'src/domain/trip-collab/constants';

describe('함께 편집 상수', () => {
  it('기기 이름의 공백과 유니코드를 다듬고 길이를 검사한다', () => {
    expect(normalizeDeviceLabel('  민지   폰 ')).toBe('민지 폰');
    expect(normalizeDeviceLabel('가')).toBe('가');
    expect(normalizeDeviceLabel('')).toBeNull();
    expect(normalizeDeviceLabel('가'.repeat(31))).toBeNull();
    expect(normalizeDeviceLabel('가'.repeat(30))).toHaveLength(30);
  });
  it('초대 이름은 빈 값을 비우고 30자로 자른다', () => {
    expect(normalizeInviteLabel(null)).toBeNull();
    expect(normalizeInviteLabel('  ')).toBeNull();
    expect(normalizeInviteLabel('가'.repeat(40))).toBe('가'.repeat(30));
  });
  it('초대는 공유 기한과 7일 가운데 먼저 끝난다', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(inviteExpiresAt(now, '2026-11-04T00:00:00Z')).toBe('2026-11-04T00:00:00.000Z');
    expect(inviteExpiresAt(now, '2026-12-01T00:00:00Z')).toBe('2026-11-08T00:00:00.000Z');
    expect(COLLAB_LIMITS.inviteDays).toBe(7);
  });
  it('끝 슬래시 없이 링크를 만들고 초대 해시만 읽는다', () => {
    const token = 'a'.repeat(43);
    expect(collabInviteLink('https://example.com///', 'abcdefghij', token)).toBe(
      `https://example.com/trips/join/abcdefghij#i=${token}`,
    );
    expect(readInviteHash(`#i=${token}`)).toBe(token);
    for (const value of ['#i=a', '#i=' + '.'.repeat(43), '#t=' + token, '#i=' + token + '&a=1'])
      expect(readInviteHash(value)).toBeNull();
    expect(inviteKeyOf('a'.repeat(43))).toBe('a'.repeat(16));
  });
});

export const COLLAB_LIMITS = {
  devices: 20,
  invites: 10,
  inviteDays: 7,
  labelChars: 30,
  progressOps: 50,
  progressRows: 2_000,
  pendingOps: 200,
  progressRequestBytes: 16_384,
} as const;
export const COLLAB_DEVICE_ID_PATTERN = /^[a-z0-9]{8}$/;
export const COLLAB_INVITE_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const COLLAB_STOP_ID_PATTERN = /^[a-z0-9]{8}$/;
export const OWNER_DEVICE = 'owner';
export const OWNER_LABEL = '만든 사람';
const tidy = (label: string) => label.normalize('NFC').trim().replace(/\s+/g, ' ');
export function normalizeDeviceLabel(label: string): string | null {
  const value = tidy(label);
  return value.length >= 1 && value.length <= COLLAB_LIMITS.labelChars ? value : null;
}
export function normalizeInviteLabel(label: string | null): string | null {
  return label === null ? null : tidy(label).slice(0, COLLAB_LIMITS.labelChars) || null;
}
export function inviteExpiresAt(now: Date, shareExpiresAt: string): string {
  return new Date(
    Math.min(now.getTime() + COLLAB_LIMITS.inviteDays * 86_400_000, Date.parse(shareExpiresAt)),
  ).toISOString();
}
export function collabInviteLink(origin: string, liveId: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/trips/join/${liveId}#i=${token}`;
}
export function readInviteHash(hash: string): string | null {
  return /^#i=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;
}
export function inviteKeyOf(hash: string): string {
  return hash.slice(0, 16);
}

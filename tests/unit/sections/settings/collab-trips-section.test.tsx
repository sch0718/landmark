import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollabTripsSection } from 'src/sections/settings/CollabTripsSection';
import { tripCollabApi } from 'src/services/trip-collab/client';
import { tripCollabStore, type TripCollabRecord } from 'src/services/trip-collab/store';
vi.mock('src/services/trip-collab/client', async (original) => ({
  ...(await original<typeof import('src/services/trip-collab/client')>()),
  tripCollabApi: { removeMember: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const record = (status: TripCollabRecord['status'] = 'live'): TripCollabRecord => ({
  tripId: 'trip000001',
  liveId: 'abcdefghij',
  role: 'editor',
  token: 'e'.repeat(43),
  deviceId: 'device01',
  label: '민지 폰',
  status,
  title: '강릉 여행',
  rev: 1,
  prev: 0,
  dayIds: [],
  placeMap: {},
  syncedAt: '2026-10-30T00:00:00.000Z',
  pendingProgress: [],
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(tripCollabApi.removeMember).mockResolvedValue({ ok: true, value: undefined });
});
afterEach(cleanup);
it('기록이 없으면 섹션이 없다', () => {
  render(<CollabTripsSection />);
  expect(screen.queryByRole('region', { name: '함께 편집' })).toBeNull();
});
it('참여 중인 기기는 확인 뒤 그만두고 기록에서 빠진다', async () => {
  tripCollabStore.put(record());
  render(<CollabTripsSection />);
  expect(screen.getByText('민지 폰로 참여')).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '그만두기' }));
  expect(tripCollabApi.removeMember).not.toHaveBeenCalled();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '그만두기' }));
  await waitFor(() => expect(tripCollabStore.list()).toEqual([]));
  expect(tripCollabApi.removeMember).toHaveBeenCalledWith('abcdefghij', 'e'.repeat(43), 'me');
});
it.each(['revoked', 'ended'] as const)('%s는 서버 요청 없이 목록에서 지운다', async (status) => {
  tripCollabStore.put(record(status));
  render(<CollabTripsSection />);
  await userEvent.click(screen.getByRole('button', { name: '목록에서 지우기' }));
  expect(tripCollabStore.list()).toEqual([]);
  expect(tripCollabApi.removeMember).not.toHaveBeenCalled();
});
it('오프라인에서 그만두기는 오류를 알리고 기록을 남긴다', async () => {
  tripCollabStore.put(record());
  vi.mocked(tripCollabApi.removeMember).mockResolvedValue({ ok: false, error: 'offline' });
  render(<CollabTripsSection />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '그만두기' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '그만두기' }));
  await waitFor(() => expect(tripCollabApi.removeMember).toHaveBeenCalled());
  expect(tripCollabStore.get('trip000001')).toBeDefined();
});

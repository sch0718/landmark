import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTripsSection } from 'src/sections/settings/LiveTripsSection';
import { tripLiveStore, type TripLiveRecord } from 'src/services/trip-live/store';
import { tripLiveApi } from 'src/services/trip-live/client';
import { toast } from 'sonner';
vi.mock('src/services/trip-live/client', () => ({ tripLiveApi: { remove: vi.fn() } }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const record = (status: TripLiveRecord['status'] = 'live'): TripLiveRecord => ({
  tripId: 'trip000001',
  liveId: 'abcdefghij',
  status,
  ownerToken: 'o'.repeat(43),
  viewToken: 'v'.repeat(43),
  rev: 1,
  dayIds: [],
  options: { title: '시험 여행', includeMemo: false, includeCandidates: true },
  createdAt: '2026-11-01',
  expiresAt: '2027-01-01',
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(tripLiveApi.remove).mockResolvedValue({ ok: true, value: undefined });
});
describe('설정 갱신 링크', () => {
  it('기록이 없으면 섹션을 그리지 않는다', () => {
    render(<LiveTripsSection />);
    expect(screen.queryByRole('region', { name: '갱신 링크' })).toBeNull();
  });
  it.each(['live', 'pending'] as const)(
    '%s 지우기는 서버에서 지운 뒤 기록을 뺀다',
    async (status) => {
      tripLiveStore.put(record(status));
      render(<LiveTripsSection />);
      await userEvent.click(screen.getByRole('button', { name: '시험 여행 링크 지우기' }));
      await waitFor(() => expect(tripLiveStore.list()).toEqual([]));
      expect(tripLiveApi.remove).toHaveBeenCalledWith('abcdefghij', 'o'.repeat(43));
      expect(toast).toHaveBeenCalledWith('갱신 링크를 지웠어요');
    },
  );
  it.each(['disconnected', 'ended'] as const)('%s 기록은 요청 없이 지운다', async (status) => {
    tripLiveStore.put(record(status));
    render(<LiveTripsSection />);
    await userEvent.click(screen.getByRole('button', { name: '시험 여행 링크 지우기' }));
    expect(tripLiveStore.list()).toEqual([]);
    expect(tripLiveApi.remove).not.toHaveBeenCalled();
  });
  it.each([
    ['offline', '인터넷 연결을 확인하고 다시 해 주세요'],
    ['unavailable', '갱신 링크를 지우지 못했어요. 잠시 뒤 다시 해 주세요'],
  ])('삭제 실패 %s는 안내와 기록을 남긴다', async (error, message) => {
    tripLiveStore.put(record());
    vi.mocked(tripLiveApi.remove).mockResolvedValue({ ok: false, error: error as 'offline' });
    render(<LiveTripsSection />);
    await userEvent.click(screen.getByRole('button', { name: '시험 여행 링크 지우기' }));
    expect(toast.error).toHaveBeenCalledWith(message);
    expect(screen.getByText('시험 여행')).toBeVisible();
  });
});

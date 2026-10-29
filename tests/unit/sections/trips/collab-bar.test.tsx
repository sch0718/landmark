import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollabBar } from 'src/sections/trips/collab/CollabBar';
import { TripCollabSync } from 'src/sections/trips/collab/TripCollabSync';
import { joinCollabAsOwner } from 'src/sections/trips/collab/owner-join';
import type { CollabView } from 'src/sections/trips/collab/use-trip-collab';
import { tripLiveStore } from 'src/services/trip-live/store';
import { tripLiveApi } from 'src/services/trip-live/client';
import { buildLiveDoc } from '../../../fixtures/live-trip';
import { buildLiveLibrary } from '../../../fixtures/builders';
const mocked = vi.hoisted(() => ({
  view: {
    state: 'idle',
    record: undefined,
    merge: null,
    syncedAt: null,
    changedBy: null,
    changedAt: null,
    members: 0,
    progress: null,
    engine: null,
  },
}));
vi.mock('src/sections/trips/collab/use-trip-collab', () => ({
  useTripCollab: () => mocked.view,
  useCollabDeps: () => ({ tripId: 'trip000001', getLibrary: buildLiveLibrary }),
}));
vi.mock('src/sections/trips/collab/owner-join', () => ({
  joinCollabAsOwner: vi.fn(),
  isCleanOwnerDevice: vi.fn().mockResolvedValue(true),
}));
vi.mock('src/services/trip-live/client', () => ({ tripLiveApi: { get: vi.fn() } }));
const view = (patch = {}): CollabView => ({ ...mocked.view, ...patch }) as CollabView;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
describe('함께 편집 띠', () => {
  it('기록도 상태도 없으면 비어 있다', () => {
    const { container } = render(<CollabBar view={view()} onOpen={vi.fn()} onCompare={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('맞춘 시각과 다른 기기의 편집을 알린다', () => {
    const { rerender } = render(
      <CollabBar
        view={view({ state: 'synced', syncedAt: '2026-11-01T01:00:00.000Z' })}
        onOpen={vi.fn()}
        onCompare={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('10:00에 맞췄어요');
    rerender(
      <CollabBar
        view={view({
          state: 'synced',
          changedBy: '민지 폰',
          changedAt: '2026-11-01T01:00:00.000Z',
        })}
        onOpen={vi.fn()}
        onCompare={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('‘민지 폰’에서 일정을 바꿨어요');
  });
  it('겹침은 비교하기로 이어진다', async () => {
    const compare = vi.fn();
    render(
      <CollabBar
        view={view({ state: 'conflict', merge: { conflicts: [{ id: 'title' }] } })}
        onOpen={vi.fn()}
        onCompare={compare}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1곳');
    await userEvent.click(screen.getByRole('button', { name: '비교하기' }));
    expect(compare).toHaveBeenCalledOnce();
  });
  it('권한 철회는 알겠어요로 기록을 정리하고 버전 오류는 새로 고침을 보인다', async () => {
    const dismiss = vi.fn(),
      { rerender } = render(
        <CollabBar
          view={view({ state: 'revoked', engine: { dismiss } })}
          onOpen={vi.fn()}
          onCompare={vi.fn()}
        />,
      );
    await userEvent.click(screen.getByRole('button', { name: '알겠어요' }));
    expect(dismiss).toHaveBeenCalledOnce();
    rerender(<CollabBar view={view({ state: 'version' })} onOpen={vi.fn()} onCompare={vi.fn()} />);
    expect(screen.getByRole('button', { name: '새로 고침' })).toBeVisible();
  });
  it('2A 기록이 없으면 요청하지 않고 v2 공동본이면 소유자로 합류한다', async () => {
    const { unmount } = render(<TripCollabSync tripId="trip000001" />);
    expect(tripLiveApi.get).not.toHaveBeenCalled();
    unmount();
    const doc = { ...buildLiveDoc(), v: 2 as const };
    tripLiveStore.put({
      tripId: 'trip000001',
      liveId: 'abcdefghij',
      status: 'live',
      ownerToken: 'o'.repeat(43),
      viewToken: 'v'.repeat(43),
      rev: 2,
      dayIds: doc.ids.days,
      options: { title: '여행', includeMemo: false, includeCandidates: true },
      createdAt: doc.share.createdAt,
    });
    vi.mocked(tripLiveApi.get).mockResolvedValue({
      ok: true,
      value: {
        rev: 2,
        updatedAt: doc.share.createdAt,
        expiresAt: '2026-12-31',
        role: 'owner',
        doc,
      },
    });
    render(<TripCollabSync tripId="trip000001" />);
    await waitFor(() =>
      expect(joinCollabAsOwner).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ doc }),
        true,
      ),
    );
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HubResults } from 'src/sections/meetings/HubResults';
import { NearbyPlaces } from 'src/sections/meetings/NearbyPlaces';
import { CandidateTally } from 'src/sections/meetings/CandidateTally';
import { buildMeeting } from '../../../fixtures/builders';
import { makePlace, sampleLibrary } from '../library/fixtures';

const hub = { id: 'hub1', name: '강남역', region: '서울', lng: 127, lat: 37.5 };
const f = <T,>(value: T) => ({ value, updatedAt: '2026-10-23T00:00:00Z' });
describe('약속 결과', () => {
  it('참석자별 값과 순위 기준을 표시하고 실패 칸을 재시도한다', async () => {
    const onRank = vi.fn(),
      onRetry = vi.fn();
    render(
      <HubResults
        hubs={[hub]}
        participants={[{ id: 'person01', name: '나', origin: null }]}
        times={{ hub1: { person01: null } }}
        errors={{ hub1: { person01: 'OFFLINE' } }}
        unit="min"
        rank="max"
        onRank={onRank}
        onRetry={onRetry}
        onAdd={vi.fn()}
        renderNearby={() => null}
      />,
    );
    expect(screen.getByText('오프라인이에요')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '강남역 나 다시 시도' }));
    expect(onRetry).toHaveBeenCalledWith('hub1', 'person01');
    await userEvent.click(screen.getByRole('button', { name: '평균' }));
    expect(onRank).toHaveBeenCalledWith('avg');
  });
  it('역 1km 안의 살아 있는 보관함 장소만 보이며 라벨 이름으로 거른다', async () => {
    const base = sampleLibrary();
    const near = {
      ...makePlace(10, { name: '가까운 카페', labelIds: ['label002'] }),
      lng: 127,
      lat: 37.5,
    };
    const other = { ...makePlace(11, { name: '가까운 식당' }), lng: 127, lat: 37.5 };
    const gone = {
      ...makePlace(12, { name: '지운 카페', deletedAt: '2026-10-23T00:00:00Z' }),
      lng: 127,
      lat: 37.5,
    };
    const lib = {
      ...base,
      places: { ...base.places, [near.id]: near, [other.id]: other, [gone.id]: gone },
    };
    const onAdd = vi.fn();
    render(<NearbyPlaces hub={hub} library={lib} onAdd={onAdd} />);
    expect(screen.queryByText('지운 카페')).toBeNull();
    expect(screen.queryByText('중앙시장 닭강정')).toBeNull();
    const labelChip = screen.getByRole('button', { name: '카페' });
    expect(Number.parseFloat(getComputedStyle(labelChip).minWidth)).toBeGreaterThanOrEqual(44);
    await userEvent.click(labelChip);
    expect(screen.queryByText('가까운 식당')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '가까운 카페 후보에 담기' }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: near.id, name: '가까운 카페' }),
    );
  });
  it('집계에 좋아한 이름·시간·확정을 표시하며 주최자 좋아요를 바꾼다', async () => {
    const meeting = buildMeeting({
      participants: f([
        { id: 'person01', name: '나', origin: null },
        { id: 'person02', name: '친구', origin: null },
      ]),
      replies: f({
        person02: {
          likes: ['choice01'],
          sentAt: '2026-10-23T00:00:00Z',
          receivedAt: '2026-10-23T00:00:00Z',
        },
      }),
    });
    const onLike = vi.fn(),
      onDecide = vi.fn();
    render(
      <CandidateTally
        meeting={meeting}
        times={{ choice01: { person01: 65 } }}
        errors={{}}
        unit="min"
        onLike={onLike}
        onRemove={vi.fn()}
        onDecide={onDecide}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('좋아요 1명 · 친구')).toBeTruthy();
    expect(screen.getByText('1시간 5분')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '강남역 좋아요' }));
    expect(onLike).toHaveBeenCalledWith('choice01');
    await userEvent.click(screen.getByRole('button', { name: '강남역 확정' }));
    expect(onDecide).toHaveBeenCalledWith('choice01');
  });
});

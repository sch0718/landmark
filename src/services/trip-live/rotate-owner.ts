import { tripLiveApi, type LiveResult } from './client';
import { tripLiveStore, type TripLiveRecord } from './store';

/** 응답이 사라져도 같은 토큰으로 재시도할 수 있도록 요청 전에 보관한다. */
export async function rotateLiveOwner(record: TripLiveRecord, nextOwnerToken: string) {
  tripLiveStore.update(record.tripId, { nextOwnerToken });
  const result = await tripLiveApi.rotate(
    record.liveId,
    { owner: nextOwnerToken },
    record.ownerToken,
  );
  const current = tripLiveStore.get(record.tripId);
  if (result.ok && current?.liveId === record.liveId && current.nextOwnerToken === nextOwnerToken)
    tripLiveStore.update(record.tripId, {
      ownerToken: nextOwnerToken,
      nextOwnerToken: undefined,
      status: 'live',
    });
  return result;
}

export async function withLiveOwnerRecovery<A>(
  record: TripLiveRecord,
  request: (ownerToken: string) => Promise<LiveResult<A>>,
): Promise<LiveResult<A>> {
  const result = await request(record.ownerToken);
  if (result.ok || result.error !== 'unauthorized') return result;
  const current = tripLiveStore.get(record.tripId);
  if (!current || current.liveId !== record.liveId) return result;
  if (current.ownerToken !== record.ownerToken) return request(current.ownerToken);
  if (!current.nextOwnerToken) return result;
  const recovered = await rotateLiveOwner(current, current.nextOwnerToken);
  return recovered.ok ? request(current.nextOwnerToken) : recovered;
}

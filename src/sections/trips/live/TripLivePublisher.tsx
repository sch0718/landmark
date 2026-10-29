import { useTripLivePublish } from './use-trip-live-publish';
export function TripLivePublisher({ tripId }: { tripId: string }) {
  useTripLivePublish(tripId, true);
  return null;
}

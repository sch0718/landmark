import { useEffect, useRef, useState } from 'react';
import { tripLiveApi } from 'src/services/trip-live/client';
import { useTripLiveRecord } from 'src/services/trip-live/store';
import { CollabBar } from './CollabBar';
import { isCleanOwnerDevice, joinCollabAsOwner } from './owner-join';
import { useCollabDeps, useTripCollab } from './use-trip-collab';
export function TripCollabSync({ tripId }: { tripId: string }) {
  const view = useTripCollab(tripId, true),
    live = useTripLiveRecord(tripId),
    deps = useCollabDeps(tripId, false),
    checked = useRef<string | null>(null);
  const [, setOpen] = useState(false),
    [, setCompare] = useState(false);
  useEffect(() => {
    if (view.record || live?.status !== 'live' || checked.current === live.liveId) return;
    checked.current = live.liveId;
    let stale = false,
      finished = false;
    void tripLiveApi
      .get(live.liveId, null, live.ownerToken)
      .then(async (result) => {
        if (stale) return;
        finished = true;
        if (result.ok && result.value !== 'unchanged' && result.value.doc.v === 2)
          await joinCollabAsOwner(
            deps,
            result.value,
            await isCleanOwnerDevice(deps.getLibrary(), tripId, live),
          );
      })
      .catch((error) => deps.reportError(error));
    return () => {
      stale = true;
      if (!finished) checked.current = null;
    };
  }, [view.record, live, deps, tripId]);
  return <CollabBar view={view} onOpen={() => setOpen(true)} onCompare={() => setCompare(true)} />;
}

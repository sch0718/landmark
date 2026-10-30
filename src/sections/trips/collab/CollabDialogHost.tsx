import { useState } from 'react';
import {
  TripCollabDialog,
  CollabConflictDialog,
  TripLiveShareDialog,
} from 'src/routes/lazy-routes';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
export function CollabDialogHost({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose(): void;
  tripId: string;
}) {
  const [liveOpen, setLiveOpen] = useState(false),
    [compare, setCompare] = useState(false);
  return (
    <>
      <LazyDialogHost open={open} onClose={onClose} heading="함께 편집">
        <TripCollabDialog
          key={tripId}
          open={open}
          onClose={onClose}
          tripId={tripId}
          onOpenLiveShare={() => setLiveOpen(true)}
          onCompare={() => setCompare(true)}
        />
      </LazyDialogHost>
      <CollabConflictDialogHost open={compare} onClose={() => setCompare(false)} tripId={tripId} />
      <LazyDialogHost open={liveOpen} onClose={() => setLiveOpen(false)} heading="갱신 링크">
        <TripLiveShareDialog open={liveOpen} onClose={() => setLiveOpen(false)} tripId={tripId} />
      </LazyDialogHost>
    </>
  );
}
export function CollabConflictDialogHost({
  open,
  onClose,
  tripId,
}: {
  open: boolean;
  onClose(): void;
  tripId: string;
}) {
  return (
    <LazyDialogHost open={open} onClose={onClose} heading="겹친 변경 비교">
      <CollabConflictDialog key={tripId} open={open} onClose={onClose} tripId={tripId} />
    </LazyDialogHost>
  );
}

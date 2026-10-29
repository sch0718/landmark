import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { CollabView } from './use-trip-collab';
import { LIVE_DISCONNECTED } from '../live/texts';
import {
  COLLAB_CHANGED,
  COLLAB_COMPARE,
  COLLAB_CONFLICT,
  COLLAB_ENDED,
  COLLAB_FAILED,
  COLLAB_LIMITED,
  COLLAB_OFF,
  COLLAB_OFFLINE,
  COLLAB_OK,
  COLLAB_OPEN,
  COLLAB_RELOAD,
  COLLAB_REVOKED,
  COLLAB_SYNCED,
  COLLAB_SYNCING,
  COLLAB_TOO_BIG,
  COLLAB_VERSION,
} from './texts';
const hhmm = (at: string | null) =>
  at
    ? new Date(at).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    : '';
export function CollabBar({
  view,
  onOpen,
  onCompare,
}: {
  view: CollabView;
  onOpen(): void;
  onCompare(): void;
}) {
  if (view.state === 'idle' && !view.record) return null;
  const text =
    view.state === 'synced'
      ? view.changedBy
        ? COLLAB_CHANGED(view.changedBy, hhmm(view.changedAt))
        : COLLAB_SYNCED(hhmm(view.syncedAt))
      : view.state === 'conflict'
        ? COLLAB_CONFLICT(view.merge?.conflicts.length ?? 0)
        : view.state === 'offline'
          ? COLLAB_OFFLINE
          : view.state === 'off'
            ? COLLAB_OFF
            : view.state === 'limited'
              ? COLLAB_LIMITED
              : view.state === 'too-big'
                ? COLLAB_TOO_BIG
                : view.state === 'revoked'
                  ? view.record?.role === 'owner'
                    ? LIVE_DISCONNECTED
                    : COLLAB_REVOKED
                  : view.state === 'ended'
                    ? COLLAB_ENDED
                    : view.state === 'version'
                      ? COLLAB_VERSION
                      : view.state === 'failed'
                        ? COLLAB_FAILED
                        : COLLAB_SYNCING;
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ p: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, fontSize: 13 }}
    >
      <span>{text}</span>
      <Button sx={{ minHeight: 44 }} onClick={onOpen}>
        {COLLAB_OPEN}
      </Button>
      {view.state === 'conflict' && (
        <Button sx={{ minHeight: 44 }} onClick={onCompare}>
          {COLLAB_COMPARE}
        </Button>
      )}
      {(view.state === 'revoked' || view.state === 'ended') && (
        <Button sx={{ minHeight: 44 }} onClick={() => view.engine?.dismiss()}>
          {COLLAB_OK}
        </Button>
      )}
      {view.state === 'version' && (
        <Button sx={{ minHeight: 44 }} onClick={() => location.reload()}>
          {COLLAB_RELOAD}
        </Button>
      )}
    </Box>
  );
}

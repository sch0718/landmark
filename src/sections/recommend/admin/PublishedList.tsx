import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import { useStore } from 'jotai';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { getSharedSyncApi } from 'src/services/library-sync/shared-api';
import { createRecommendAdminApi, type RecommendationMeta } from 'src/services/recommend/api';
import { refreshRecommendations } from 'src/stores/recommend';
import { formatPeriod } from '../format';
import { recommendFailureMessage } from './failure-message';
import { PublishDialog } from './PublishDialog';
export function PublishedList({
  items,
  reload,
}: {
  items: RecommendationMeta[];
  reload(): Promise<void>;
}) {
  const store = useStore();
  const [editing, setEditing] = useState<RecommendationMeta | null>(null);
  const [removing, setRemoving] = useState<RecommendationMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [today] = useState(() => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10));
  const remove = async () => {
    const sync = getSharedSyncApi();
    if (!sync || !removing || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await createRecommendAdminApi(sync).remove(removing.id);
      if (!result.ok) {
        toast(recommendFailureMessage(result.reason));
        return;
      }
      toast('추천을 내렸어요');
      await Promise.all([reload(), refreshRecommendations(store)]);
      setRemoving(null);
    } catch {
      toast('잠시 뒤 다시 시도해 주세요');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Box component="section" aria-label="게시한 추천" sx={{ mt: 3 }}>
      <Box component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
        게시한 추천
      </Box>
      {items.length === 0 && (
        <Box sx={{ fontSize: 14, color: 'var(--tm-text-secondary)' }}>
          아직 게시한 추천이 없어요
        </Box>
      )}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <Box
            component="li"
            key={item.id}
            sx={{ py: 1, borderBottom: '1px solid var(--tm-border)' }}
          >
            <Box sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{item.title}</Box>
            <Box
              sx={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}
            >{`${item.places}곳 · ${formatPeriod(item.startDate, item.endDate)} · ${today < item.startDate ? '예정' : today > item.endDate ? '끝남' : '게시 중'}`}</Box>
            <Button
              onClick={() => setEditing(item)}
              aria-label={`${item.title} 추천 수정`}
              sx={{ minHeight: 44 }}
            >
              수정
            </Button>
            <Button
              onClick={() => setRemoving(item)}
              aria-label={`${item.title} 추천 내리기`}
              sx={{ minHeight: 44 }}
            >
              내리기
            </Button>
          </Box>
        ))}
      </Box>
      {editing && (
        <PublishDialog
          key={editing.id}
          mode="edit"
          item={editing}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <Dialog
          open
          onClose={busy ? undefined : () => setRemoving(null)}
          aria-labelledby="remove-recommend-title"
        >
          <DialogTitle id="remove-recommend-title">{`‘${removing.title}’ 추천을 내릴까요?`}</DialogTitle>
          <DialogActions>
            <Button onClick={() => setRemoving(null)} disabled={busy} sx={{ minHeight: 44 }}>
              취소
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void remove()}
              disabled={busy}
              sx={{ minHeight: 44 }}
            >
              내리기
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useAtomValue, useStore } from 'jotai';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fieldSx } from 'src/components/field-style';
import { livePlaces } from 'src/domain/library/query';
import { buildShareDoc } from 'src/domain/share/build-share';
import { CalendarDate } from 'src/schema/common';
import { labelNameIssue, type Label } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { getSharedSyncApi } from 'src/services/library-sync/shared-api';
import {
  createRecommendAdminApi,
  type RecommendationMeta,
  type RecommendPublishBody,
} from 'src/services/recommend/api';
import { libraryAtom } from 'src/stores/library-state';
import { refreshRecommendations } from 'src/stores/recommend';
import { recommendFailureMessage } from './failure-message';

type Props = {
  mode: 'publish' | 'edit';
  label?: Label;
  item?: RecommendationMeta;
  onClose(): void;
  reload(): Promise<void>;
};
function kstDay(now: number): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function PublishDialog({ mode, label, item, onClose, reload }: Props) {
  const library = useAtomValue(libraryAtom);
  const store = useStore();
  const fieldId = useId();
  const [title, setTitle] = useState(item?.title ?? label?.name.value ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [startDate, setStartDate] = useState(() => item?.startDate ?? kstDay(Date.now()));
  const [endDate, setEndDate] = useState(
    () => item?.endDate ?? kstDay(Date.now() + 30 * 86_400_000),
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const ids = label
    ? livePlaces(library)
        .filter((place) => place.labelIds.value.includes(label.id))
        .map((place) => place.id)
    : [];
  const countIssue =
    mode === 'publish'
      ? ids.length === 0
        ? '이 라벨에 장소가 없어요'
        : ids.length > 500
          ? '추천은 500곳까지예요'
          : null
      : null;
  const valid =
    labelNameIssue(title) === null &&
    description.length <= 80 &&
    !/[\n\r]/.test(description) &&
    safeParse(CalendarDate, startDate).success &&
    safeParse(CalendarDate, endDate).success &&
    endDate >= startDate &&
    countIssue === null;
  const submit = async () => {
    if (!valid || busyRef.current) return;
    const id = mode === 'publish' ? label?.id : item?.id;
    const sync = getSharedSyncApi();
    if (!id || !sync) {
      toast('잠시 뒤 다시 시도해 주세요');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const body: RecommendPublishBody = {
        title: title.trim(),
        description: description.trim(),
        startDate,
        endDate,
      };
      if (mode === 'publish') {
        const snapshot = buildShareDoc(library, ids, {
          title,
          includeMemo: false,
          now: new Date(),
        });
        body.doc = {
          ...snapshot,
          version: 1,
          labels: [],
          places: snapshot.places.map((place) => ({ ...place, labelIds: [] })),
        };
      }
      const result = await createRecommendAdminApi(sync).publish(id, body);
      if (!result.ok) {
        toast(recommendFailureMessage(result.reason));
        return;
      }
      toast(mode === 'edit' ? '추천을 고쳤어요' : '추천을 게시했어요');
      await Promise.all([reload(), refreshRecommendations(store)]);
      onClose();
    } catch {
      toast('잠시 뒤 다시 시도해 주세요');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      aria-labelledby={`${fieldId}-heading`}
      fullWidth
      maxWidth="xs"
    >
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogTitle id={`${fieldId}-heading`}>
          {mode === 'edit' ? '추천 수정' : '추천으로 게시'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box component="label" htmlFor={`${fieldId}-title`}>
            제목
            <Box
              component="input"
              id={`${fieldId}-title`}
              type="text"
              value={title}
              maxLength={30}
              onChange={(event) => setTitle(event.target.value)}
              sx={fieldSx()}
            />
          </Box>
          <Box component="label" htmlFor={`${fieldId}-description`}>
            한 줄 설명
            <Box
              component="input"
              id={`${fieldId}-description`}
              type="text"
              value={description}
              maxLength={80}
              onChange={(event) => setDescription(event.target.value)}
              sx={fieldSx()}
            />
          </Box>
          <Box component="label" htmlFor={`${fieldId}-start`}>
            시작일
            <Box
              component="input"
              id={`${fieldId}-start`}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              sx={fieldSx()}
            />
          </Box>
          <Box component="label" htmlFor={`${fieldId}-end`}>
            종료일
            <Box
              component="input"
              id={`${fieldId}-end`}
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              sx={fieldSx()}
            />
          </Box>
          {mode === 'publish' && (
            <Box sx={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}>
              {countIssue ?? `${ids.length}곳을 추천해요`}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>
            취소
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!valid || busy}
            sx={{ minHeight: 44 }}
          >
            {mode === 'edit' ? '저장' : item ? '다시 게시' : '게시'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

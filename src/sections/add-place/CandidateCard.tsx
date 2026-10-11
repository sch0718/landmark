import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { addPlace, findExisting, type PlaceCandidate } from 'src/domain/library/add-place';
import { createLabel } from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { paths } from 'src/routes/paths';
import { LIBRARY_LIMITS, normalizeLabelName, type PlaceSource } from 'src/schema/library';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction, type LibraryActionResult } from 'src/stores/library-state';

/** 카드의 한 줄 입력칸(핀 입력 카드와 같이 쓴다). */
export const CARD_FIELD_SX = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  minHeight: 44,
  px: 1.25,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 16,
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
} as const;

/**
 * 출처 표시. 확인 카드의 `pin` 출처는 장소 ID 없는 구글 링크에서만 나온다
 * (지도에서 직접 찍은 핀은 이 카드가 아니라 핀 입력 카드를 쓴다).
 */
const PROVIDER_LABEL: Record<PlaceSource['kind'], string> = {
  naver: '네이버',
  kakao: '카카오',
  google: '구글',
  pin: '구글',
};

/** 카드의 제목 붙은 칸(핀 입력 카드와 같이 쓴다). */
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 2 }}>
      <Box
        component="h3"
        sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 800, color: 'var(--tm-text-secondary)' }}
      >
        {title}
      </Box>
      {children}
    </Box>
  );
}

const isNameTaken = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'LabelNameTaken';

/**
 * 카드의 라벨 고르기(핀 입력 카드와 같이 쓴다). `labelIds`는 고른 그대로, `shownIds`는 그사이 지워진
 * 라벨을 뺀 것이다. 저장할 때는 최신본 기준으로 다시 걸러야 한다.
 */
export function useCardLabels() {
  const library = useAtomValue(libraryAtom);
  const jotaiStore = useStore();
  const { run } = useLibraryAction();
  const labels = useMemo(() => liveLabels(library), [library]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  // 고른 라벨 중 그사이 지워진 것은 보이지 않게 뺀다.
  const shownIds = labelIds.filter((id) => labels.some((label) => label.id === id));

  const toggle = (labelId: string) =>
    setLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId],
    );
  const select = (labelId: string) =>
    setLabelIds((ids) => (ids.includes(labelId) ? ids : [...ids, labelId]));

  // 새 라벨을 만들어 고른다. 같은 이름의 라벨이 있으면 그 라벨을 고른다.
  const createAndSelect = async (name: string): Promise<LibraryActionResult> => {
    const result = await run((lib, ctx) => createLabel(lib, name, ctx));
    if (result.ok) {
      select(result.createdId!);
      return result;
    }
    if (isNameTaken(result.error)) {
      const wanted = normalizeLabelName(name);
      const found = liveLabels(jotaiStore.get(libraryAtom)).find(
        (label) => normalizeLabelName(label.name.value) === wanted,
      );
      if (found !== undefined) {
        select(found.id);
        return { ok: true };
      }
    }
    return result;
  };

  return { labels, labelIds, shownIds, toggle, createAndSelect };
}

/** 마운트돼 있는 동안 `true`. 저장하는 사이 칸이 닫혔는지 볼 때 쓴다. */
export function useAliveRef() {
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  return aliveRef;
}

/**
 * 링크로 찾은 장소의 확인 카드(스펙 §2.2·§3.4). 주소는 추가 전 여기서만 고칠 수 있다.
 * 같은 출처의 살아 있는 장소가 있으면 새로 만들지 않고 고른 라벨(과 메모)만 더한다.
 * 지운 장소는 `addPlace`가 되살리므로 보통의 `추가`로 다룬다.
 */
export function CandidateCard({ candidate }: { candidate: PlaceCandidate }) {
  const library = useAtomValue(libraryAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const { labels, labelIds, shownIds, toggle, createAndSelect } = useCardLabels();

  const [address, setAddress] = useState(candidate.address);
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `saving`을 못 본다.
  const savingRef = useRef(false);
  // 저장하는 사이 칸이 닫혔다면(칸의 닫기 버튼·시트 바깥 누르기) 늦은 결과로 흐름·경로를 건드리지 않는다.
  const aliveRef = useAliveRef();

  const existing = findExisting(library, candidate.source);
  const merging = existing !== undefined && existing.deletedAt === null;

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const result = await run((lib, ctx) =>
      addPlace(
        lib,
        { ...candidate, address: address.trim() },
        {
          // 다른 탭이 그사이 지운 라벨은 빼고 넣는다(최신본 기준).
          labelIds: labelIds.filter((id) => lib.labels[id]?.deletedAt === null),
          memo,
        },
        ctx,
      ),
    );
    savingRef.current = false;
    setSaving(false);
    // 저장소 오류는 앱 오류 보고자(ErrorReporter)가 `userMessage`로 토스트를 띄운다. 라벨 id를 최신본 기준으로
    // 다시 거르므로 연산 거절(OpRejected)은 생기지 않는다. 어느 쪽이든 카드와 입력은 그대로 둔다.
    if (!result.ok) return;
    // 칸이 닫힌 뒤에도 저장은 이미 반영됐으므로 알린다. 흐름 닫기·이동은 새 흐름을 닫을 수 있어 하지 않는다.
    toast('추가했어요');
    if (!aliveRef.current) return;
    setFlow({ step: 'closed' });
    void navigate(paths.place(result.createdId!));
  };

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      {merging && (
        <Box
          role="status"
          sx={{
            mb: 1.5,
            p: 1.25,
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-bg-raised)',
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          이미 있는 장소예요. 고른 라벨만 더할게요
        </Box>
      )}
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          px: 1,
          py: 0.25,
          borderRadius: 'var(--tm-radius-sm)',
          border: '1px solid var(--tm-border)',
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--tm-text-secondary)',
        }}
      >
        {PROVIDER_LABEL[candidate.source.kind]}
      </Box>
      <Typography
        variant="h6"
        component="h2"
        sx={{ mt: 0.75, fontWeight: 800, wordBreak: 'break-word' }}
      >
        {candidate.name}
      </Typography>
      {candidate.category !== null && (
        <Box component="p" sx={{ m: 0, mt: 0.25, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
          {candidate.category}
        </Box>
      )}
      <CardSection title="주소">
        <Box
          component="input"
          type="text"
          aria-label="주소"
          autoComplete="off"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          sx={CARD_FIELD_SX}
        />
        {/* 주소 변환이 못 찾았을 때, 사용자가 주소를 쓰기 전까지만 보인다. */}
        {candidate.address === '' && address.trim() === '' && (
          <Box
            component="p"
            sx={{ m: 0, mt: 0.5, fontSize: 12, color: 'var(--tm-text-secondary)' }}
          >
            주소를 찾지 못했어요. 직접 입력해 주세요
          </Box>
        )}
      </CardSection>
      <CardSection title="라벨">
        <LabelPicker
          labels={labels}
          attachedIds={shownIds}
          onToggle={toggle}
          onCreate={createAndSelect}
        />
      </CardSection>
      <CardSection title="메모">
        <Box
          component="textarea"
          aria-label="메모"
          rows={4}
          maxLength={LIBRARY_LIMITS.memoChars}
          placeholder="이 장소에 대한 메모"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          sx={{ ...CARD_FIELD_SX, minHeight: 96, py: 1.25, lineHeight: 1.6, resize: 'vertical' }}
        />
      </CardSection>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2.5 }}>
        <Button
          disabled={saving}
          onClick={() => setFlow({ step: 'closed' })}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => void save()}
          sx={{ minHeight: 44 }}
        >
          {merging ? '라벨 더하기' : '추가'}
        </Button>
      </Box>
    </Box>
  );
}

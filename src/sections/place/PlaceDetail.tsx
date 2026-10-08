import Box from '@mui/material/Box';
import { useAtomValue } from 'jotai';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ExternalLinkIcon, TrashIcon } from 'src/components/icons';
import { naverPlaceUrlOf } from 'src/domain/library/links';
import {
  createAndAttachLabel,
  deletePlaces,
  restorePlaces,
  setPlaceCategory,
  setPlaceMemo,
  setPlaceName,
  toggleLabel,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import type { Place } from 'src/schema/library';
import { paths } from 'src/routes/paths';
import { UNDO_MS } from 'src/sections/library/LibraryPage';
import { EditableText } from 'src/sections/place/EditableText';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { MemoEditor } from 'src/sections/place/MemoEditor';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const BUTTON_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  minHeight: 44,
  px: 1.5,
  border: '1px solid var(--tm-border)',
  borderRadius: 'var(--tm-radius-md)',
  background: 'transparent',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
  '& svg': { width: 16, height: 16 },
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 2.5 }}>
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

function NotFound() {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2 }}>
      <Box component="p" sx={{ m: 0, mb: 1.5, fontWeight: 800 }}>
        장소를 찾을 수 없어요
      </Box>
      <Box
        component="button"
        type="button"
        onClick={() => void navigate(paths.library, { replace: true })}
        sx={BUTTON_SX}
      >
        보관함으로 돌아가기
      </Box>
    </Box>
  );
}

/** 장소 하나의 편집 화면. 장소가 바뀌면 `key`로 새로 만들어 이전 장소의 입력 상태를 이어받지 않는다. */
function PlaceBody({ place }: { place: Place }) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const labels = useMemo(() => liveLabels(library), [library]);
  const id = place.id;
  const url = naverPlaceUrlOf(place);

  // 실패(저장소 오류)는 `run`이 토스트로 알린다. 여기서는 중복해서 알리지 않는다.
  const saveName = (text: string) => run((lib, ctx) => setPlaceName(lib, id, text, ctx));
  const saveCategory = (text: string) =>
    run((lib, ctx) => setPlaceCategory(lib, id, text === '' ? null : text, ctx));
  const saveMemo = (text: string) => run((lib, ctx) => setPlaceMemo(lib, id, text, ctx));

  const remove = async () => {
    const result = await run((lib, ctx) => deletePlaces(lib, [id], ctx));
    if (!result.ok) return;
    // 기록을 교체해서 뒤로 가기가 지운 장소를 다시 열지 않게 한다.
    void navigate(paths.library, { replace: true });
    toast('장소를 지웠어요', {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        onClick: () => void run((lib, ctx) => restorePlaces(lib, [id], ctx)),
      },
    });
  };

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <EditableText
        variant="title"
        label="이름"
        value={place.name.value}
        allowEmpty={false}
        onSave={saveName}
      />
      <Box component="p" sx={{ m: 0, mt: 0.5, fontSize: 13, color: 'var(--tm-text-secondary)' }}>
        {place.address}
      </Box>
      <Box sx={{ mt: 1 }}>
        <EditableText
          label="분류"
          value={place.category.value ?? ''}
          emptyText="분류 추가"
          allowEmpty
          onSave={saveCategory}
        />
      </Box>
      {url !== null && (
        <Box sx={{ mt: 1.5 }}>
          <Box component="a" href={url} target="_blank" rel="noopener noreferrer" sx={BUTTON_SX}>
            <ExternalLinkIcon aria-hidden="true" />
            네이버 지도에서 열기
          </Box>
        </Box>
      )}
      <Section title="라벨">
        <LabelPicker
          labels={labels}
          attachedIds={place.labelIds.value}
          onToggle={(labelId) => void run((lib, ctx) => toggleLabel(lib, id, labelId, ctx))}
          onCreate={(name) => run((lib, ctx) => createAndAttachLabel(lib, id, name, ctx))}
        />
      </Section>
      <Section title="메모">
        <MemoEditor placeId={id} saved={place.memo.value} onSave={saveMemo} />
      </Section>
      <Box sx={{ mt: 3 }}>
        <Box component="button" type="button" onClick={() => void remove()} sx={BUTTON_SX}>
          <TrashIcon aria-hidden="true" />
          삭제
        </Box>
      </Box>
    </Box>
  );
}

/** 장소 상세(스펙 §4.3). 없는 id나 지운 장소는 안내와 함께 보관함으로 돌아가는 길을 준다. */
export function PlaceDetail({ placeId }: { placeId: string }) {
  const library = useAtomValue(libraryAtom);
  const place = library.places[placeId];
  if (place === undefined || place.deletedAt !== null) return <NotFound />;
  return <PlaceBody key={place.id} place={place} />;
}

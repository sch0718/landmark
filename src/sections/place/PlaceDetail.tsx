import Box from '@mui/material/Box';
import { useAtomValue } from 'jotai';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { HelpButton } from 'src/components/HelpButton';
import { ExternalLinkIcon, TrashIcon } from 'src/components/icons';
import { naverPlaceUrlOf } from 'src/domain/library/links';
import {
  deletePlaces,
  markVisitedToday,
  restorePlaces,
  setPlaceCategory,
  setPlaceMemo,
  setPlaceName,
  setPlaceReview,
  setVisitedOn,
  toggleLabel,
} from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { localDateOf, reviewOf, visitedOnOf } from 'src/domain/library/visit';
import { LIBRARY_LIMITS, type Place } from 'src/schema/library';
import { paths } from 'src/routes/paths';
import { UNDO_MS } from 'src/sections/library/LibraryPage';
import { BUTTON_SX } from 'src/sections/place/button-style';
import { EditableText } from 'src/sections/place/EditableText';
import { LabelPicker } from 'src/sections/place/LabelPicker';
import { MemoEditor } from 'src/sections/place/MemoEditor';
import { VisitEditor } from 'src/sections/place/VisitEditor';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

/** 장소 상세 안 제목 단계. 화면의 `h1`이면 1, 다른 `h1`이 이미 있는 화면(여행 계획) 안이면 2. */
type HeadingLevel = 1 | 2;

function Section({
  title,
  level,
  children,
}: {
  title: string;
  level: HeadingLevel;
  children: ReactNode;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 2.5 }}>
      <Box
        component={level === 1 ? 'h2' : 'h3'}
        sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 800, color: 'var(--tm-text-secondary)' }}
      >
        {title}
      </Box>
      {children}
    </Box>
  );
}

function NotFound({ level }: { level: HeadingLevel }) {
  const navigate = useNavigate();
  return (
    <Box sx={{ p: 2 }}>
      <Box component={`h${level}`} sx={{ m: 0, mb: 1.5, fontSize: 'inherit', fontWeight: 800 }}>
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
function PlaceBody({ place, level }: { place: Place; level: HeadingLevel }) {
  const library = useAtomValue(libraryAtom);
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const labels = useMemo(() => liveLabels(library), [library]);
  const id = place.id;
  const url = naverPlaceUrlOf(place);

  // 저장소 오류는 `run`이 토스트로 알리니 여기서 다시 알리지 않는다. 연산이 거절한 경우(`OpRejected`)는
  // `run`이 알리지 않으므로 거절될 수 있는 `createAndAttachLabel`은 `LabelPicker`가 입력란에 보여 준다.
  const saveName = (text: string) => run((lib, ctx) => setPlaceName(lib, id, text, ctx));
  const saveCategory = (text: string) =>
    run((lib, ctx) => setPlaceCategory(lib, id, text === '' ? null : text, ctx));
  const saveMemo = (text: string) => run((lib, ctx) => setPlaceMemo(lib, id, text, ctx));
  const saveReview = (text: string) => run((lib, ctx) => setPlaceReview(lib, id, text, ctx));
  const markVisited = async () => (await run((lib, ctx) => markVisitedToday(lib, [id], ctx))).ok;
  const setVisitDate = (date: string) =>
    void run((lib, ctx) => setVisitedOn(lib, { [id]: date }, ctx));

  const clearVisit = async () => {
    // 지우기 전 날짜는 연산 안에서(저장된 최신본에서) 읽는다. 다른 탭이 이미 지웠으면 되돌리기를 내놓지 않는다.
    const before: { date: string | null } = { date: null };
    const result = await run((lib, ctx) => {
      const current = lib.places[id];
      before.date = current === undefined ? null : visitedOnOf(current);
      return setVisitedOn(lib, { [id]: null }, ctx);
    });
    const prev = before.date;
    if (!result.ok || prev === null) return result.ok;
    toast('다녀옴 표시를 지웠어요', {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        // 그사이 다른 날짜로 다시 표시했다면 덮어쓰지 않는다.
        onClick: () =>
          void run((lib, ctx) => {
            const current = lib.places[id];
            if (current === undefined || visitedOnOf(current) !== null) return lib;
            return setVisitedOn(lib, { [id]: prev }, ctx);
          }),
      },
    });
    return true;
  };

  const remove = async () => {
    // 이미 다른 탭이 지운 장소라면 되돌리기를 내놓지 않는다(저장된 최신본으로 판단한다).
    let deleted: string[] = [];
    const result = await run((lib, ctx) => {
      deleted = [id].filter((placeId) => lib.places[placeId]?.deletedAt === null);
      return deletePlaces(lib, [id], ctx);
    });
    if (!result.ok) return;
    // 기록을 교체해서 뒤로 가기가 지운 장소를 다시 열지 않게 한다.
    void navigate(paths.library, { replace: true });
    if (deleted.length === 0) return;
    toast('장소를 지웠어요', {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        onClick: () => void run((lib, ctx) => restorePlaces(lib, deleted, ctx)),
      },
    });
  };

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <EditableText
            variant="title"
            headingLevel={level}
            label="이름"
            value={place.name.value}
            allowEmpty={false}
            onSave={saveName}
          />
        </Box>
        <HelpButton page="place" />
      </Box>
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
          {/* 끌 수 없게 한다: 반쯤 시트를 마우스로 끌 때 링크 끌기가 시트 끌기를 끊는다(pointercancel). */}
          <Box
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            sx={BUTTON_SX}
          >
            <ExternalLinkIcon aria-hidden="true" />
            네이버 지도에서 열기
          </Box>
        </Box>
      )}
      <Section title="다녀옴" level={level}>
        <VisitEditor
          visitedOn={visitedOnOf(place)}
          today={localDateOf(new Date().toISOString())}
          onMarkToday={markVisited}
          onSetDate={setVisitDate}
          onClear={clearVisit}
        />
      </Section>
      <Section title="한 줄 평" level={level}>
        <EditableText
          label="한 줄 평"
          value={reviewOf(place)}
          emptyText="한 줄 평 남기기 (140자까지)"
          allowEmpty
          maxLength={LIBRARY_LIMITS.reviewChars}
          onSave={saveReview}
        />
      </Section>
      <Section title="라벨" level={level}>
        <LabelPicker
          labels={labels}
          attachedIds={place.labelIds.value}
          onToggle={(labelId) => run((lib, ctx) => toggleLabel(lib, id, labelId, ctx))}
          onCreate={async (name) => {
            const { createAndAttachLabel } = await import('src/domain/library/label-create');
            return run((lib, ctx) => createAndAttachLabel(lib, id, name, ctx));
          }}
        />
      </Section>
      <Section title="메모" level={level}>
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

/**
 * 장소 상세(스펙 §4.3). 없는 id나 지운 장소는 안내와 함께 보관함으로 돌아가는 길을 준다.
 * 장소 이름은 화면의 `h1`이다(`headingLevel` 1). 여행 계획 안에서는 여행 제목이 `h1`이라 2로 내린다.
 */
export function PlaceDetail({
  placeId,
  headingLevel = 1,
}: {
  placeId: string;
  headingLevel?: HeadingLevel;
}) {
  const library = useAtomValue(libraryAtom);
  const place = library.places[placeId];
  if (place === undefined || place.deletedAt !== null) return <NotFound level={headingLevel} />;
  return <PlaceBody key={place.id} place={place} level={headingLevel} />;
}

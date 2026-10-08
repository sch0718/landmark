import Box from '@mui/material/Box';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  DEFAULT_QUERY,
  labelCounts,
  liveLabels,
  livePlaces,
  queryPlaces,
  regionCounts,
  type LibraryQuery,
} from 'src/domain/library/query';
import { addLabels, deletePlaces, removeLabels, restorePlaces } from 'src/domain/library/ops';
import { paths } from 'src/routes/paths';
import { BulkBar } from 'src/sections/library/BulkBar';
import { EmptyState } from 'src/sections/library/EmptyState';
import { FilterBar } from 'src/sections/library/FilterBar';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { BentoView } from 'src/sections/library/views/BentoView';
import { CardsView } from 'src/sections/library/views/CardsView';
import { ListView } from 'src/sections/library/views/ListView';
import { TilesView } from 'src/sections/library/views/TilesView';
import type { LibraryView } from 'src/sections/library/ViewSwitcher';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';
import { prefsAtom, setPrefsAtom } from 'src/stores/prefs-state';

/** 삭제 직후 "되돌리기"를 보여 주는 시간. */
export const UNDO_MS = 5000;

const hasActiveFilter = (q: LibraryQuery): boolean =>
  q.labelIds.length > 0 || q.unlabeled || q.regions.length > 0 || q.text.trim() !== '';

const toggled = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

/**
 * 보관함 목록 화면(스펙 §4.2). 위에서부터 검색·보기·정렬, 라벨·지역 칩, 보기 본문, 선택 모드의 하단 바.
 * 벤토·타일은 "라벨 개요" 보기라서 필터가 걸리면 그 아래에 장소 목록(`ListView`)을 함께 보여 준다.
 */
export function LibraryPage() {
  const library = useAtomValue(libraryAtom);
  const prefs = useAtomValue(prefsAtom);
  const setPrefs = useSetAtom(setPrefsAtom);
  const [query, patch] = useLibraryQuery();
  const { run } = useLibraryAction();
  const navigate = useNavigate();
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const view = prefs.libraryView;
  const labels = useMemo(() => liveLabels(library), [library]);
  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const total = useMemo(() => livePlaces(library).length, [library]);
  const places = useMemo(() => queryPlaces(library, query), [library, query]);
  const counts = useMemo(() => labelCounts(library, query), [library, query]);
  const regions = useMemo(() => regionCounts(library, query), [library, query]);

  const overview = view === 'bento' || view === 'tiles';
  const showList = places.length > 0 && (!overview || hasActiveFilter(query));

  // 화면에 보이는 장소만 선택으로 센다. 필터가 바뀌거나 목록이 접혀 사라진 선택은 버린다(렌더 중 상태 갱신).
  const visible = new Set(showList ? places.map((p) => p.id) : []);
  if ([...selected].some((id) => !visible.has(id))) {
    setSelected(new Set([...selected].filter((id) => visible.has(id))));
  }
  const selectedPlaces = places.filter((p) => selected.has(p.id));
  const selectedIds = selectedPlaces.map((p) => p.id);
  const attached = labels.filter((l) =>
    selectedPlaces.some((p) => p.labelIds.value.includes(l.id)),
  );

  const onOpen = useCallback((id: string) => void navigate(paths.place(id)), [navigate]);
  const onToggle = useCallback((id: string) => setSelected((prev) => toggled(prev, id)), []);

  const changeView = (next: LibraryView) => setPrefs({ ...prefs, libraryView: next });
  // 실패는 `run`이 토스트로 알린다(`ErrorReporter`). 여기서는 성공했을 때만 이어서 한다.
  const attach = (labelId: string) =>
    void run((lib, ctx) => addLabels(lib, selectedIds, [labelId], ctx));
  const detach = (labelId: string) =>
    void run((lib, ctx) => removeLabels(lib, selectedIds, [labelId], ctx));
  const remove = async () => {
    const ids = selectedIds;
    // 화면에서 고른 id가 아니라, 저장된 최신본에서 이번에 실제로 지워지는 장소만 되돌린다
    // (다른 탭이 먼저 지운 장소를 되돌리기가 살려 내지 않도록).
    let deleted: string[] = [];
    const result = await run((lib, ctx) => {
      deleted = ids.filter((id) => lib.places[id]?.deletedAt === null);
      return deletePlaces(lib, ids, ctx);
    });
    if (!result.ok) return;
    setSelected(new Set());
    if (deleted.length === 0) return;
    toast(`${deleted.length}곳을 지웠어요`, {
      duration: UNDO_MS,
      action: {
        label: '되돌리기',
        // 같은 장소가 그 사이 다시 저장됐다면 검증에 막혀 실패한다. 그때도 `run`이 토스트로 알린다.
        onClick: () => void run((lib, ctx) => restorePlaces(lib, deleted, ctx)),
      },
    });
  };
  const clearFilters = () => patch({ ...DEFAULT_QUERY, sort: query.sort });

  const listProps = {
    places,
    labelsById,
    selection: selected,
    scrollElement,
    onOpen,
    onToggle,
  };
  const overviewProps = { labels, counts, query, onSelect: patch };

  if (total === 0) {
    return (
      <EmptyState
        title="아직 저장한 장소가 없어요"
        actionLabel="옛 여행 가져오기"
        onAction={() => void navigate(paths.settingsImport)}
      />
    );
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 'none' }}>
        <FilterBar
          query={query}
          onChange={patch}
          labels={labels}
          counts={counts}
          regions={regions}
          view={view}
          onViewChange={changeView}
        />
      </Box>
      <Box ref={setScrollElement} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box>
          {view === 'bento' && <BentoView {...overviewProps} />}
          {view === 'tiles' && <TilesView {...overviewProps} />}
          {showList &&
            (view === 'cards' ? <CardsView {...listProps} /> : <ListView {...listProps} />)}
          {places.length === 0 && (
            <EmptyState
              title="조건에 맞는 장소가 없어요"
              actionLabel="필터 지우기"
              onAction={clearFilters}
            />
          )}
        </Box>
      </Box>
      {selectedIds.length > 0 && (
        <BulkBar
          count={selectedIds.length}
          labels={labels}
          attached={attached}
          onAdd={attach}
          onRemove={detach}
          onDelete={() => void remove()}
          onClear={() => setSelected(new Set())}
        />
      )}
    </Box>
  );
}

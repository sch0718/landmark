import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { createStore, Provider, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useContext, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ErrorScreen } from 'src/components/ErrorScreen';
import { NicknameDialog } from 'src/components/NicknameDialog';
import { ReconcileBanner } from 'src/components/ReconcileBanner';
import { MapView } from 'src/components/map/MapView';
import { keepMine } from 'src/domain/reconcile';
import { TripLayout } from 'src/layouts/TripLayout';
import type { ImportInput } from 'src/repositories/import-flow';
import {
  mapBoundsAtom,
  mapFocusAtom,
  useExploreMarkers,
} from 'src/sections/explore/store/explore-state';
import { ExplorePanel } from 'src/sections/explore/view/ExplorePanel';
import {
  useItineraryLayers,
  useItineraryMarkerClick,
} from 'src/sections/itinerary/store/itinerary-state';
import { ItineraryPanel } from 'src/sections/itinerary/view/ItineraryPanel';
import { useHashImport } from 'src/sections/share/use-hash-import';
import { ExportDialog } from 'src/sections/share/view/ExportDialog';
import { ImportDialog } from 'src/sections/share/view/ImportDialog';
import {
  createTripStore,
  TripDepsContext,
  TripStoreContext,
  useEditActions,
  useTripStore,
} from 'src/stores/trip-store';
import {
  buildUiQuery,
  modeAtom,
  parseUiQuery,
  searchQueryAtom,
  selectedDayAtom,
  selectedPlaceAtom,
  uiStateKey,
  type Mode,
} from 'src/stores/ui-store';

/** `/t/:publicId` — publicId가 바뀌면 store를 새로 만든다. */
export function TripRoute() {
  const { publicId = '' } = useParams();
  return <TripPage key={publicId} publicId={publicId} />;
}

export function TripPage({ publicId }: { publicId: string }) {
  const deps = useContext(TripDepsContext);
  const [scope] = useState(() => ({
    tripStore: createTripStore(publicId, deps),
    store: deps.jotaiStore ?? createStore(),
  }));
  return (
    <TripStoreContext value={scope.tripStore}>
      <Provider store={scope.store}>
        <TripScreen />
      </Provider>
    </TripStoreContext>
  );
}

function TripScreen() {
  const ts = useTripStore();
  const loadState = useAtomValue(ts.loadStateAtom);
  const load = useSetAtom(ts.loadAtom);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === 'error') {
    if (loadState.kind === 'not-found') return <ErrorScreen title={loadState.message} />;
    return (
      <ErrorScreen
        title="여행 데이터를 읽지 못했어요"
        details={[`schemaVersion: ${String(loadState.schemaVersion ?? '없음')}`, loadState.message]}
      />
    );
  }

  return (
    <>
      {loadState.status === 'ready' ? (
        <ReadyTrip />
      ) : (
        <Box sx={{ p: 3 }} role="status">
          불러오는 중…
        </Box>
      )}
      <NicknamePrompt />
    </>
  );
}

function ReadyTrip() {
  const ts = useTripStore();
  const setMapUnavailable = useSetAtom(ts.mapUnavailableAtom);
  const mode = useAtomValue(modeAtom);
  const day = useAtomValue(selectedDayAtom);
  const setSelectedPlace = useSetAtom(selectedPlaceAtom);
  const setBounds = useSetAtom(mapBoundsAtom);
  const focus = useAtomValue(mapFocusAtom);
  const exploreMarkers = useExploreMarkers();
  const itinerary = useItineraryLayers();
  const onItineraryMarkerClick = useItineraryMarkerClick();
  useUiQuerySync();
  return (
    <TripLayout
      topBar={
        <>
          <TopBar />
          <ConnectedReconcileBanner />
        </>
      }
      map={
        <MapView
          markers={mode === 'explore' ? exploreMarkers : itinerary.markers}
          polylines={itinerary.polylines}
          onMarkerClick={(id) => {
            if (mode === 'explore') setSelectedPlace(id);
            else onItineraryMarkerClick(id);
          }}
          onBoundsChange={setBounds}
          focus={focus}
          fitKey={mode === 'itinerary' ? `itinerary:${day}` : 'explore'}
          onUnavailable={setMapUnavailable}
        />
      }
      panel={mode === 'explore' ? <ExplorePanel /> : <ItineraryPanel />}
    />
  );
}

/** `mode`·`day`·`place` 쿼리와 UI atom을 양방향으로 맞춘다. URL이 바뀌면 URL을 따른다. */
function useUiQuerySync() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useAtom(modeAtom);
  const [day, setDay] = useAtom(selectedDayAtom);
  const [place, setPlace] = useAtom(selectedPlaceAtom);
  /**
   * url: 마지막으로 반영한 쿼리, state: 그 쿼리가 뜻하는 UI 상태, atoms: 마지막 실행에서 본 atom 상태.
   * atom→URL은 atom 값이 이전 실행과 달라졌을 때만 쓴다. 그래서 같은 렌더 값으로 effect가 다시
   * 도는 경우(StrictMode 이중 실행 등)에 아직 URL 값을 받지 못한 atom으로 URL을 덮어쓰지 않는다.
   */
  const last = useRef<{ url: string; state: string; atoms: string } | null>(null);

  useEffect(() => {
    if (!trip) return;
    const dates = trip.days.map((d) => d.date);
    const url = searchParams.toString();
    const atoms = uiStateKey({ mode, day, place });
    const prev = last.current;
    if (prev === null || prev.url !== url) {
      // 진입·탐색: URL을 따른다.
      const fromUrl = parseUiQuery(searchParams, dates);
      const state = uiStateKey(fromUrl);
      last.current = { url, state, atoms };
      if (state !== atoms) {
        setMode(fromUrl.mode);
        setDay(fromUrl.day);
        setPlace(fromUrl.place);
      }
      return;
    }
    if (atoms === prev.atoms) return;
    last.current = { ...prev, atoms };
    // atom이 URL 값을 따라잡은 것이면 쓸 것이 없다.
    if (atoms === prev.state) return;
    const next = buildUiQuery(searchParams, { mode, day, place }, dates);
    last.current = { url: next.toString(), state: atoms, atoms };
    setSearchParams(next, { replace: true });
  }, [trip, searchParams, setSearchParams, mode, day, place, setMode, setDay, setPlace]);
}

function TopBar() {
  const ts = useTripStore();
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const [mode, setMode] = useAtom(modeAtom);
  const [query, setQuery] = useAtom(searchQueryAtom);
  const renameNickname = useSetAtom(ts.renameNicknameAtom);
  const { ensureAuthor } = useEditActions();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<{ seq: number; input: ImportInput } | null>(null);
  const storageUnavailable = useAtomValue(ts.storageUnavailableAtom);
  const fileInput = useRef<HTMLInputElement>(null);

  const startImport = (input: ImportInput) =>
    setImporting((prev) => ({ seq: (prev?.seq ?? 0) + 1, input }));
  useHashImport(startImport);

  const openRename = () => {
    setMenuAnchor(null);
    if (edit) setRenaming(true);
    else ensureAuthor().catch(reportSaveError);
  };

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar variant="dense" sx={{ gap: 1, flexWrap: 'wrap', py: 0.5 }}>
        <Typography variant="subtitle1" component="h1" noWrap sx={{ fontWeight: 700, mr: 1 }}>
          {trip?.title}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_e, value: Mode | null) => {
            if (value) setMode(value);
          }}
          aria-label="보기 전환"
        >
          <ToggleButton value="explore">탐색</ToggleButton>
          <ToggleButton value="itinerary">일정</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="이름·주소·메모·태그 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': '검색' } }}
          sx={{ flex: 1, minWidth: 160 }}
        />
        <IconButton aria-label="설정" onClick={(e) => setMenuAnchor(e.currentTarget)}>
          ⚙
        </IconButton>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          <MenuItem onClick={openRename}>닉네임 변경</MenuItem>
          <MenuItem
            data-emphasized={storageUnavailable ? 'true' : 'false'}
            onClick={() => {
              setMenuAnchor(null);
              setExporting(true);
            }}
            sx={storageUnavailable ? { fontWeight: 700, color: 'primary.main' } : undefined}
          >
            {storageUnavailable ? (
              <Box>
                내보내기
                <Typography variant="caption" component="div" color="text.secondary">
                  이 브라우저에는 저장되지 않아요
                </Typography>
              </Box>
            ) : (
              '내보내기'
            )}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              fileInput.current?.click();
            }}
          >
            파일 가져오기
          </MenuItem>
        </Menu>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="편집 파일 선택"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) startImport({ kind: 'file', file });
          }}
        />
      </Toolbar>
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      {importing && (
        <ImportDialog
          key={importing.seq}
          input={importing.input}
          onClose={() => setImporting(null)}
        />
      )}
      <NicknameDialog
        open={renaming}
        title="닉네임 변경"
        initialValue={edit ? (edit.authors[edit.authorId]?.nickname ?? '') : ''}
        onCancel={() => setRenaming(false)}
        onSubmit={(nickname) => {
          setRenaming(false);
          renameNickname(nickname).catch(reportSaveError);
        }}
      />
    </AppBar>
  );
}

function ConnectedReconcileBanner() {
  const ts = useTripStore();
  const report = useAtomValue(ts.reconcileReportAtom);
  const trip = useAtomValue(ts.tripAtom);
  const edit = useAtomValue(ts.editLayerAtom);
  const effective = useAtomValue(ts.effectiveTripAtom);
  const keepMineGroup = useSetAtom(ts.keepMineAtom);
  const revertGroup = useSetAtom(ts.revertGroupAtom);
  if (!report || !trip || !effective) return null;

  const dayNumber = new Map(trip.days.map((d, i) => [d.date, i + 1]));
  const unresolved = new Set(effective.days.filter((d) => d.unresolved).map((d) => d.date));
  return (
    <ReconcileBanner
      report={report}
      isUnresolved={(date) => unresolved.has(date)}
      dayLabel={(date) => `Day ${dayNumber.get(date) ?? date}`}
      canKeepMine={(dates) => edit !== null && keepMine(trip, edit, dates, ts.nowIso()) !== null}
      onRevert={(dates) => {
        revertGroup(dates).catch(reportSaveError);
      }}
      onKeepMine={(dates) => {
        keepMineGroup(dates).catch(reportSaveError);
      }}
    />
  );
}

function NicknamePrompt() {
  const ts = useTripStore();
  const request = useAtomValue(ts.nicknameRequestAtom);
  return (
    <NicknameDialog
      open={request !== null}
      initialValue={request?.initial}
      onCancel={() => request?.resolve(null)}
      onSubmit={(nickname) => request?.resolve(nickname)}
    />
  );
}

function reportSaveError(e: unknown) {
  console.warn('편집을 저장하지 못했어요', e);
  toast.error('편집을 저장하지 못했어요');
}

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fieldSx } from 'src/components/field-style';
import { LabelGlyph } from 'src/components/icons';
import { importFolder, planFolderImport } from 'src/domain/library/add-place';
import type { OpResult, OpSummary } from 'src/domain/library/ops';
import { recordFolderLink } from 'src/domain/library/folder-links';
import { liveLabels } from 'src/domain/library/query';
import { labelNameIssue, type Library } from 'src/schema/library';
import { FolderPlaceRows } from 'src/sections/add-place/FolderPlaceRows';
import { resultMessage, type FolderPlace } from 'src/sections/add-place/shared';
import { thenAddCandidates, useTripTarget } from 'src/sections/add-place/trip-target';
import { ChipButton } from 'src/sections/library/ChipButton';
import { labelColors } from 'src/sections/library/label-style';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

/** 가져온 뒤의 문서에서 폴더 항목들의 장소 id(같은 네이버 `sid`의 살아 있는 장소). 여행 후보에 넣을 때 쓴다. */
function importedPlaceIds(lib: Library, items: readonly FolderPlace[]): string[] {
  const bySid = new Map<string, string>();
  for (const place of Object.values(lib.places)) {
    if (place.source.kind === 'naver' && place.deletedAt === null) {
      bySid.set(place.source.sid, place.id);
    }
  }
  return items.flatMap((item) => {
    const id = bySid.get(item.sid);
    return id === undefined ? [] : [id];
  });
}

/**
 * 조회가 끝난 미리보기. 머리글, 붙일 라벨(이름 입력 또는 기존 라벨), 장소 목록(체크박스), 가져오기.
 * 가져오기는 `LibraryStore.update` 한 번으로 최신본에 적용하고, 토스트 개수는 그 결과(`summary`)에서 센다.
 * `이미 있음` 표시는 화면에 보이는 보관함 기준의 안내일 뿐이다.
 * 가져오면 폴더와 라벨의 연결도 같은 연산에서 남긴다(나중에 새로 저장한 곳만 다시 가져오려고).
 * 여행 대상이 붙은 흐름이면 같은 연산에서 가져온 장소를 모두 그 여행의 후보에 넣고 계획 화면으로 간다
 * (폴더는 라벨이 붙으므로 늘 보관함에 저장한다).
 */
export function FolderList({
  shareId,
  folderName,
  places,
}: {
  shareId: string;
  folderName: string;
  places: FolderPlace[];
}) {
  const library = useAtomValue(libraryAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const [, patchQuery] = useLibraryQuery();
  const { tripId, notify, backToTrip } = useTripTarget();
  const labels = useMemo(() => liveLabels(library), [library]);
  const marks = useMemo(
    () =>
      new Map(
        planFolderImport(library, places).merge.map(({ item }) => [item.sid, '이미 있음'] as const),
      ),
    [library, places],
  );

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(places.map((place) => place.sid)),
  );
  const [name, setName] = useState(folderName);
  const [pickedLabelId, setPickedLabelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `saving`을 못 본다.
  const savingRef = useRef(false);
  // 저장하는 사이 칸이 닫혔다면(칸의 닫기 버튼) 늦은 결과로 흐름·토스트·필터를 건드리지 않는다.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const nameErrorId = useId();

  // 고른 라벨이 그사이 지워졌으면 고르지 않은 것으로 본다.
  const labelId =
    pickedLabelId !== null && labels.some((label) => label.id === pickedLabelId)
      ? pickedLabelId
      : null;
  const nameIssue = labelNameIssue(name);
  const nameTooLong = labelId === null && nameIssue === 'too-long';
  const nameValid = labelId !== null || nameIssue === null;
  const count = selected.size;
  const allSelected = count > 0 && count === places.length;
  const canImport = count > 0 && nameValid && !saving;

  const toggle = (sid: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(sid)) next.add(sid);
      return next;
    });

  const submit = async () => {
    if (savingRef.current || !canImport) return;
    savingRef.current = true;
    setSaving(true);
    const items = places.filter((place) => selected.has(place.sid));
    // 고른 라벨의 이름(렌더 시점). 그사이 다른 탭이 그 라벨을 지웠다면 같은 이름으로 다시 쓰거나 만든다.
    const pickedName = labelId === null ? null : labels.find((l) => l.id === labelId)!.name.value;
    // 연산 안에서 채운다. 저장소가 다시 시도하면 다시 채운다.
    const box: { imported?: OpSummary; placeIds: string[] } = { placeIds: [] };
    const result = await run((lib, ctx) => {
      const imported = importFolder(
        lib,
        items,
        labelId !== null && lib.labels[labelId]?.deletedAt === null
          ? { labelId }
          : { newLabelName: pickedName ?? name },
        ctx,
      );
      box.imported = imported.ok ? imported.summary : undefined;
      // 고르지 않은 곳도 확인한 곳으로 적는다. 라벨은 방금 가져온 결과의 살아 있는 라벨이다.
      const linked: OpResult = imported.ok
        ? {
            ...imported,
            lib: recordFolderLink(
              imported.lib,
              {
                shareId,
                folderName,
                labelId: imported.createdId!,
                seenSids: places.map((p) => p.sid),
              },
              ctx,
            ),
          }
        : imported;
      if (tripId === null) return linked;
      return thenAddCandidates(
        linked,
        tripId,
        (done) => {
          box.placeIds = importedPlaceIds(done.lib, items);
          return box.placeIds;
        },
        ctx,
      );
    });
    // 여행 후보까지 넣었는가(그사이 여행이 지워졌으면 보통의 가져오기로 끝낸다).
    const toTrip = tripId !== null && result.ok && result.summary !== undefined;
    // 칸이 닫힌 뒤에도 가져오기는 이미 저장소에 반영됐으므로 결과는 알린다.
    if (result.ok) {
      const message = box.imported === undefined ? null : resultMessage(box.imported);
      if (message !== null) toast(message);
      if (toTrip) notify(tripId, result.summary!.created, box.placeIds);
    }
    // 칸이 닫혔다면 잠금 해제·필터·흐름 닫기는 건드리지 않는다(새 흐름을 닫을 수 있다).
    if (!aliveRef.current) return;
    savingRef.current = false;
    setSaving(false);
    // 저장소 오류는 앱 오류 보고자(ErrorReporter)가 알리지만 연산 거절(OpRejected)은 보고되지 않는다.
    // 라벨은 위에서 최신본 기준으로 다시 정하므로 거절은 드물고, 그때는 안내 문구 없이
    // 미리보기와 선택을 그대로 두고 버튼만 다시 켠다.
    if (!result.ok) return;
    if (toTrip) {
      backToTrip(tripId);
      return;
    }
    // 방금 가져온 장소가 모두 보이도록 검색어·지역·방문 필터도 비운다.
    patchQuery({
      labelIds: [result.createdId!],
      unlabeled: false,
      text: '',
      regions: [],
      visited: 'all',
    });
    setFlow({ step: 'closed' });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 800, wordBreak: 'break-word' }}>
          {`${folderName} · ${places.length}곳`}
        </Typography>

        <Box component="section" aria-label="붙일 라벨" sx={{ mt: 2 }}>
          <Box
            component="h3"
            sx={{ m: 0, mb: 0.5, fontSize: 13, fontWeight: 800, color: 'var(--tm-text-secondary)' }}
          >
            붙일 라벨
          </Box>
          <Box
            component="input"
            type="text"
            aria-label="붙일 라벨 이름"
            aria-invalid={nameTooLong}
            aria-describedby={nameTooLong ? nameErrorId : undefined}
            autoComplete="off"
            disabled={labelId !== null}
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={fieldSx({ invalid: nameTooLong })}
          />
          {nameTooLong && (
            <Box id={nameErrorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
              라벨 이름은 30자까지예요
            </Box>
          )}
          {labels.length > 0 && (
            <Box
              role="group"
              aria-label="기존 라벨"
              sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 0.5, mt: 0.5 }}
            >
              {labels.map((label) => (
                <ChipButton
                  key={label.id}
                  selected={labelId === label.id}
                  tone={labelColors(label.color.value)}
                  onClick={() => setPickedLabelId(labelId === label.id ? null : label.id)}
                >
                  <LabelGlyph name={label.icon.value} size={14} />
                  {label.name.value}
                </ChipButton>
              ))}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Button
            size="small"
            onClick={() =>
              setSelected(allSelected ? new Set() : new Set(places.map((place) => place.sid)))
            }
            sx={{ minHeight: 44 }}
          >
            {allSelected ? '전체 해제' : '전체 선택'}
          </Button>
        </Box>
        {places.length === 0 && (
          <Typography variant="body2" sx={{ mt: 1, color: 'var(--tm-text-secondary)' }}>
            가져올 장소가 없는 폴더예요
          </Typography>
        )}
        <FolderPlaceRows
          places={places}
          selected={selected}
          marks={marks}
          onToggle={toggle}
          label="가져올 장소"
        />
      </Box>
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          p: 2,
          borderTop: '1px solid var(--tm-border)',
        }}
      >
        <Button
          disabled={saving}
          onClick={() => setFlow({ step: 'closed' })}
          sx={{ minHeight: 44 }}
        >
          취소
        </Button>
        <Button
          variant="contained"
          disabled={!canImport}
          onClick={() => void submit()}
          sx={{ minHeight: 44 }}
        >
          {`${count}곳 가져오기`}
        </Button>
      </Box>
    </Box>
  );
}

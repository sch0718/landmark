import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect, Result } from 'effect';
import { useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LabelGlyph } from 'src/components/icons';
import { importFolder, planFolderImport } from 'src/domain/library/add-place';
import type { OpSummary } from 'src/domain/library/ops';
import { liveLabels } from 'src/domain/library/query';
import { startEffect } from 'src/lib/effect/runtime';
import { LIBRARY_LIMITS, type Library } from 'src/schema/library';
import type { FolderResult } from 'src/server/resolve';
import { FolderPlaceRows } from 'src/sections/add-place/FolderPlaceRows';
import { thenAddCandidates, useTripTarget } from 'src/sections/add-place/trip-target';
import { ChipButton } from 'src/sections/library/ChipButton';
import { labelColors } from 'src/sections/library/label-style';
import { useLibraryQuery } from 'src/sections/library/use-library-query';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

const FIELD_SX = {
  boxSizing: 'border-box',
  display: 'block',
  width: '100%',
  minHeight: 44,
  px: 1.25,
  border: '1px solid',
  borderRadius: 'var(--tm-radius-md)',
  bgcolor: 'var(--tm-bg-raised)',
  color: 'var(--tm-text-primary)',
  font: 'inherit',
  fontSize: 16,
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 1 },
  '&:disabled': { opacity: 0.5 },
} as const;

/** 다시 시도할 수 있는 오류(스펙 §5). 폴더에는 핀으로 추가할 길이 없다. */
const RETRY_CODES: readonly string[] = ['UPSTREAM_ERROR', 'TIMEOUT', 'OFFLINE'];

type FolderPlace = FolderResult['places'][number];

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; error: PlaceLookupError }
  | { kind: 'ready'; folderName: string; places: FolderPlace[] };

const lookupFolder = (shareId: string) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    return yield* lookup.lookupFolder(shareId);
  });

/** 같은 `sid`가 되풀이되면 처음 것만 남긴다(가져오기도 같은 규칙으로 센다). */
function uniqueBySid(places: readonly FolderPlace[]): FolderPlace[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    if (seen.has(place.sid)) return false;
    seen.add(place.sid);
    return true;
  });
}

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

/** 가져온 결과를 세 문장 중 하나로 말한다. 되살린 장소는 새로 넣은 것에 센다. */
function resultMessage(summary: OpSummary): string | null {
  const added = summary.created + summary.restored;
  const merged = summary.merged;
  if (added > 0 && merged > 0) return `${added}곳을 새로 넣고, ${merged}곳은 라벨만 더했어요`;
  if (added > 0) return `${added}곳을 새로 넣었어요`;
  if (merged > 0) return `${merged}곳은 라벨만 더했어요`;
  return null;
}

/**
 * 네이버 공유 폴더 미리보기(스펙 §2.3). 열릴 때 폴더를 조회하고, 오류는 문구와 함께 다시 시도(가능한 경우)·취소를 준다.
 * 창이 닫힌 뒤 온 조회 결과는 버린다.
 */
export function FolderPreview({ shareId }: { shareId: string }) {
  const setFlow = useSetAtom(addFlowAtom);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  // 실행 번호. 다시 조회하거나 창이 닫히면 올려서 지난 조회의 결과가 끼어들지 않게 한다.
  const runSeq = useRef(0);

  // 조회하고 결과를 담는다. 시작할 때의 `loading`은 호출한 쪽이 이미 맞춰 둔다.
  const load = async (run: number) => {
    let result: Result.Result<FolderResult, PlaceLookupError>;
    try {
      result = await startEffect(Effect.result(lookupFolder(shareId)));
    } catch (defect) {
      // 프로그램 오류. 화면에는 일시적인 실패로 보인다.
      console.error(defect);
      result = Result.fail(new PlaceLookupError({ code: 'UPSTREAM_ERROR' }));
    }
    if (runSeq.current !== run) return;
    setStatus(
      Result.isSuccess(result)
        ? {
            kind: 'ready',
            folderName: result.success.folderName,
            places: uniqueBySid(result.success.places),
          }
        : { kind: 'error', error: result.failure },
    );
  };

  // 마운트 때 한 번 조회한다(폴더가 바뀌면 호스트가 `key`로 새로 만든다).
  useEffect(() => {
    const seq = runSeq;
    void load(++seq.current);
    return () => {
      seq.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setStatus({ kind: 'loading' });
    void load(++runSeq.current);
  };

  if (status.kind === 'ready') {
    return <FolderList folderName={status.folderName} places={status.places} />;
  }
  const error = status.kind === 'error' ? status.error : null;
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, mb: 1 }}>
        네이버 폴더 가져오기
      </Typography>
      {error === null ? (
        <Typography role="status" variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          장소를 찾는 중…
        </Typography>
      ) : (
        <Typography role="alert" variant="body2" color="error">
          {error.userMessage}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button onClick={() => setFlow({ step: 'closed' })} sx={{ minHeight: 44 }}>
          취소
        </Button>
        {error !== null && RETRY_CODES.includes(error.code) && (
          <Button variant="outlined" onClick={retry} sx={{ minHeight: 44 }}>
            다시 시도
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * 조회가 끝난 미리보기. 머리글, 붙일 라벨(이름 입력 또는 기존 라벨), 장소 목록(체크박스), 가져오기.
 * 가져오기는 `LibraryStore.update` 한 번으로 최신본에 적용하고, 토스트 개수는 그 결과(`summary`)에서 센다.
 * `이미 있음` 표시는 화면에 보이는 보관함 기준의 안내일 뿐이다.
 * 여행 대상이 붙은 흐름이면 같은 연산에서 가져온 장소를 모두 그 여행의 후보에 넣고 계획 화면으로 간다
 * (폴더는 라벨이 붙으므로 늘 보관함에 저장한다).
 */
function FolderList({ folderName, places }: { folderName: string; places: FolderPlace[] }) {
  const library = useAtomValue(libraryAtom);
  const setFlow = useSetAtom(addFlowAtom);
  const { run } = useLibraryAction();
  const [, patchQuery] = useLibraryQuery();
  const { tripId, notify, backToTrip } = useTripTarget();
  const labels = useMemo(() => liveLabels(library), [library]);
  const existingSids = useMemo(
    () => new Set(planFolderImport(library, places).merge.map(({ item }) => item.sid)),
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
  const trimmed = name.trim();
  const nameTooLong = labelId === null && trimmed.length > LIBRARY_LIMITS.labelNameChars;
  const nameValid = labelId !== null || (trimmed.length > 0 && !nameTooLong);
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
      if (tripId === null) return imported;
      return thenAddCandidates(
        imported,
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
    // 방금 가져온 장소가 모두 보이도록 검색어·지역 필터도 비운다.
    patchQuery({ labelIds: [result.createdId!], unlabeled: false, text: '', regions: [] });
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
            sx={{ ...FIELD_SX, borderColor: nameTooLong ? 'error.main' : 'var(--tm-border)' }}
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
          existingSids={existingSids}
          onToggle={toggle}
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

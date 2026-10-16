import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect, Result } from 'effect';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { uniqueBySid } from 'src/domain/library/add-place';
import { liveFolderLink, unlinkFolder } from 'src/domain/library/folder-links';
import { startEffect } from 'src/lib/effect/runtime';
import type { FolderLink } from 'src/schema/library';
import type { FolderResult } from 'src/server/resolve';
import { FolderList } from 'src/sections/add-place/FolderList';
import { FolderResync } from 'src/sections/add-place/FolderResync';
import { RETRY_CODES, type FolderPlace } from 'src/sections/add-place/shared';
import { useStepRefocus } from 'src/sections/add-place/step-focus';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';
import { libraryAtom, useLibraryAction } from 'src/stores/library-state';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; error: PlaceLookupError }
  | {
      kind: 'ready';
      folderName: string;
      places: FolderPlace[];
      /** 읽기를 마친 순간 살아 있던 연결. 있으면(여행 대상이 없을 때) 다시 가져오기 화면을 보인다. */
      link: FolderLink | null;
    };

const lookupFolder = (shareId: string, fresh: boolean) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    return yield* lookup.lookupFolder(shareId, { fresh });
  });

/** 연결된 폴더를 찾지 못했을 때(공유를 껐거나 폴더를 지움). */
const LINKED_NOT_FOUND =
  '폴더를 찾지 못했어요. 네이버 지도에서 폴더 공유를 껐거나 폴더를 지웠을 수 있어요';

/**
 * 네이버 공유 폴더 미리보기(스펙 §2.3). 열릴 때 폴더를 조회하고, 오류는 문구와 함께 다시 시도(가능한 경우)·취소를 준다.
 * 창이 닫힌 뒤 온 조회 결과는 버린다.
 * 연결된 폴더(F3 §4.1)면 서버 캐시를 건너뛰어 읽고 다시 가져오기 화면(`FolderResync`)을 보인다.
 * 여행 계획 화면에서 연 흐름(여행 대상이 붙음)은 그 여행의 후보에 넣으려는 것이므로 늘 지금의 미리보기다.
 */
export function FolderPreview({ shareId }: { shareId: string }) {
  const setFlow = useSetAtom(addFlowAtom);
  const jotaiStore = useStore();
  const library = useAtomValue(libraryAtom);
  const target = useAtomValue(addTargetAtom);
  const { run: runLibrary } = useLibraryAction();
  // 열릴 때 한 번 정한다. 읽는 중·오류 문구와 `fresh` 조회가 이것을 따른다.
  const [linked] = useState(
    () => target === null && liveFolderLink(library, shareId) !== undefined,
  );
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [showAll, setShowAll] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  // 같은 이벤트 루프 안의 두 번째 클릭은 아직 `unlinking`을 못 본다.
  const unlinkingRef = useRef(false);
  // 실행 번호. 다시 조회하거나 창이 닫히면 올려서 지난 조회의 결과가 끼어들지 않게 한다.
  const runSeq = useRef(0);

  // 조회하고 결과를 담는다. 시작할 때의 `loading`은 호출한 쪽이 이미 맞춰 둔다.
  const load = async (run: number) => {
    let result: Result.Result<FolderResult, PlaceLookupError>;
    try {
      result = await startEffect(Effect.result(lookupFolder(shareId, linked)));
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
            // 이 순간의 최신 보관함으로 정한다. 뒤에 첫 가져오기가 연결을 만들어도 화면을 바꾸지 않는다.
            link: liveFolderLink(jotaiStore.get(libraryAtom), shareId) ?? null,
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

  // `찾는 중` 화면(포커스된 `취소`)이 목록으로 바뀌면 포커스가 빠지므로 목록의 첫 조작 요소로 옮긴다.
  useStepRefocus(status.kind === 'ready');
  // `폴더 전체 보기`를 누르면 그 단추가 사라지므로 지금의 미리보기의 첫 조작 요소로 옮긴다.
  useStepRefocus(showAll);

  const retry = () => {
    setStatus({ kind: 'loading' });
    void load(++runSeq.current);
  };

  // 연결만 끊는다(라벨과 장소는 그대로). 이미 끊겼어도 같은 문장으로 알리고 닫는다.
  const unlink = async () => {
    if (unlinkingRef.current) return;
    unlinkingRef.current = true;
    setUnlinking(true);
    const result = await runLibrary((lib, ctx) => unlinkFolder(lib, shareId, ctx));
    if (!result.ok) {
      // 저장소 오류는 앱 오류 보고자가 알린다.
      unlinkingRef.current = false;
      setUnlinking(false);
      return;
    }
    toast('폴더 연결을 끊었어요. 라벨과 장소는 그대로예요');
    setFlow({ step: 'closed' });
  };

  if (status.kind === 'ready') {
    // 연결은 최신 보관함의 것을 쓰고, 그사이 없어졌으면 읽을 때의 것으로 화면을 유지한다(누르면 알린다).
    const link = status.link === null ? null : (liveFolderLink(library, shareId) ?? status.link);
    if (link !== null && target === null && !showAll) {
      return (
        <FolderResync
          shareId={shareId}
          folderName={status.folderName}
          places={status.places}
          link={link}
          onShowAll={() => setShowAll(true)}
        />
      );
    }
    return <FolderList shareId={shareId} folderName={status.folderName} places={status.places} />;
  }
  const error = status.kind === 'error' ? status.error : null;
  const linkedNotFound = linked && error?.code === 'NOT_FOUND';
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800, mb: 1 }}>
        {linked ? '네이버 폴더 다시 가져오기' : '네이버 폴더 가져오기'}
      </Typography>
      {error === null ? (
        <Typography role="status" variant="body2" sx={{ color: 'var(--tm-text-secondary)' }}>
          {linked ? '새로 저장한 곳을 찾는 중…' : '장소를 찾는 중…'}
        </Typography>
      ) : (
        <Typography role="alert" variant="body2" color="error">
          {linkedNotFound ? LINKED_NOT_FOUND : error.userMessage}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button onClick={() => setFlow({ step: 'closed' })} sx={{ minHeight: 44 }}>
          취소
        </Button>
        {linkedNotFound && (
          <Button
            variant="outlined"
            disabled={unlinking}
            onClick={() => void unlink()}
            sx={{ minHeight: 44 }}
          >
            연결 끊기
          </Button>
        )}
        {error !== null && RETRY_CODES.includes(error.code) && (
          <Button variant="outlined" onClick={retry} sx={{ minHeight: 44 }}>
            다시 시도
          </Button>
        )}
      </Box>
    </Box>
  );
}

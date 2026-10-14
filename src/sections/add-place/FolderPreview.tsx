import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Effect, Result } from 'effect';
import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { uniqueBySid } from 'src/domain/library/add-place';
import { startEffect } from 'src/lib/effect/runtime';
import type { FolderResult } from 'src/server/resolve';
import { FolderList } from 'src/sections/add-place/FolderList';
import { RETRY_CODES, type FolderPlace } from 'src/sections/add-place/shared';
import { useStepRefocus } from 'src/sections/add-place/step-focus';
import { PlaceLookupError } from 'src/services/errors';
import { PlaceLookup } from 'src/services/place-lookup';
import { addFlowAtom } from 'src/stores/add-place';

type Status =
  | { kind: 'loading' }
  | { kind: 'error'; error: PlaceLookupError }
  | { kind: 'ready'; folderName: string; places: FolderPlace[] };

const lookupFolder = (shareId: string) =>
  Effect.gen(function* () {
    const lookup = yield* PlaceLookup;
    return yield* lookup.lookupFolder(shareId);
  });

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

  // `찾는 중` 화면(포커스된 `취소`)이 목록으로 바뀌면 포커스가 빠지므로 목록의 첫 조작 요소로 옮긴다.
  useStepRefocus(status.kind === 'ready');

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

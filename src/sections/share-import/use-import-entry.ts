import { useSetAtom, useStore } from 'jotai';
import { useEffect, useRef } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { readShareHash, SHARE_HASH_PREFIX, SHARE_READ_MESSAGES } from 'src/domain/share/read-share';
import { paths } from 'src/routes/paths';
import { addFlowAtom, addTargetAtom } from 'src/stores/add-place';

/**
 * `/import` 진입(스펙 §2.1). 모든 진입 길(＋ 시트·설정·보기 화면의 `Landmark에 담기` 링크)이 이 경로로 모인다.
 * 들어오면 해시를 먼저 읽고 주소를 바로 `/`(해시 없음)로 바꾼 뒤(`replace`라서 새로고침·뒤로 가기로 다시
 * 열리지 않는다) 흐름을 연다.
 * - 해시 `#d=…`: 해독해서 성공하면 미리보기(`share`), 실패하면 오류 토스트(보관함에 남는다).
 *   해독하는 사이 다른 흐름이 열렸다면(흐름 값이 바뀌었다면) 결과를 버린다.
 * - 해시 없음: 파일 고르기(`share-pick`).
 * 셸(`AppShell`)이 한 번 부른다.
 */
export function useImportEntry(): void {
  const { pathname, hash, key } = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const setFlow = useSetAtom(addFlowAtom);
  const setTarget = useSetAtom(addTargetAtom);
  // 같은 진입을 두 번 처리하지 않는다(개발 모드의 효과 두 번 실행).
  const handledKey = useRef<string | null>(null);

  const entering = matchPath(paths.importShare, pathname) !== null;
  useEffect(() => {
    if (!entering || handledKey.current === key) return;
    handledKey.current = key;
    void navigate(paths.library, { replace: true });
    setTarget(null);
    if (!hash.startsWith(SHARE_HASH_PREFIX)) {
      setFlow({ step: 'share-pick' });
      return;
    }
    const before = store.get(addFlowAtom);
    void readShareHash(hash.slice(SHARE_HASH_PREFIX.length)).then((result) => {
      if (store.get(addFlowAtom) !== before) return;
      if (result.ok) setFlow({ step: 'share', doc: result.doc });
      else toast(SHARE_READ_MESSAGES[result.error]);
    });
  }, [entering, hash, key, navigate, setFlow, setTarget, store]);
}

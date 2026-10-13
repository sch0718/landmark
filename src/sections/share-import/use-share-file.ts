import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { readShareFile, SHARE_READ_MESSAGES } from 'src/domain/share/read-share';
import { addFlowAtom } from 'src/stores/add-place';

/**
 * 고른(끌어 놓은) 공유 파일을 읽는다. 성공하면 흐름을 미리보기(`share`)로 옮기고,
 * 실패하면 `error`에 오류 문구(스펙 §2.5)를 담는다. 새로 읽기 시작하면 이전 오류는 지운다.
 * 읽는 사이 칸이 닫혔으면(언마운트) 늦은 결과는 버린다.
 */
export function useShareFile(): {
  read(file: File): Promise<void>;
  reading: boolean;
  error: string | null;
} {
  const setFlow = useSetAtom(addFlowAtom);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 읽기 번호. 새로 읽거나 칸이 닫히면 올려서 지난 읽기의 결과가 끼어들지 않게 한다.
  const seq = useRef(0);
  useEffect(() => {
    const ref = seq;
    return () => {
      ref.current += 1;
    };
  }, []);

  const read = async (file: File) => {
    const run = ++seq.current;
    setError(null);
    setReading(true);
    const result = await readShareFile(file);
    if (seq.current !== run) return;
    setReading(false);
    if (result.ok) setFlow({ step: 'share', doc: result.doc });
    else setError(SHARE_READ_MESSAGES[result.error]);
  };

  return { read, reading, error };
}

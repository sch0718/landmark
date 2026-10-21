import { useEffect, useMemo, useState } from 'react';
import type { ShareDoc } from 'src/schema/share';
import { appUrl, viewLink, type ImportLink } from 'src/share-viewer/encode';
import type { ShareFileOptions } from './ShareFileDialog';

/** 사용자 동작 직후 공유할 수 있도록 압축을 미리 끝낸다. 바뀐 입력의 옛 결과는 사용하지 않는다. */
export function useShareLink(
  enabled: boolean,
  title: string,
  includeMemo: boolean,
  makeDoc: ((opts: ShareFileOptions) => ShareDoc | null) | undefined,
): ImportLink | null {
  const input = useMemo(
    () => ({ enabled, title, includeMemo, makeDoc }),
    [enabled, title, includeMemo, makeDoc],
  );
  const [result, setResult] = useState<{ input: typeof input; link: ImportLink } | null>(null);
  useEffect(() => {
    const buildDoc = input.makeDoc;
    if (!input.enabled || buildDoc === undefined) return;
    let stale = false;
    void (async () => {
      let link: ImportLink = { kind: 'unsupported' };
      try {
        const doc = buildDoc({
          title: input.title,
          includeMemo: input.includeMemo,
          now: new Date(),
        });
        if (doc !== null) {
          const app = appUrl(
            import.meta.env.VITE_APP_URL ||
              (import.meta.env.DEV ? window.location.origin : undefined),
          );
          link = await viewLink(doc, app);
        }
      } catch {
        // 파일 생성 버튼에서 기존 오류 안내를 제공한다.
      }
      if (!stale) setResult({ input, link });
    })();
    return () => {
      stale = true;
    };
  }, [input]);
  return result?.input === input ? result.link : null;
}

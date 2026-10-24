import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { HelpIntroDialog } from 'src/routes/lazy-routes';
import { helpSeen } from 'src/services/help-seen';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
import type { HelpPageId } from './help-content';
import { introIdForPath } from './help-routing';

/** MUI의 포털도 확인한다. 추가 흐름처럼 모달이 아닌 칸은 셸이 blocked로 넘긴다. */
function otherDialogOpen(): boolean {
  return [
    ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'),
  ].some((dialog) => dialog.closest('[data-dialog-kind="help-intro"]') === null);
}

/** 문구와 그림은 여기서 읽지 않는다. 필요한 메뉴 하나만 대화상자 청크를 통해 받는다. */
export function HelpIntroHost({ blocked }: { blocked: boolean }) {
  const { pathname } = useLocation();
  const [pageId, setPageId] = useState<HelpPageId | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => {
      if (!live) return;
      setPageId(introIdForPath(pathname, helpSeen.read(), blocked || otherDialogOpen()));
    };
    // 같은 커밋에서 열린 포털·시트를 확인한 뒤 결정한다.
    queueMicrotask(check);
    if (introIdForPath(pathname, helpSeen.read(), blocked) === null) {
      return () => {
        live = false;
      };
    }
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [pathname, blocked]);

  const close = () => {
    if (pageId !== null) helpSeen.mark(pageId);
    setPageId(null);
  };
  const open = pageId !== null && introIdForPath(pathname, helpSeen.read(), blocked) === pageId;
  return pageId === null ? null : (
    <LazyDialogHost open={open} onClose={close} heading="처음 안내" dialogKind="help-intro">
      <HelpIntroDialog pageId={pageId} open={open} onClose={close} />
    </LazyDialogHost>
  );
}

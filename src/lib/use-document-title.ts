import { useEffect } from 'react';

const APP_NAME = '랜드마크';

/**
 * 탭 제목을 `<화면> · 랜드마크`로 둔다. `null`이면 앱 이름만 쓴다(찾지 못한 장소·여행).
 * 언마운트 때 되돌리지 않는다: 다음 화면이 자기 제목을 정한다.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title === null ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [title]);
}

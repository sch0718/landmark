import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { paths } from 'src/routes/paths';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';
import { sheetLocationState, sheetStateOf, type SheetFrom } from 'src/sections/shell/sheet-state';
import { useLayout } from 'src/sections/shell/use-layout';

/**
 * 장소 상세를 연다(목록·지도·추가 카드 공통). 휴대폰에서 이미 상세가 열려 있으면 기록을 바꿔치기해서 마커를 몇 번
 * 눌러도 뒤로 가기 한 번이면 시트가 닫히게 한다(스펙 §4.4). 처음 열 때는 기록을 쌓고, 지도에서 열면 반쯤·목록에서
 * 열면 다 펼친 시트로 연다. 중간·넓은 화면은 늘 기록을 쌓는다.
 */
export function useOpenPlace(): (id: string, from: SheetFrom) => void {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const compact = useLayout() === 'compact';
  return useCallback(
    (id: string, from: SheetFrom) => {
      if (compact && matchPath(paths.place(':id'), pathname) !== null) {
        void navigate(paths.place(id), {
          replace: true,
          state: sheetLocationState(sheetStateOf(state)),
        });
        return;
      }
      const snap: SheetSnap = from === 'map' ? 'half' : 'full';
      void navigate(paths.place(id), {
        state: sheetLocationState({ from, snap, inApp: true }),
      });
    },
    [compact, navigate, pathname, state],
  );
}

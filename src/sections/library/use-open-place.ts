import { useCallback } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router';
import { paths } from 'src/routes/paths';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';
import { useLayout } from 'src/sections/shell/use-layout';

/** 휴대폰 상세 시트 뒤에 깔리는 화면. */
export type SheetFrom = 'map' | 'list';

/**
 * 휴대폰 상세 시트의 상태(스펙 §4.4). 기록 상태(`location.state.sheet`)에 두어 새로고침에도 남는다.
 * `inApp`은 앱 안에서 연 기록인가다. 닫을 때 뒤로 갈지(앱 안) 뒤 화면으로 바꿔치기할지(링크로 바로 들어옴)를 정한다.
 */
export type SheetState = { from: SheetFrom; snap: SheetSnap; inApp: boolean };

/** 상태 없이 `/place/:id`에 들어왔을 때: 장소가 보이도록 지도 위 반쯤. */
const DIRECT: SheetState = { from: 'map', snap: 'half', inApp: false };

export function sheetStateOf(state: unknown): SheetState {
  if (typeof state !== 'object' || state === null || !('sheet' in state)) return DIRECT;
  const sheet = state.sheet;
  if (typeof sheet !== 'object' || sheet === null) return DIRECT;
  const { from, snap, inApp } = sheet as Record<string, unknown>;
  if (from !== 'map' && from !== 'list') return DIRECT;
  if (snap !== 'half' && snap !== 'full') return DIRECT;
  if (typeof inApp !== 'boolean') return DIRECT;
  return { from, snap, inApp };
}

export function sheetLocationState(sheet: SheetState): { sheet: SheetState } {
  return { sheet };
}

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

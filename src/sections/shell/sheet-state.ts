import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { paths } from 'src/routes/paths';
import type { SheetSnap } from 'src/sections/shell/sheet-snap';

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
 * 휴대폰 상세 시트를 닫는다(시트의 `닫기`·끌어 내리기·Esc, 시트 뒤 화면의 하단 탭). 시트를 연 기록을 되감아 모바일
 * 뒤로 가기와 어긋나지 않게 한다. 앱 안에서 연 기록이 아니면(링크로 바로 들어옴) 앱을 벗어나지 않도록 뒤 화면으로
 * 바꿔치기한다. 펼치기·접기가 기록 항목을 바꿔치기해 `location.key`가 바뀌므로 키 대신 `inApp`으로 판단한다.
 */
export function useCloseSheet(): () => void {
  const navigate = useNavigate();
  const { state } = useLocation();
  return useCallback(() => {
    const current = sheetStateOf(state);
    if (current.inApp) void navigate(-1);
    else void navigate(current.from === 'map' ? paths.map : paths.library, { replace: true });
  }, [navigate, state]);
}

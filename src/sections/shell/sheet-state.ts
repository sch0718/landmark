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

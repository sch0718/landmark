import { atom, type PrimitiveAtom } from 'jotai';
export type SyncPhase =
  | 'off'
  | 'pending-choice'
  | 'local'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'auth'
  | 'not-allowed'
  | 'unavailable'
  | 'error';
export type SyncStatus = {
  phase: SyncPhase;
  dirty: number;
  conflicts: number;
  held: number;
  rejected: number;
  offline: boolean;
  lastSyncAt: string | null;
  progress: { step: 'pull' | 'push'; done: number; total: number } | null;
  message: string | null;
};
export const OFF_STATUS: SyncStatus = {
  phase: 'off',
  dirty: 0,
  conflicts: 0,
  held: 0,
  rejected: 0,
  offline: false,
  lastSyncAt: null,
  progress: null,
  message: null,
};
export const syncStatusAtom: PrimitiveAtom<SyncStatus> = atom(OFF_STATUS);
export function syncPhaseText(phase: SyncPhase): string {
  return {
    off: '꺼짐',
    'pending-choice': '연결 방식을 골라 주세요',
    local: '이 기기에 저장됨',
    syncing: '동기화 중',
    synced: '동기화 완료',
    conflict: '확인 필요한 충돌',
    auth: '다시 로그인해 주세요',
    'not-allowed': '이 계정은 쓸 수 없어요',
    unavailable: '지금은 동기화를 쓸 수 없어요',
    error: '동기화를 멈췄어요',
  }[phase];
}

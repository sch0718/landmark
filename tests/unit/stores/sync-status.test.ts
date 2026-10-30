import { expect, it } from 'vitest';
import { syncPhaseText } from 'src/stores/sync-status';
it('핵심 상태 문구를 표시한다', () => {
  expect(
    ['local', 'syncing', 'synced', 'conflict'].map((p) => syncPhaseText(p as 'local')),
  ).toEqual(['이 기기에 저장됨', '동기화 중', '동기화 완료', '확인 필요한 충돌']);
});

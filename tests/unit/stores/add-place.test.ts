import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { addFlowAtom, addFlowStepKey, openFolderSyncAtom } from 'src/stores/add-place';

describe('openFolderSyncAtom', () => {
  it('같은 폴더로 두 번 열어도 단계 키가 달라 화면을 새로 만든다', () => {
    const store = createStore();
    store.set(openFolderSyncAtom, 'abc123', null);
    const first = addFlowStepKey(store.get(addFlowAtom));
    store.set(openFolderSyncAtom, 'abc123', null);
    const second = addFlowStepKey(store.get(addFlowAtom));
    expect(first).not.toBe(second);
  });

  it('링크 붙여넣기로 연 폴더 단계는 공유 ID만으로 키를 만든다', () => {
    expect(addFlowStepKey({ step: 'folder', shareId: 'abc123' })).toBe('folder-abc123');
  });
});

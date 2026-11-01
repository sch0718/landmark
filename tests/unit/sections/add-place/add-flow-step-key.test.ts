import { expect, it } from 'vitest';
import { addFlowStepKey } from 'src/stores/add-place';
import { SHARE_DOC } from '../share-import/share-fixtures';

it('받은함 항목마다 공유 미리보기 키를 다르게 만들어요', () => {
  const flow = { step: 'share' as const, doc: SHARE_DOC };
  const inbox = { id: 'inbox00000000001', from: null, owner: 'owner-a' };
  expect(addFlowStepKey({ ...flow, inbox })).toBe(`share-inbox-${inbox.id}`);
  expect(addFlowStepKey({ ...flow, inbox: { ...inbox, id: 'inbox00000000002' } })).not.toBe(
    addFlowStepKey({ ...flow, inbox }),
  );
});

it('받은함이 없는 공유 미리보기 키는 share로 유지해요', () => {
  expect(addFlowStepKey({ step: 'share', doc: SHARE_DOC })).toBe('share');
});

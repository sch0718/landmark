import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { expect, it } from 'vitest';
import { RecommendCards } from 'src/sections/recommend/RecommendCards';
import type { Recommendation } from 'src/services/recommend/api';
import { recommendationsAtom, recommendPrefsAtom } from 'src/stores/recommend';
import { SHARE_DOC } from '../share-import/share-fixtures';

const rec: Recommendation = {
  id: 'label001',
  title: '가을 단풍',
  description: '',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  places: SHARE_DOC.places.length,
  updatedAt: 1,
  doc: { ...SHARE_DOC, version: 1 },
};

it('일부만 숨긴 추천을 복원하면 첫 카드에 포커스를 둔다', async () => {
  const user = userEvent.setup();
  const store = createStore();
  store.set(recommendationsAtom, [rec, { ...rec, id: 'label002', title: '겨울 바다' }]);
  store.set(recommendPrefsAtom, {
    hidden: ['label001'],
    mapOff: true,
  });
  render(
    <Provider store={store}>
      <RecommendCards />
    </Provider>,
  );
  const restore = screen.getByRole('button', { name: '숨긴 추천 다시 보기' });
  expect(restore.closest('section[aria-label="추천"]')).toBeNull();
  expect(screen.getByRole('region', { name: '추천' })).toBeVisible();

  await user.click(restore);

  const section = screen.getByRole('region', { name: '추천' });
  expect(within(section).getByRole('button', { name: /^가을 단풍.*2곳/ })).toHaveFocus();
  expect(within(section).getByRole('button', { name: /^겨울 바다.*2곳/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: '숨긴 추천 다시 보기' })).toBeNull();
});

it('현재 목록에 없는 id만 숨겼으면 복원 단추와 추천 영역을 보이지 않는다', () => {
  const store = createStore();
  store.set(recommendationsAtom, []);
  store.set(recommendPrefsAtom, { hidden: ['oldlabel'], mapOff: false });
  const { container } = render(
    <Provider store={store}>
      <RecommendCards />
    </Provider>,
  );
  expect(container).toBeEmptyDOMElement();
});

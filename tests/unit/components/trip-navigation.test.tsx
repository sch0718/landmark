import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { expect, it } from 'vitest';
import { TripNavigation } from 'src/sections/views/view/TripNavigation';
import { itineraryEditingAtom, stopDraftsAtom } from 'src/sections/views/store/view-session';
import { viewModeAtom } from 'src/stores/ui-store';

it('같은 Provider에서 세 모드를 전환하고 선택 상태를 표시한다', async () => {
  const store = createStore();
  render(
    <Provider store={store}>
      <TripNavigation orientation="horizontal" />
    </Provider>,
  );

  expect(store.get(viewModeAtom)).toBe('map');
  const mapButton = screen.getByRole('button', { name: /^지도$/ });
  expect(mapButton).toHaveAttribute('aria-pressed', 'true');
  expect(mapButton.querySelector('svg')).toHaveAttribute('width', '22');
  expect(mapButton.querySelector('svg')).toHaveAttribute('height', '22');
  expect(mapButton.querySelector('path')).toHaveAttribute('fill', 'currentColor');
  expect(mapButton.querySelector('path')).toHaveAttribute('d');

  act(() => {
    store.set(itineraryEditingAtom, true);
    store.set(stopDraftsAtom, { a000: { date: '2026-11-14', time: '', note: '초안' } });
  });
  await userEvent.click(mapButton);
  expect(store.get(itineraryEditingAtom)).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: /^일정$/ }));
  expect(store.get(itineraryEditingAtom)).toBe(false);
  expect(store.get(stopDraftsAtom).a000?.note).toBe('초안');
  expect(store.get(viewModeAtom)).toBe('day');
  expect(screen.getByRole('button', { name: /^일정$/ })).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: /^장소$/ }));
  expect(store.get(viewModeAtom)).toBe('places');
  expect(screen.getByRole('button', { name: /^장소$/ })).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(screen.getByRole('button', { name: /^지도$/ }));
  expect(store.get(viewModeAtom)).toBe('map');
});

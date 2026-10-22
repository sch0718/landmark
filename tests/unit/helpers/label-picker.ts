import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * `scope` 안의 `라벨 바꾸기`를 눌러 라벨 고르기 창을 열고 그 창을 돌려준다.
 * 나눠 받는 동안에는 같은 제목의 기다림 틀이 먼저 뜨므로, 검색 칸이 보일 때까지 기다린 뒤 진짜 창을 집는다.
 */
export async function openLabelPicker(user: UserEvent, scope: HTMLElement): Promise<HTMLElement> {
  await user.click(within(scope).getByRole('button', { name: '라벨 바꾸기' }));
  await screen.findByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });
  return screen.getByRole('dialog', { name: '라벨 바꾸기' });
}

/** `완료`로 라벨 고르기 창을 닫고, 창이 사라질 때까지 기다린다. */
export async function closeLabelPicker(user: UserEvent, dialog: HTMLElement): Promise<void> {
  await user.click(within(dialog).getByRole('button', { name: '완료' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

/** 창 안의 검색 칸. */
export const pickerSearch = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('searchbox', { name: '라벨 검색 또는 새 라벨 이름' });

/** 창 안의 라벨 체크박스(이름 앞부분으로 찾는다 — 접근 이름 끝에 `N곳`이 붙는다). */
export const pickerBox = (dialog: HTMLElement, name: string): HTMLElement =>
  within(dialog).getByRole('checkbox', { name: new RegExp(`^${name} \\d+곳$`) });

/** 라벨 칸에 붙은 라벨 이름들. 장식 이모지 글자는 제외한다. */
export const attachedNames = (scope: HTMLElement): string[] => {
  const list = within(scope).queryByRole('list', { name: '붙은 라벨' });
  return list === null
    ? []
    : within(list)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[data-truncated-text]')?.textContent ?? '');
};

/** 창을 열어 이름이 `name`으로 시작하는 라벨 하나를 켜거나 끄고 창을 닫는다. */
export async function toggleLabel(
  user: UserEvent,
  scope: HTMLElement,
  name: string,
): Promise<void> {
  const dialog = await openLabelPicker(user, scope);
  await user.click(pickerBox(dialog, name));
  await closeLabelPicker(user, dialog);
}

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { paths } from 'src/routes/paths';
import {
  loadMeetingsPage,
  loadMeetingEditorPage,
  loadMeetLinkPage,
  ROUTE_CHUNKS,
} from 'src/routes/lazy-routes';
import { renderApp } from '../sections/shell/harness';
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));
vi.mock('src/lib/prefetch', () => ({ prefetchWhenIdle: vi.fn() }));
vi.mock('src/sections/meetings/MeetingEditorPage', () => ({
  MeetingEditorPage: () => <h1>약속 편집</h1>,
}));
vi.mock('src/sections/meetings/MeetLinkPage', () => ({ MeetLinkPage: () => <h1>약속 링크</h1> }));
afterEach(() => {
  cleanup();
  setAppRuntimeForTest(null);
});
describe('약속 경로', () => {
  it('세 화면을 지연 로딩 목록에 넣는다', () => {
    expect(paths.meetings).toBe('/meetings');
    expect(paths.meeting('meeting001')).toBe('/meetings/meeting001');
    expect(paths.meet).toBe('/meet');
    for (const load of [loadMeetingsPage, loadMeetingEditorPage, loadMeetLinkPage])
      expect(ROUTE_CHUNKS).toContain(load);
  });
  it.each([
    ['/meetings', '약속'],
    ['/meetings/meeting001', '약속 편집'],
    ['/meet#d=test', '약속 링크'],
  ])('%s를 셸 안에 그린다', async (path, heading) => {
    await act(async () => {
      await renderApp({ path });
    });
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '하단 메뉴' })).toBeInTheDocument();
  });
});

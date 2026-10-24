import { describe, expect, it } from 'vitest';
import { helpIdForPath, introIdForPath } from 'src/sections/help/help-routing';
import { isNavActive, NAV_ITEMS } from 'src/sections/shell/nav-items';

describe('화면별 도움말', () => {
  it.each([
    ['/', 'library'],
    ['/map/', 'map'],
    ['/place/abc', 'place'],
    ['/labels', 'labels'],
    ['/trips/abc/today', 'trips'],
    ['/meetings/abc', 'meetings'],
    ['/meet', 'meetings'],
    ['/settings', 'settings'],
    ['/help/map', null],
    ['/unknown', null],
    ['/trips-other', null],
  ])('%s 화면의 도움말은 %s', (path, id) => expect(helpIdForPath(path)).toBe(id));

  it.each(['/', '/map', '/trips', '/meetings', '/labels'])('처음 쓰는 %s에서 안내한다', (path) => {
    expect(introIdForPath(path, new Set(), false)).not.toBeNull();
  });
  it.each([
    '/place/a',
    '/settings',
    '/meet',
    '/view',
    '/import',
    '/t/a',
    '/trips/a',
    '/meetings/a',
    '/help',
  ])('%s에서는 처음 안내하지 않는다', (path) => {
    expect(introIdForPath(path, new Set(), false)).toBeNull();
  });
  it('이미 본 메뉴나 다른 창이 열린 동안은 안내하지 않는다', () => {
    expect(introIdForPath('/', new Set(['library']), false)).toBeNull();
    expect(introIdForPath('/', new Set(), true)).toBeNull();
  });
  it('도움말은 설정 탭에 속한다', () => {
    for (const item of NAV_ITEMS) {
      if (item === 'add') continue;
      expect(isNavActive(item, '/help/map')).toBe(item.key === 'settings');
    }
  });
});

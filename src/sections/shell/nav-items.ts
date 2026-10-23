import type { ComponentType, SVGProps } from 'react';
import { HomeIcon, MapIcon, RouteIcon, MeetingIcon, SettingsIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import type { SheetFrom } from 'src/sections/shell/sheet-state';

export type NavLinkItem = {
  key: 'library' | 'map' | 'trips' | 'meetings' | 'settings';
  label: string;
  to: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

/** 내비게이션 순서. 가운데 `'add'`는 추가 시트를 여는 ＋ 버튼이다. 레일과 하단 탭이 같이 쓴다. */
export const NAV_ITEMS: readonly (NavLinkItem | 'add')[] = [
  { key: 'library', label: '보관함', to: paths.library, Icon: HomeIcon },
  { key: 'map', label: '지도', to: paths.map, Icon: MapIcon },
  'add',
  { key: 'trips', label: '여행', to: paths.trips, Icon: RouteIcon },
  { key: 'meetings', label: '약속', to: paths.meetings, Icon: MeetingIcon },
  { key: 'settings', label: '설정', to: paths.settings, Icon: SettingsIcon },
];

/**
 * 장소 상세(`/place/:id`)는 보관함의 일부라 보관함 항목이 켜져 있다. 다만 휴대폰에서 시트 뒤가 지도면
 * (`placeOn` = `'map'`) 지도 항목이 켜져 있다.
 */
export function isNavActive(
  item: NavLinkItem,
  pathname: string,
  placeOn: SheetFrom = 'list',
): boolean {
  if (pathname.startsWith(`${paths.place('')}`)) {
    return item.key === (placeOn === 'map' ? 'map' : 'library');
  }
  if (pathname === paths.meet) return item.key === 'meetings';
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export const ADD_LABEL = '장소 추가';

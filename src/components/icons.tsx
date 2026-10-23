import HomeIcon from '~icons/lucide/house';
import MapIcon from '~icons/lucide/map';
import RouteIcon from '~icons/lucide/route';
import MeetingIcon from '~icons/lucide/users-round';
import PlusIcon from '~icons/lucide/plus';
import MinusIcon from '~icons/lucide/minus';
import LocateFixedIcon from '~icons/lucide/locate-fixed';
import LayersIcon from '~icons/lucide/layers';
import SettingsIcon from '~icons/lucide/settings';
import SearchIcon from '~icons/lucide/search';
import LinkIcon from '~icons/lucide/link';
import MapPinIcon from '~icons/lucide/map-pin';
import FolderInputIcon from '~icons/lucide/folder-input';
import TagsIcon from '~icons/lucide/tags';
import TrashIcon from '~icons/lucide/trash-2';
import UndoIcon from '~icons/lucide/undo-2';
import GripIcon from '~icons/lucide/grip-vertical';
import EllipsisIcon from '~icons/lucide/ellipsis';
import ExternalLinkIcon from '~icons/lucide/external-link';
import NavigationIcon from '~icons/lucide/navigation';
import PencilIcon from '~icons/lucide/pencil';
import XIcon from '~icons/lucide/x';
import CheckIcon from '~icons/lucide/check';
import ChevronLeftIcon from '~icons/lucide/chevron-left';
import ChevronUpIcon from '~icons/lucide/chevron-up';
import ChevronDownIcon from '~icons/lucide/chevron-down';
import LayoutDashboardIcon from '~icons/lucide/layout-dashboard';
import RowsIcon from '~icons/lucide/rows-3';
import LayoutGridIcon from '~icons/lucide/layout-grid';
import ListIcon from '~icons/lucide/list';
import SunIcon from '~icons/lucide/sun';
import MoonIcon from '~icons/lucide/moon';
import MonitorIcon from '~icons/lucide/monitor';
import ShareIcon from '~icons/lucide/share-2';
import LockIcon from '~icons/lucide/lock';
import PanelLeftCloseIcon from '~icons/lucide/panel-left-close';
import PanelLeftOpenIcon from '~icons/lucide/panel-left-open';
import AlertIcon from '~icons/lucide/triangle-alert';

import BedIcon from '~icons/lucide/bed';
import CarIcon from '~icons/lucide/car';
import FootprintsIcon from '~icons/lucide/footprints';

export {
  HomeIcon,
  BedIcon,
  CarIcon,
  FootprintsIcon,
  MapIcon,
  RouteIcon,
  MeetingIcon,
  PlusIcon,
  MinusIcon,
  LocateFixedIcon,
  LayersIcon,
  SettingsIcon,
  SearchIcon,
  LinkIcon,
  MapPinIcon,
  FolderInputIcon,
  TagsIcon,
  TrashIcon,
  UndoIcon,
  GripIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  NavigationIcon,
  PencilIcon,
  XIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  LayoutDashboardIcon,
  RowsIcon,
  LayoutGridIcon,
  ListIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  ShareIcon,
  LockIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  AlertIcon,
};

/** 라벨 이모지. 없으면 표시하지 않는다. 장식이라 스크린리더는 건너뛴다. */
export function LabelGlyph({ emoji, size }: { emoji?: string | null; size?: number }) {
  if (!emoji) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size === undefined ? '1em' : size,
        lineHeight: 1,
        width: '1em',
        height: '1em',
        fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      }}
    >
      {emoji}
    </span>
  );
}

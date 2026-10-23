import type { ComponentType, SVGProps } from 'react';
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

// 라벨 아이콘 허용 목록(`LABEL_ICONS`). 번들러가 정적으로 찾도록 하나씩 import한다.
import UtensilsGlyph from '~icons/lucide/utensils';
import SoupGlyph from '~icons/lucide/soup';
import CoffeeGlyph from '~icons/lucide/coffee';
import CroissantGlyph from '~icons/lucide/croissant';
import BeerGlyph from '~icons/lucide/beer';
import WineGlyph from '~icons/lucide/wine';
import IceCreamConeGlyph from '~icons/lucide/ice-cream-cone';
import FishGlyph from '~icons/lucide/fish';
import BeefGlyph from '~icons/lucide/beef';
import SaladGlyph from '~icons/lucide/salad';
import WavesGlyph from '~icons/lucide/waves';
import MountainGlyph from '~icons/lucide/mountain';
import TreesGlyph from '~icons/lucide/trees';
import TentGlyph from '~icons/lucide/tent';
import CameraGlyph from '~icons/lucide/camera';
import LandmarkGlyph from '~icons/lucide/landmark';
import CastleGlyph from '~icons/lucide/castle';
import ChurchGlyph from '~icons/lucide/church';
import ShoppingBagGlyph from '~icons/lucide/shopping-bag';
import StoreGlyph from '~icons/lucide/store';
import BedGlyph from '~icons/lucide/bed';
import HotelGlyph from '~icons/lucide/hotel';
import CarGlyph from '~icons/lucide/car';
import TrainFrontGlyph from '~icons/lucide/train-front';
import FootprintsGlyph from '~icons/lucide/footprints';
import BabyGlyph from '~icons/lucide/baby';
import DogGlyph from '~icons/lucide/dog';
import MusicGlyph from '~icons/lucide/music';
import PaletteGlyph from '~icons/lucide/palette';
import StarGlyph from '~icons/lucide/star';
import HeartGlyph from '~icons/lucide/heart';
import FlagGlyph from '~icons/lucide/flag';
import type { LabelIcon } from 'src/schema/library';

export {
  HomeIcon,
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

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** `Record<LabelIcon, …>`라서 허용 목록에 이름이 늘면 여기서 컴파일 오류가 난다. */
const LABEL_GLYPHS: Record<LabelIcon, IconComponent> = {
  utensils: UtensilsGlyph,
  soup: SoupGlyph,
  coffee: CoffeeGlyph,
  croissant: CroissantGlyph,
  beer: BeerGlyph,
  wine: WineGlyph,
  'ice-cream-cone': IceCreamConeGlyph,
  fish: FishGlyph,
  beef: BeefGlyph,
  salad: SaladGlyph,
  waves: WavesGlyph,
  mountain: MountainGlyph,
  trees: TreesGlyph,
  tent: TentGlyph,
  camera: CameraGlyph,
  landmark: LandmarkGlyph,
  castle: CastleGlyph,
  church: ChurchGlyph,
  'shopping-bag': ShoppingBagGlyph,
  store: StoreGlyph,
  bed: BedGlyph,
  hotel: HotelGlyph,
  car: CarGlyph,
  'train-front': TrainFrontGlyph,
  footprints: FootprintsGlyph,
  baby: BabyGlyph,
  dog: DogGlyph,
  music: MusicGlyph,
  palette: PaletteGlyph,
  star: StarGlyph,
  heart: HeartGlyph,
  flag: FlagGlyph,
};

/** 라벨 이모지·아이콘. 글자 크기(1em)를 따르고 `size`(px)로 바꿀 수 있다. 장식이라 스크린리더는 건너뛴다. */
export function LabelGlyph({
  name,
  emoji,
  size,
}: {
  name: LabelIcon;
  emoji?: string | null;
  size?: number;
}) {
  if (emoji) {
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
  const Glyph = LABEL_GLYPHS[name];
  return (
    <Glyph aria-hidden="true" {...(size === undefined ? {} : { width: size, height: size })} />
  );
}

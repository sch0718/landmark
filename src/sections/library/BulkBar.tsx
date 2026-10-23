import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  CheckIcon,
  LabelGlyph,
  RouteIcon,
  ShareIcon,
  TagsIcon,
  TrashIcon,
  XIcon,
} from 'src/components/icons';
import type { Label } from 'src/schema/library';
import { labelColors } from 'src/sections/library/label-style';

type Props = {
  count: number;
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨). */
  labels: Label[];
  /** 뗄 수 있는 라벨(선택한 장소 중 하나라도 가진 라벨). */
  attached: Label[];
  onAdd(labelId: string): void;
  onRemove(labelId: string): void;
  onDelete(): void;
  /** 고른 장소로 내보내기 창을 연다. */
  onExport(): void;
  /** 고른 장소를 넣을 여행 고르기 창을 연다. */
  onAddToTrip(): void;
  /** 고른 곳 중 다녀온 곳 수. 0이면 `다녀옴 표시 지우기`는 비활성이다. */
  visitedCount: number;
  onMarkVisited(): void;
  onClearVisited(): void;
  onClear(): void;
};

const BUTTON_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  minHeight: 44,
  px: 1.25,
  border: 0,
  borderRadius: 'var(--tm-radius-md)',
  background: 'transparent',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  color: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  '&:disabled': { opacity: 0.45, cursor: 'default' },
  '&:focus-visible': { outline: '2px solid var(--tm-accent-contrast)', outlineOffset: -2 },
  '& svg': { width: 18, height: 18 },
} as const;

function LabelMenu({
  anchor,
  onClose,
  labels,
  empty,
  onPick,
}: {
  anchor: HTMLElement | null;
  onClose(): void;
  labels: Label[];
  empty: string;
  onPick(id: string): void;
}) {
  return (
    <Menu anchorEl={anchor} open={anchor !== null} onClose={onClose}>
      {labels.length === 0 && (
        <MenuItem disabled sx={{ minHeight: 44 }}>
          {empty}
        </MenuItem>
      )}
      {labels.map((label) => (
        <MenuItem
          key={label.id}
          sx={{ minHeight: 44, gap: 1 }}
          onClick={() => {
            onPick(label.id);
            onClose();
          }}
        >
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              flexShrink: 0,
              width: 16,
              height: 16,
              color: labelColors(label.color.value).marker,
            }}
          >
            <LabelGlyph emoji={label.emoji?.value} size={16} />
          </Box>
          {label.name.value}
        </MenuItem>
      ))}
    </Menu>
  );
}

function BarButton({
  onClick,
  disabled,
  children,
  ...rest
}: {
  onClick(event: MouseEvent<HTMLElement>): void;
  disabled?: boolean;
  children: ReactNode;
  'aria-haspopup'?: 'menu';
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      sx={BUTTON_SX}
      {...rest}
    >
      {children}
    </Box>
  );
}

/** 선택 모드의 하단 바: 선택 수와 라벨 붙이기·떼기·여행에 넣기·내보내기·삭제. */
export function BulkBar({
  count,
  labels,
  attached,
  onAdd,
  onRemove,
  onDelete,
  onExport,
  onAddToTrip,
  visitedCount,
  onMarkVisited,
  onClearVisited,
  onClear,
}: Props) {
  const [menu, setMenu] = useState<{
    kind: 'add' | 'remove' | 'visit';
    anchor: HTMLElement;
  } | null>(null);
  return (
    <Box
      role="toolbar"
      aria-label="일괄 편집"
      sx={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.5,
        px: 1,
        py: 0.5,
        bgcolor: 'var(--tm-accent-main)',
        color: 'var(--tm-accent-contrast)',
      }}
    >
      <Box component="span" role="status" sx={{ px: 1, fontWeight: 800, whiteSpace: 'nowrap' }}>
        {count}곳 선택
      </Box>
      <Box sx={{ flex: 1 }} />
      <BarButton
        aria-haspopup="menu"
        onClick={(event) => setMenu({ kind: 'add', anchor: event.currentTarget })}
      >
        <TagsIcon aria-hidden="true" />
        라벨 붙이기
      </BarButton>
      <BarButton
        aria-haspopup="menu"
        disabled={attached.length === 0}
        onClick={(event) => setMenu({ kind: 'remove', anchor: event.currentTarget })}
      >
        라벨 떼기
      </BarButton>
      <BarButton
        aria-haspopup="menu"
        onClick={(event) => setMenu({ kind: 'visit', anchor: event.currentTarget })}
      >
        <CheckIcon aria-hidden="true" />
        다녀옴
      </BarButton>
      <BarButton onClick={onAddToTrip}>
        <RouteIcon aria-hidden="true" />
        여행에 넣기
      </BarButton>
      <BarButton onClick={onExport}>
        <ShareIcon aria-hidden="true" />
        내보내기
      </BarButton>
      <BarButton onClick={onDelete}>
        <TrashIcon aria-hidden="true" />
        삭제
      </BarButton>
      <BarButton onClick={onClear}>
        <XIcon aria-hidden="true" />
        선택 해제
      </BarButton>
      <LabelMenu
        anchor={menu?.kind === 'add' ? menu.anchor : null}
        onClose={() => setMenu(null)}
        labels={labels}
        empty="만든 라벨이 없어요"
        onPick={onAdd}
      />
      <LabelMenu
        anchor={menu?.kind === 'remove' ? menu.anchor : null}
        onClose={() => setMenu(null)}
        labels={attached}
        empty="뗄 라벨이 없어요"
        onPick={onRemove}
      />
      <Menu
        anchorEl={menu?.kind === 'visit' ? menu.anchor : null}
        open={menu?.kind === 'visit'}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            onMarkVisited();
            setMenu(null);
          }}
        >
          오늘 다녀옴으로 표시
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          disabled={visitedCount === 0}
          onClick={() => {
            onClearVisited();
            setMenu(null);
          }}
        >
          다녀옴 표시 지우기
        </MenuItem>
      </Menu>
    </Box>
  );
}

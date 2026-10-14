import Box from '@mui/material/Box';
import type { ComponentType, SVGProps } from 'react';
import { LayoutDashboardIcon, LayoutGridIcon, ListIcon, RowsIcon } from 'src/components/icons';
import type { Prefs } from 'src/schema/prefs';

export type LibraryView = Prefs['libraryView'];

const VIEWS: ReadonlyArray<{
  value: LibraryView;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { value: 'bento', label: '벤토', Icon: LayoutDashboardIcon },
  { value: 'cards', label: '카드', Icon: RowsIcon },
  { value: 'tiles', label: '타일', Icon: LayoutGridIcon },
  { value: 'list', label: '목록', Icon: ListIcon },
];

type Props = { value: LibraryView; onChange(view: LibraryView): void };

/** 보기 4종(벤토·카드·타일·목록) 토글. */
export function ViewSwitcher({ value, onChange }: Props) {
  return (
    <Box role="group" aria-label="보기 방식" sx={{ display: 'flex' }}>
      {VIEWS.map(({ value: view, label, Icon }) => (
        <Box
          key={view}
          component="button"
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={view === value}
          onClick={() => onChange(view)}
          sx={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            borderRadius: 'var(--tm-radius-md)',
            background: view === value ? 'var(--tm-accent-main)' : 'transparent',
            color: view === value ? 'var(--tm-accent-contrast)' : 'var(--tm-text-muted)',
            cursor: 'pointer',
            '& svg': { width: 20, height: 20 },
            '&:focus-visible': { outlineOffset: -2 },
          }}
        >
          <Icon aria-hidden="true" />
        </Box>
      ))}
    </Box>
  );
}

import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import type { LibraryQuery } from 'src/domain/library/query';

const SORTS: ReadonlyArray<{ value: LibraryQuery['sort']; label: string }> = [
  { value: 'recent', label: '최근 저장순' },
  { value: 'name', label: '이름순' },
  { value: 'label', label: '라벨순' },
];

type Props = { value: LibraryQuery['sort']; onChange(sort: LibraryQuery['sort']): void };

export function SortMenu({ value, onChange }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const current = SORTS.find((s) => s.value === value) ?? SORTS[0]!;
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor === null ? undefined : menuId}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          minHeight: 44,
          px: 1,
          border: 0,
          background: 'transparent',
          font: 'inherit',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--tm-text-secondary)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {current.label}
      </Box>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {SORTS.map((sort) => (
          <MenuItem
            key={sort.value}
            role="menuitemradio"
            aria-checked={sort.value === value}
            selected={sort.value === value}
            sx={{ minHeight: 44 }}
            onClick={() => {
              onChange(sort.value);
              setAnchor(null);
            }}
          >
            {sort.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

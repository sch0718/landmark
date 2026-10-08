import Box from '@mui/material/Box';
import { Link, useLocation } from 'react-router';
import { PlusIcon } from 'src/components/icons';
import { ADD_LABEL, isNavActive, NAV_ITEMS } from 'src/sections/shell/nav-items';

const ITEM_SX = {
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--tm-radius-md)',
  color: 'var(--tm-text-muted)',
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
  '& svg': { width: 22, height: 22 },
} as const;

/** 넓은 화면(≥768px)의 왼쪽 내비게이션 레일. */
export function NavRail({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  return (
    <Box
      component="nav"
      aria-label="사이드 메뉴"
      sx={{
        flex: 'none',
        width: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        pt: 2,
        bgcolor: 'var(--tm-bg-surface)',
        borderRight: '1px solid var(--tm-border)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        if (item === 'add') {
          return (
            <Box
              key="add"
              component="button"
              type="button"
              aria-label={ADD_LABEL}
              title={ADD_LABEL}
              onClick={onAdd}
              sx={{
                ...ITEM_SX,
                bgcolor: 'var(--tm-accent-main)',
                color: 'var(--tm-accent-contrast)',
              }}
            >
              <PlusIcon aria-hidden="true" />
            </Box>
          );
        }
        const active = isNavActive(item, pathname);
        return (
          <Box
            key={item.key}
            component={Link}
            to={item.to}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            sx={{
              ...ITEM_SX,
              textDecoration: 'none',
              ...(active && {
                color: 'var(--tm-text-primary)',
                bgcolor: 'var(--tm-bg-raised)',
              }),
            }}
          >
            <item.Icon aria-hidden="true" />
          </Box>
        );
      })}
    </Box>
  );
}

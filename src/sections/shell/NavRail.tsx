import Box from '@mui/material/Box';
import { Link, useLocation } from 'react-router';
import { AppLogo } from 'src/components/brand/AppLogo';
import { helpIdForPath } from 'src/sections/help/help-routing';
import { HelpIcon, PlusIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
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
  '& svg': { width: 22, height: 22 },
} as const;

/**
 * 넓은 화면(≥768px)의 왼쪽 내비게이션 레일. 포커스 표시는 테마의 전역 `:focus-visible`을 쓴다.
 * `onAdd`는 누른 ＋를 받는다(추가 칸을 `Esc`로 닫으면 포커스가 돌아올 곳).
 */
export function NavRail({ onAdd }: { onAdd: (opener: HTMLElement) => void }) {
  const { pathname } = useLocation();
  const helpId = helpIdForPath(pathname);
  return (
    <Box
      component="nav"
      aria-label="사이드 메뉴"
      sx={{
        flex: 'none',
        boxSizing: 'border-box',
        width: 'calc(64px + env(safe-area-inset-left, 0px))',
        pl: 'env(safe-area-inset-left, 0px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1.5,
        pt: 2,
        bgcolor: 'var(--tm-bg-surface)',
        borderRight: '1px solid var(--tm-border)',
      }}
    >
      <Box
        component={Link}
        to={paths.library}
        aria-label="랜드마크"
        title="랜드마크"
        sx={{ ...ITEM_SX, mb: 0.5, '& svg': { width: 32, height: 32 } }}
      >
        <AppLogo />
      </Box>
      {NAV_ITEMS.map((item) => {
        if (item === 'add') {
          return (
            <Box
              key="add"
              component="button"
              type="button"
              aria-label={ADD_LABEL}
              title={ADD_LABEL}
              onClick={(event) => onAdd(event.currentTarget)}
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
      <Box
        component={Link}
        to={helpId === null ? paths.help : paths.helpPage(helpId)}
        aria-label="도움말"
        title="도움말"
        sx={{ ...ITEM_SX, mt: 'auto', mb: 2, color: 'var(--tm-text-secondary)' }}
      >
        <HelpIcon aria-hidden="true" />
      </Box>
    </Box>
  );
}

import Box from '@mui/material/Box';
import type { MouseEvent } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { PlusIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import { ADD_LABEL, isNavActive, NAV_ITEMS } from 'src/sections/shell/nav-items';
import { sheetStateOf, useCloseSheet } from 'src/sections/shell/sheet-state';

const TAB_SX = {
  flex: 1,
  minWidth: 44,
  minHeight: 44,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  fontSize: 11,
  fontWeight: 700,
  textDecoration: 'none',
  color: 'var(--tm-text-muted)',
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  // 탭은 하단 메뉴 높이를 꽉 채우므로 바깥선을 안쪽으로 그린다(색·굵기는 테마의 포커스 표시와 같다).
  '&:focus-visible': { outlineOffset: -2 },
  '& svg': { width: 22, height: 22 },
} as const;

/**
 * 좁은 화면(<768px)의 하단 탭. 높이는 56px에 홈 인디케이터 영역을 더한다.
 * `onAdd`는 누른 ＋를 받는다(흐름을 닫을 때 포커스를 돌려줄 곳).
 */
export function BottomTabs({ onAdd }: { onAdd: (opener: HTMLElement) => void }) {
  const { pathname, state } = useLocation();
  const placeOn = sheetStateOf(state).from;
  // 상세 시트가 열려 있으면 켜진 탭은 시트 뒤 화면이다. 그 탭을 누르면 새 기록을 쌓지 않고 시트를 닫아
  // 뒤로 가기 한 번이면 닫히는 규칙(스펙 §4.4)을 지킨다. 다른 탭은 그대로 링크로 간다.
  const sheetOpen = matchPath(paths.place(':id'), pathname) !== null;
  const closeSheet = useCloseSheet();
  return (
    <Box
      component="nav"
      aria-label="하단 메뉴"
      sx={{
        flex: 'none',
        boxSizing: 'border-box',
        height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
        pb: 'env(safe-area-inset-bottom, 0px)',
        display: 'flex',
        alignItems: 'stretch',
        bgcolor: 'var(--tm-bg-surface)',
        borderTop: '1px solid var(--tm-border)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        if (item === 'add') {
          return (
            <Box
              key="add"
              sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Box
                component="button"
                type="button"
                aria-label={ADD_LABEL}
                onClick={(event) => onAdd(event.currentTarget)}
                sx={{
                  width: 44,
                  height: 44,
                  minWidth: 44,
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  borderRadius: 'var(--tm-radius-md)',
                  bgcolor: 'var(--tm-accent-main)',
                  color: 'var(--tm-accent-contrast)',
                  cursor: 'pointer',
                }}
              >
                <PlusIcon aria-hidden="true" width={22} height={22} />
              </Box>
            </Box>
          );
        }
        const active = isNavActive(item, pathname, placeOn);
        return (
          <Box
            key={item.key}
            component={Link}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            onClick={
              sheetOpen && active
                ? (event: MouseEvent) => {
                    // 새 탭으로 열기(보조 키·가운데 단추)는 브라우저에 맡긴다.
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    closeSheet();
                  }
                : undefined
            }
            sx={{ ...TAB_SX, ...(active && { color: 'var(--tm-text-primary)' }) }}
          >
            <item.Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Box>
        );
      })}
    </Box>
  );
}

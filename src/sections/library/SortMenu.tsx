import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState, type Ref } from 'react';
import type { LibraryQuery } from 'src/domain/library/query';

const SORTS: ReadonlyArray<{ value: LibraryQuery['sort']; label: string }> = [
  { value: 'recent', label: '최근 저장순' },
  { value: 'name', label: '이름순' },
  { value: 'label', label: '라벨순' },
];

/** 저장하지 않는 정렬(`visitedSortAtom`)의 항목 이름. */
const VISITED_SORT_LABEL = '다녀온 날순';
/** 저장하지 않는 근처 정렬(`nearbyAtom`)의 항목 이름. */
const NEARBY_SORT_LABEL = '가까운 순';

type Props = {
  value: LibraryQuery['sort'];
  /** `다녀온 날순`이 켜져 있는가. 켜져 있으면 저장되는 정렬은 모두 꺼진 것으로 보인다. */
  visitedSort: boolean;
  /** `가까운 순`(근처 모드)이 켜져 있는가. 켜져 있으면 다른 정렬은 모두 꺼진 것으로 보인다. */
  nearby: boolean;
  /** 저장되는 정렬을 골랐다. 부른 쪽이 `다녀온 날순`과 근처 모드를 끈다. */
  onChange(sort: LibraryQuery['sort']): void;
  /** `다녀온 날순`을 골랐다. 부른 쪽이 근처 모드를 끈다. */
  onVisitedSort(): void;
  /** `가까운 순`을 골랐다. 부른 쪽이 `다녀온 날순`을 끄고 위치를 묻는다. */
  onNearby(): void;
  /** 메뉴를 여는 단추. 근처 줄의 ×처럼 사라지는 단추가 포커스를 여기로 넘길 때 쓴다. */
  buttonRef?: Ref<HTMLButtonElement>;
};

export function SortMenu({
  value,
  visitedSort,
  nearby,
  onChange,
  onVisitedSort,
  onNearby,
  buttonRef,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const current = SORTS.find((s) => s.value === value) ?? SORTS[0]!;
  // 메모리 정렬은 하나만 켜진다. 근처가 먼저다(켤 때 `다녀온 날순`을 끄지만, 혹시 둘 다 참이어도 근처로 보인다).
  const visited = visitedSort && !nearby;
  const saved = !visitedSort && !nearby;
  const buttonLabel = nearby ? NEARBY_SORT_LABEL : visitedSort ? VISITED_SORT_LABEL : current.label;
  return (
    <>
      <Box
        ref={buttonRef}
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
        {buttonLabel}
      </Box>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {SORTS.map((sort) => (
          <MenuItem
            key={sort.value}
            role="menuitemradio"
            aria-checked={saved && sort.value === value}
            selected={saved && sort.value === value}
            sx={{ minHeight: 44 }}
            onClick={() => {
              onChange(sort.value);
              setAnchor(null);
            }}
          >
            {sort.label}
          </MenuItem>
        ))}
        <MenuItem
          role="menuitemradio"
          aria-checked={visited}
          selected={visited}
          sx={{ minHeight: 44 }}
          onClick={() => {
            onVisitedSort();
            setAnchor(null);
          }}
        >
          {VISITED_SORT_LABEL}
        </MenuItem>
        <MenuItem
          role="menuitemradio"
          aria-checked={nearby}
          selected={nearby}
          sx={{ minHeight: 44 }}
          onClick={() => {
            onNearby();
            setAnchor(null);
          }}
        >
          {NEARBY_SORT_LABEL}
        </MenuItem>
      </Menu>
    </>
  );
}

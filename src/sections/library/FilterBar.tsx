import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import { SearchIcon, ShareIcon } from 'src/components/icons';
import type { LibraryQuery } from 'src/domain/library/query';
import type { Label } from 'src/schema/library';
import { LabelChips } from 'src/sections/library/LabelChips';
import { RegionChips } from 'src/sections/library/RegionChips';
import { SortMenu } from 'src/sections/library/SortMenu';
import { ViewSwitcher, type LibraryView } from 'src/sections/library/ViewSwitcher';

export const SEARCH_PLACEHOLDER = '이름·주소·메모·라벨 검색';

type Props = {
  query: LibraryQuery;
  onChange(patch: Partial<LibraryQuery>): void;
  /** 살아 있는 라벨, 보관함의 라벨 순서. */
  labels: Label[];
  /** `labelCounts` 결과. 라벨 없음은 `'unlabeled'` 키. */
  counts: ReadonlyMap<string, number>;
  /** `regionCounts` 결과. */
  regions: ReadonlyArray<{ region: string; count: number }>;
  view: LibraryView;
  onViewChange(view: LibraryView): void;
  /** 내보내기 창을 연다. 0곳이어도 누를 수 있다(창에서 이유를 보여 준다). */
  onExport(): void;
};

/** 검색·정렬·보기 방식·내보내기와 라벨·지역 칩. */
export function FilterBar({
  query,
  onChange,
  labels,
  counts,
  regions,
  view,
  onViewChange,
  onExport,
}: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 1.5, pb: 0.5 }}>
      <Box sx={{ px: 2 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 44,
            px: 1.5,
            borderRadius: 'var(--tm-radius-md)',
            bgcolor: 'var(--tm-bg-raised)',
            border: '1px solid var(--tm-border)',
            color: 'var(--tm-text-muted)',
            '&:focus-within': { borderColor: 'var(--tm-accent-main)' },
          }}
        >
          <SearchIcon aria-hidden="true" width={18} height={18} />
          <InputBase
            fullWidth
            type="search"
            value={query.text}
            placeholder={SEARCH_PLACEHOLDER}
            onChange={(event) => onChange({ text: event.target.value })}
            slotProps={{ input: { 'aria-label': '장소 검색', enterKeyHint: 'search' } }}
            sx={{ color: 'var(--tm-text-primary)' }}
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
        <ViewSwitcher value={view} onChange={onViewChange} />
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <SortMenu value={query.sort} onChange={(sort) => onChange({ sort })} />
          <Box
            component="button"
            type="button"
            aria-label="내보내기"
            title="내보내기"
            onClick={onExport}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              border: 0,
              borderRadius: 'var(--tm-radius-md)',
              background: 'transparent',
              color: 'var(--tm-text-secondary)',
              cursor: 'pointer',
              '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
            }}
          >
            <ShareIcon aria-hidden="true" width={18} height={18} />
          </Box>
        </Box>
      </Box>

      <LabelChips query={query} onChange={onChange} labels={labels} counts={counts} />

      <RegionChips
        regions={regions}
        selected={query.regions}
        onChange={(next) => onChange({ regions: next })}
      />
    </Box>
  );
}

import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import { Link } from 'react-router';
import { LabelGlyph, SearchIcon, TagsIcon } from 'src/components/icons';
import type { LibraryQuery } from 'src/domain/library/query';
import type { Label } from 'src/schema/library';
import { paths } from 'src/routes/paths';
import { ChipButton } from 'src/sections/library/ChipButton';
import { labelColors } from 'src/sections/library/label-style';
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
};

const scrollRowSx = {
  display: 'flex',
  gap: 0.5,
  overflowX: 'auto',
  px: 2,
  scrollbarWidth: 'none',
} as const;

/** 검색·정렬·보기 방식과 라벨·지역 칩. */
export function FilterBar({ query, onChange, labels, counts, regions, view, onViewChange }: Props) {
  const toggleLabel = (id: string) =>
    onChange({
      unlabeled: false,
      labelIds: query.labelIds.includes(id)
        ? query.labelIds.filter((x) => x !== id)
        : [...query.labelIds, id],
    });
  // 미분류와 라벨은 함께 고를 수 없다: 하나를 고르면 다른 쪽을 비운다.
  const toggleUnlabeled = () =>
    onChange(query.unlabeled ? { unlabeled: false } : { unlabeled: true, labelIds: [] });

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
        <SortMenu value={query.sort} onChange={(sort) => onChange({ sort })} />
      </Box>

      <Box role="group" aria-label="라벨" sx={scrollRowSx}>
        <ChipButton
          selected={query.mode === 'all'}
          disabled={query.unlabeled}
          onClick={() => onChange({ mode: query.mode === 'all' ? 'any' : 'all' })}
        >
          모두 포함
        </ChipButton>
        <ChipButton selected={query.unlabeled} onClick={toggleUnlabeled}>
          미분류{' '}
          <Box component="span" sx={{ fontWeight: 500, opacity: 0.8 }}>
            {counts.get('unlabeled') ?? 0}
          </Box>
        </ChipButton>
        {labels.map((label) => (
          <ChipButton
            key={label.id}
            selected={query.labelIds.includes(label.id)}
            tone={labelColors(label.color.value)}
            onClick={() => toggleLabel(label.id)}
          >
            <Box
              component="span"
              sx={{ display: 'inline-flex', color: labelColors(label.color.value).marker }}
            >
              <LabelGlyph name={label.icon.value} size={14} />
            </Box>
            {label.name.value}{' '}
            <Box component="span" sx={{ fontWeight: 500, opacity: 0.8 }}>
              {counts.get(label.id) ?? 0}
            </Box>
          </ChipButton>
        ))}
        <Box
          component={Link}
          to={paths.labels}
          sx={{
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            minHeight: 44,
            px: 1.5,
            color: 'var(--tm-text-secondary)',
            fontSize: 14,
            fontWeight: 700,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: -2 },
          }}
        >
          <TagsIcon aria-hidden="true" width={14} height={14} />
          라벨 관리
        </Box>
      </Box>

      <RegionChips
        regions={regions}
        selected={query.regions}
        onChange={(next) => onChange({ regions: next })}
      />
    </Box>
  );
}

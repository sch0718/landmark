import Box from '@mui/material/Box';
import { Link } from 'react-router';
import { LabelGlyph, TagsIcon } from 'src/components/icons';
import type { LibraryQuery } from 'src/domain/library/query';
import type { Label } from 'src/schema/library';
import { paths } from 'src/routes/paths';
import { ChipButton } from 'src/sections/library/ChipButton';
import { labelColors } from 'src/sections/library/label-style';

type Props = {
  query: LibraryQuery;
  onChange(patch: Partial<LibraryQuery>): void;
  /** 살아 있는 라벨, 보관함의 라벨 순서. */
  labels: Label[];
  /** `labelCounts` 결과. 라벨 없음은 `'unlabeled'` 키. */
  counts: ReadonlyMap<string, number>;
  /** 끝에 `라벨 관리` 링크를 둔다(기본 켬). 다른 화면 위의 창(보관함 고르기)에서는 끈다. */
  manageLink?: boolean;
};

/** 한 줄로 가로 스크롤되는 라벨 필터 칩 줄(모두 포함 · 미분류 · 라벨들 · 라벨 관리). */
export function LabelChips({ query, onChange, labels, counts, manageLink = true }: Props) {
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
    <Box
      role="group"
      aria-label="라벨"
      sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', px: 2, scrollbarWidth: 'none' }}
    >
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
      {manageLink && (
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
            '&:focus-visible': { outlineOffset: -2 },
          }}
        >
          <TagsIcon aria-hidden="true" width={14} height={14} />
          라벨 관리
        </Box>
      )}
    </Box>
  );
}

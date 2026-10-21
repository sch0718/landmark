import Box from '@mui/material/Box';
import { useState, type ReactNode } from 'react';
import { LabelFilterDialog } from 'src/routes/lazy-routes';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
import { ChipScrollRow } from 'src/sections/library/ChipScrollRow';
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
  /** 맨 앞에 `라벨 관리` 링크를 고정한다(기본 켬). 다른 화면 위의 창(보관함 고르기)에서는 끈다. */
  manageLink?: boolean;
  /** 라벨 묶음 앞에 둘 칩 묶음(방문 칩). 있으면 구분선을 사이에 둔다. */
  leading?: ReactNode;
  /** 고정된 링크의 바탕색(칩 줄이 놓인 바탕과 같게). 기본 `var(--tm-bg-base)`. */
  background?: string;
};

/** `라벨 관리` 링크. 칩 줄 맨 앞에 붙어(가로 스크롤해도) 늘 보인다(스펙 A1 §6). */
function ManageLink({ background }: { background: string }) {
  return (
    <Box
      component={Link}
      to={paths.labels}
      sx={{
        position: 'sticky',
        left: 0,
        zIndex: 1,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 44,
        // 줄의 왼쪽 여백(px 2)까지 덮어, 스크롤된 칩이 링크 왼쪽으로 비치지 않게 한다.
        ml: -2,
        pl: 2,
        pr: 1.5,
        bgcolor: background,
        borderRight: '1px solid var(--tm-border)',
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
  );
}

/** 한 줄로 가로 스크롤되는 라벨 필터 칩 줄(라벨 관리 · 모두 포함 · 미분류 · 라벨들). */
export function LabelChips({
  query,
  onChange,
  labels,
  counts,
  manageLink = true,
  leading,
  background = 'var(--tm-bg-base)',
}: Props) {
  const [finding, setFinding] = useState(false);
  const ordered = [
    ...labels.filter((l) => query.labelIds.includes(l.id)),
    ...labels.filter((l) => !query.labelIds.includes(l.id)),
  ];
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
    <>
      <ChipScrollRow label="라벨 스크롤">
        {manageLink && <ManageLink background={background} />}
        {labels.length > 12 && (
          <Box
            component="button"
            type="button"
            aria-haspopup="dialog"
            onClick={() => setFinding(true)}
            sx={{
              flex: 'none',
              minHeight: 44,
              px: 1.5,
              border: 0,
              background: 'transparent',
              color: 'var(--tm-accent-text)',
              font: 'inherit',
              fontSize: 14,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            라벨 찾기
          </Box>
        )}
        {leading}
        {leading !== undefined && (
          <Box
            aria-hidden="true"
            sx={{
              flex: 'none',
              width: 1,
              height: 24,
              alignSelf: 'center',
              bgcolor: 'var(--tm-border)',
            }}
          />
        )}
        <Box role="group" aria-label="라벨" sx={{ display: 'flex', gap: 0.5, flex: 'none' }}>
          <ChipButton
            selected={query.mode === 'all'}
            disabled={query.unlabeled}
            onClick={() => onChange({ mode: query.mode === 'all' ? 'any' : 'all' })}
          >
            모두 포함
          </ChipButton>
          <ChipButton selected={query.unlabeled} onClick={toggleUnlabeled}>
            미분류{' '}
            <Box component="span" sx={{ fontWeight: 500 }}>
              {counts.get('unlabeled') ?? 0}
            </Box>
          </ChipButton>
          {ordered.map((label) => (
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
              <Box component="span" sx={{ fontWeight: 500 }}>
                {counts.get(label.id) ?? 0}
              </Box>
            </ChipButton>
          ))}
        </Box>
      </ChipScrollRow>
      <LazyDialogHost open={finding} onClose={() => setFinding(false)} heading="라벨 찾기">
        <LabelFilterDialog
          open={finding}
          onClose={() => setFinding(false)}
          query={query}
          onChange={onChange}
          labels={labels}
          counts={counts}
        />
      </LazyDialogHost>
    </>
  );
}

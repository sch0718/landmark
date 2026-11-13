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
};

/**
 * `라벨 관리` 링크. 칩 줄의 스크롤 영역 왼쪽 밖에 있어 가로로 넘겨도 늘 보이고 칩을 가리지 않는다(스펙 A1 §6).
 * 좁은 칸에서도 칩이 보일 자리를 남기려고 아이콘만 보인다(이름은 `aria-label`·`title`).
 */
function ManageLink() {
  return (
    <Box
      component={Link}
      to={paths.labels}
      aria-label="라벨 관리"
      title="라벨 관리"
      sx={{
        flex: 'none',
        display: 'inline-grid',
        placeItems: 'center',
        width: 44,
        minHeight: 44,
        ml: 1,
        borderRight: '1px solid var(--tm-border)',
        color: 'var(--tm-text-secondary)',
        '&:focus-visible': { outlineOffset: -2 },
      }}
    >
      <TagsIcon aria-hidden="true" width={18} height={18} />
    </Box>
  );
}

/** 한 줄로 가로 스크롤되는 라벨 필터 칩 줄(라벨 관리 · 모두 포함 · 미분류 · 라벨들). */
export function LabelChips({ query, onChange, labels, counts, manageLink = true, leading }: Props) {
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
      <ChipScrollRow
        label="라벨 스크롤"
        start={manageLink ? <ManageLink /> : undefined}
        end={
          labels.length > 12 && (
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
                borderLeft: '1px solid var(--tm-border)',
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
          )
        }
      >
        {leading}
        {leading !== undefined && (
          <Box
            aria-hidden="true"
            sx={{
              flex: 'none',
              // sx의 숫자 1은 100%다. 세로선이라 px로 적는다.
              width: '1px',
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
              {label.emoji?.value && (
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', color: labelColors(label.color.value).marker }}
                >
                  <LabelGlyph emoji={label.emoji?.value} size={14} />
                </Box>
              )}
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

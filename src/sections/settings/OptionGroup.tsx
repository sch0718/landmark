import Box from '@mui/material/Box';
import type { ComponentType, SVGProps } from 'react';

export type Option<V extends string> = {
  value: V;
  label: string;
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

type Props<V extends string> = {
  label: string;
  value: V;
  options: ReadonlyArray<Option<V>>;
  onChange(value: V): void;
};

/** 하나만 고르는 조각 버튼 묶음(모드·보관함 보기). */
export function OptionGroup<V extends string>({ label, value, options, onChange }: Props<V>) {
  return (
    <Box role="radiogroup" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {options.map(({ value: option, label: text, Icon }) => {
        const checked = option === value;
        return (
          <Box
            key={option}
            component="button"
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              minHeight: 44,
              px: 1.5,
              border: '1px solid',
              borderColor: checked ? 'var(--tm-accent-main)' : 'var(--tm-border)',
              borderRadius: 'var(--tm-radius-md)',
              bgcolor: checked ? 'var(--tm-accent-main)' : 'var(--tm-bg-surface)',
              color: checked ? 'var(--tm-accent-contrast)' : 'var(--tm-text-primary)',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
              '& svg': { width: 18, height: 18 },
              '&:focus-visible': { outline: '2px solid var(--tm-accent-main)', outlineOffset: 2 },
            }}
          >
            {Icon !== undefined && <Icon aria-hidden="true" />}
            {text}
          </Box>
        );
      })}
    </Box>
  );
}

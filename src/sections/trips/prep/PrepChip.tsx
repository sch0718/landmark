import Chip from '@mui/material/Chip';

export function PrepChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      component="button"
      type="button"
      clickable
      label={label}
      aria-pressed={selected}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      onClick={onClick}
      sx={{ minHeight: 44, minWidth: 44 }}
    />
  );
}

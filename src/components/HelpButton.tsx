import IconButton from '@mui/material/IconButton';
import { Link } from 'react-router';
import { HelpIcon } from 'src/components/icons';
import { paths } from 'src/routes/paths';
import type { HelpPageId } from 'src/sections/help/help-content';

type Props = {
  page: HelpPageId;
  /** 시트나 대화상자에서 이동할 때 원래 창을 닫는다. */
  onClick?(): void;
};

/** 현재 화면과 관련된 도움말로 가는 44px 링크 단추. */
export function HelpButton({ page, onClick }: Props) {
  return (
    <IconButton
      component={Link}
      to={paths.helpPage(page)}
      aria-label="도움말"
      title="도움말"
      onClick={onClick}
      sx={{
        flexShrink: 0,
        width: 44,
        height: 44,
        color: 'var(--tm-text-secondary)',
        '&.Mui-focusVisible': { outlineOffset: -2 },
      }}
    >
      <HelpIcon aria-hidden="true" width={20} height={20} />
    </IconButton>
  );
}

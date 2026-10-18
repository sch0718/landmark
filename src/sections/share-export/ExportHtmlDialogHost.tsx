import { ExportHtmlDialog } from 'src/routes/lazy-routes';
import type { ExportTargets } from 'src/sections/share-export/export-targets';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';

type Props = { open: boolean; onClose(): void; targets: ExportTargets };

/** 내보내기 대화상자(`ExportHtmlDialog`)를 처음 열 때 받아 그린다(`LazyDialogHost`). */
export function ExportHtmlDialogHost({ open, onClose, targets }: Props) {
  return (
    <LazyDialogHost open={open} onClose={onClose} heading="내보내기">
      <ExportHtmlDialog open={open} onClose={onClose} targets={targets} />
    </LazyDialogHost>
  );
}

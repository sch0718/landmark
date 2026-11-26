import { RestoreDialog } from 'src/routes/lazy-routes';
import type { RestoreDialogProps } from 'src/sections/backup/RestoreDialog';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';

export function RestoreDialogHost(props: RestoreDialogProps) {
  return (
    <LazyDialogHost
      open={props.open}
      onClose={props.onClose}
      heading={props.remote?.title ?? '백업에서 되살리기'}
      closeLabel="취소"
    >
      <RestoreDialog {...props} />
    </LazyDialogHost>
  );
}

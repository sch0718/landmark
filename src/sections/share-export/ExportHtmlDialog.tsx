import { useAtomValue } from 'jotai';
import { buildShareDoc } from 'src/domain/share/build-share';
import type { ExportTargets } from 'src/sections/share-export/export-targets';
import { renderShareHtml } from 'src/sections/share-export/make-share-html';
import { ShareFileDialog, type ShareFileOptions } from 'src/sections/share-export/ShareFileDialog';
import { libraryAtom } from 'src/stores/library-state';

const NOTHING_TO_EXPORT = '내보낼 장소가 없어요';

type Props = { open: boolean; onClose(): void; targets: ExportTargets };

/** 파일이 가져오기 한도를 넘을 때 줄이는 방법(스펙 §13 결정 9). */
const tooBigHint = (opts: ShareFileOptions): string =>
  opts.includeMemo
    ? "'메모 포함'을 끄거나 장소 수를 줄여 다시 해 주세요"
    : '장소 수를 줄여 다시 해 주세요';

/**
 * 장소를 HTML 파일 하나로 내보내는 창(스펙 §3.2·§3.4). 몸통(저장·공유·경쟁 처리·크기 검사)은
 * `ShareFileDialog`이고, 이 창은 대상(`targets`)과 v1 문서 만들기만 넘긴다.
 */
export function ExportHtmlDialog({ open, onClose, targets }: Props) {
  const library = useAtomValue(libraryAtom);
  return (
    <ShareFileDialog
      open={open}
      onClose={onClose}
      heading="내보내기"
      summary={targets.summary}
      defaultTitle={targets.defaultTitle}
      emptyMessage={targets.ids.length === 0 ? NOTHING_TO_EXPORT : null}
      linkDoc={(opts) => buildShareDoc(library, targets.ids, opts)}
      make={(template, opts) => renderShareHtml(template, library, targets.ids, opts)}
      tooBigHint={tooBigHint}
    />
  );
}

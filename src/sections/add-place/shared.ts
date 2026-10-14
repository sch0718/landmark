import type { OpSummary } from 'src/domain/library/ops';
import type { FolderResult } from 'src/server/resolve';

/** 네이버 공유 폴더 조회 결과의 장소 하나. */
export type FolderPlace = FolderResult['places'][number];

/** 다시 시도할 수 있는 오류(스펙 §5). 폴더에는 핀으로 추가할 길이 없다. */
export const RETRY_CODES: readonly string[] = ['UPSTREAM_ERROR', 'TIMEOUT', 'OFFLINE'];

/** 가져온 결과를 세 문장 중 하나로 말한다. 되살린 장소는 새로 넣은 것에 센다. */
export function resultMessage(summary: OpSummary): string | null {
  const added = summary.created + summary.restored;
  const merged = summary.merged;
  if (added > 0 && merged > 0) return `${added}곳을 새로 넣고, ${merged}곳은 라벨만 더했어요`;
  if (added > 0) return `${added}곳을 새로 넣었어요`;
  if (merged > 0) return `${merged}곳은 라벨만 더했어요`;
  return null;
}

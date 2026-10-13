import { LABEL_NAME_RANGE_MESSAGE } from 'src/schema/library';

/**
 * 라벨 연산이 거절한 이유를 입력란 아래에 보일 문구로 바꾼다. 저장소 오류 같은 나머지는
 * `useLibraryAction`이 토스트로 알리므로 `null`이다.
 */
export function labelRejectionMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('_tag' in error)) return null;
  switch (error._tag) {
    case 'LabelNameInvalid':
      return LABEL_NAME_RANGE_MESSAGE;
    case 'LabelNameTaken':
      return '같은 이름의 라벨이 있어요';
    case 'NotFound':
      return '라벨을 찾을 수 없어요';
    default:
      return null;
  }
}

import { Component, type ReactNode } from 'react';
import { isChunkLoadError } from 'src/lib/lazy-chunk';

type Props = { fallback: ReactNode; children: ReactNode };
type State = { error: unknown };

/**
 * 나눠 받기 실패(`ChunkLoadError`)만 `fallback`(새 버전 안내)으로 받는다. 그 밖의 오류는 다시 던져
 * 바깥 오류 경계가 받게 한다. 추가 칸 단계·내보내기 대화상자처럼 화면 전체가 아니라 그 자리 안에서 안내할 때 쓴다.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isChunkLoadError(error)) return this.props.fallback;
    throw error;
  }
}

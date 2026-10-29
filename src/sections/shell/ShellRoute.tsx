import { useAutoBackupBoot } from 'src/sections/server-backup/use-auto-backup-boot';
import { useSetAtom } from 'jotai';
import { useSyncBoot } from 'src/sections/library-sync/use-sync-boot';
import { Component, Suspense, useEffect, type ReactNode } from 'react';
import { LoadingNotice } from 'src/components/LoadingNotice';
import { prefetchWhenIdle } from 'src/lib/prefetch';
import { PANEL_CHUNKS, ROUTE_CHUNKS } from 'src/routes/lazy-routes';
import { LibraryCorrupt } from 'src/services/errors';
import { CorruptScreen } from 'src/sections/shell/CorruptScreen';
import { AppShell } from 'src/sections/shell/AppShell';
import { libraryReloadAtom, useLibrarySync } from 'src/stores/library-state';

type BoundaryProps = { children: ReactNode; onRecovered: () => void };
type BoundaryState = { error: unknown };

/** `LibraryCorrupt`만 복구 화면으로 받는다. 그 밖의 오류는 다시 던져 라우트의 오류 화면이 받게 한다. */
class CorruptBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  private readonly recover = () => {
    // 보관함을 다시 읽도록 알린 뒤 경계를 푼다.
    this.props.onRecovered();
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error instanceof LibraryCorrupt) {
      return <CorruptScreen error={error} onRecovered={this.recover} />;
    }
    throw error;
  }
}

/** 셸이 처음 그려진 뒤 한가할 때 미리 받을 단위들. 한 곳에서 모은다. */
export const PREFETCH_CHUNKS = [...ROUTE_CHUNKS, ...PANEL_CHUNKS];

/** 보관함을 읽고(`useLibrarySync`, 앱에서 한 번) 셸을 그린다. 읽는 동안은 Suspense가 멈춘다. */
function LibraryShell() {
  useLibrarySync();
  useSyncBoot();
  useAutoBackupBoot();
  // 이 컴포넌트가 그려졌다는 건 보관함을 읽고 셸이 나왔다는 뜻이다. 미리 받기는 한 번만 예약된다.
  useEffect(() => {
    prefetchWhenIdle(PREFETCH_CHUNKS);
  }, []);
  return <AppShell />;
}

/** 보관함이 필요한 라우트의 루트. 로드 중 표시·손상 복구 화면·셸을 한 곳에서 감싼다. */
export function ShellRoute() {
  const reload = useSetAtom(libraryReloadAtom);
  return (
    <CorruptBoundary onRecovered={() => reload((n) => n + 1)}>
      <Suspense fallback={<LoadingNotice />}>
        <LibraryShell />
      </Suspense>
    </CorruptBoundary>
  );
}

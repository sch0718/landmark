import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import { LocateFixedIcon } from 'src/components/icons';

type Props = {
  /**
   * 위치를 찾는 중인가. 찾는 중에는 눌러도 아무 일도 없다(요청을 더 만들지 않는다). 포커스는 그대로 두도록
   * `disabled` 대신 `aria-disabled`로 알린다.
   */
  locating: boolean;
  onClick(): void;
};

/** 지도 단추 기둥의 `내 위치 보기` 단추. 바탕·테두리·그림자는 `MapZoomButtons` 묶음과 같다. */
export function MyLocationButton({ locating, onClick }: Props) {
  return (
    <IconButton
      aria-label={locating ? '내 위치를 찾는 중' : '내 위치 보기'}
      aria-busy={locating ? 'true' : undefined}
      aria-disabled={locating ? 'true' : undefined}
      onClick={() => {
        if (!locating) onClick();
      }}
      sx={{
        width: 44,
        height: 44,
        color: 'var(--tm-text-primary)',
        bgcolor: 'var(--tm-bg-surface)',
        border: '1px solid var(--tm-border-strong, var(--tm-border))',
        borderRadius: 'var(--tm-radius-md)',
        boxShadow: 'var(--tm-shadow-1)',
        '&:hover': { bgcolor: 'var(--tm-bg-surface)' },
        // 지도 단추는 가장자리 가까이 있어 포커스 표시를 안쪽으로 그린다(`MapZoomButtons`와 같다).
        '&.Mui-focusVisible': { outlineOffset: -2 },
      }}
    >
      {locating ? (
        <CircularProgress size={18} color="inherit" aria-hidden="true" />
      ) : (
        <LocateFixedIcon aria-hidden="true" width={20} height={20} />
      )}
    </IconButton>
  );
}

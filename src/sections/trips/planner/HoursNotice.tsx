import Box from '@mui/material/Box';
import { AlertIcon } from 'src/components/icons';
import { visitMessage, type VisitCheck } from 'src/domain/trips/hours';
import type { PlaceHours } from 'src/server/hours';
import type { PlaceHoursView } from 'src/sections/trips/planner/use-place-hours';

/** 행·카드가 함께 쓰는 영업시간 한 줄. `warn`은 주황 칩, `muted`는 `영업시간 확인 필요`. */
export type Notice = { text: string; tone: 'warn' | 'muted' };

const NEEDS_CHECK: Notice = { text: '영업시간 확인 필요', tone: 'muted' };

/**
 * 장소의 영업시간 상태와 판정(`check`)으로 보일 한 줄(스펙 §2.1). 줄이 없으면 null.
 * 받는 중(받은 정보 없음)에는 아무것도 보이지 않는다(받자마자 나타났다 사라지는 깜빡임을 막는다).
 * 받은 정보가 있으면 다시 받는 중이거나 다시 받다 실패했어도 그 정보로 판정한다.
 */
export function noticeFor(
  view: PlaceHoursView,
  check: (hours: PlaceHours) => VisitCheck,
): Notice | null {
  switch (view.kind) {
    case 'unsupported':
    case 'failed':
      return NEEDS_CHECK;
    case 'loading':
      return null;
    case 'known': {
      const result = check(view.hours);
      if (result.kind === 'ok') return null;
      if (result.kind === 'unknown') return NEEDS_CHECK;
      const text = visitMessage(result);
      return text === null ? null : { text, tone: 'warn' };
    }
  }
}

/** 경고 칩(주황, 굵게, 앞에 경고 아이콘) 또는 확인 필요(12px 보조 글자). 행 버튼 안에서도 쓰도록 `span`이다. */
export function HoursNotice({ notice }: { notice: Notice }) {
  if (notice.tone === 'muted') {
    return (
      <Box
        component="span"
        sx={{
          display: 'block',
          fontSize: 12,
          color: 'var(--tm-text-muted)',
          overflowWrap: 'anywhere',
        }}
      >
        {notice.text}
      </Box>
    );
  }
  return (
    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          maxWidth: '100%',
          px: 0.75,
          py: 0.25,
          borderRadius: 'var(--tm-radius-sm)',
          bgcolor: 'var(--tm-label-orange-fill)',
          color: 'var(--tm-label-orange-text)',
          fontSize: 12,
          fontWeight: 700,
          overflowWrap: 'anywhere',
        }}
      >
        <AlertIcon aria-hidden="true" width={12} height={12} style={{ flex: 'none' }} />
        {notice.text}
      </Box>
    </Box>
  );
}

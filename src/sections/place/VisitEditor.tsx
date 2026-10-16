import Box from '@mui/material/Box';
import { useId, useState, type ChangeEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { CheckIcon } from 'src/components/icons';
import { BUTTON_SX } from 'src/sections/place/button-style';

type Props = {
  /** 저장된 다녀온 날(`YYYY-MM-DD`). 안 가 봤으면 `null`. */
  visitedOn: string | null;
  /** 이 기기의 오늘(`YYYY-MM-DD`). 날짜 칸의 `max`. */
  today: string;
  onMarkToday(): void;
  onSetDate(date: string): void;
  onClear(): void;
};

/**
 * 장소 상세의 다녀옴 칸(스펙 §4.1). 안 가 봤으면 `다녀왔어요` 버튼 하나,
 * 다녀왔으면 체크 아이콘·날짜 칸·`다녀옴 취소`. 저장과 실패 알림은 호출한 쪽이 맡는다.
 */
export function VisitEditor({ visitedOn, today, onMarkToday, onSetDate, onClear }: Props) {
  const errorId = useId();
  const [future, setFuture] = useState(false);

  if (visitedOn === null) {
    return (
      <Box component="button" type="button" onClick={onMarkToday} sx={{ ...BUTTON_SX, mt: 0.5 }}>
        <CheckIcon aria-hidden="true" style={{ color: 'var(--tm-accent-text)' }} />
        다녀왔어요
      </Box>
    );
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const date = event.target.value;
    // 브라우저의 지우기: 저장하지 않는다. 칸은 제어 입력이라 저장된 날짜로 돌아간다.
    if (date === '') return;
    if (date > today) {
      setFuture(true);
      return;
    }
    setFuture(false);
    onSetDate(date);
  };

  return (
    <Box sx={{ mt: 0.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <CheckIcon
          aria-hidden="true"
          width={20}
          height={20}
          style={{ flex: 'none', color: 'var(--tm-accent-text)' }}
        />
        <Box
          component="input"
          type="date"
          aria-label="다녀온 날"
          max={today}
          value={visitedOn}
          aria-invalid={future}
          aria-describedby={future ? errorId : undefined}
          onChange={onChange}
          sx={[fieldSx({ invalid: future }), { flex: '1 1 160px', width: 'auto' }]}
        />
        <Box component="button" type="button" onClick={onClear} sx={BUTTON_SX}>
          다녀옴 취소
        </Box>
      </Box>
      {future && (
        <Box id={errorId} role="alert" sx={{ mt: 0.5, fontSize: 12, color: 'error.main' }}>
          오늘 이후 날짜는 고를 수 없어요
        </Box>
      )}
    </Box>
  );
}

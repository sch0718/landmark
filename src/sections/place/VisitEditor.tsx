import Box from '@mui/material/Box';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { fieldSx } from 'src/components/field-style';
import { CheckIcon } from 'src/components/icons';
import { BUTTON_SX } from 'src/sections/place/button-style';

/** 이보다 이른 날짜는 연도를 치는 중간값(`0002-…`)으로 보고 저장하지 않는다. 날짜 칸의 `min`과 같다. */
const MIN_DATE = '1900-01-01';

type Props = {
  /** 저장된 다녀온 날(`YYYY-MM-DD`). 안 가 봤으면 `null`. */
  visitedOn: string | null;
  /** 이 기기의 오늘(`YYYY-MM-DD`). 날짜 칸의 `max`. */
  today: string;
  /** 저장이 실패하면(`false`) 옮기려던 포커스를 버린다. 동기 호출이면 `void`. */
  onMarkToday(): Promise<boolean> | void;
  onSetDate(date: string): void;
  onClear(): Promise<boolean> | void;
};

/**
 * 장소 상세의 다녀옴 칸(스펙 §4.1). 안 가 봤으면 `다녀왔어요` 버튼 하나,
 * 다녀왔으면 체크 아이콘·날짜 칸·`다녀옴 취소`. 저장과 실패 알림은 호출한 쪽이 맡는다.
 */
export function VisitEditor({ visitedOn, today, onMarkToday, onSetDate, onClear }: Props) {
  const errorId = useId();
  const [future, setFuture] = useState(false);
  // 크로뮴은 연도를 한 자리씩 칠 때마다 완전한 값(`0002-10-16`, `0209-10-16`…)으로 change를 쏜다.
  // 그래서 칸은 초안을 들고, 저장은 끝까지 올바른 날짜일 때만 한다.
  const [draft, setDraft] = useState(visitedOn ?? '');
  const [syncedOn, setSyncedOn] = useState(visitedOn);
  if (syncedOn !== visitedOn) {
    // 저장된 날짜가 바뀌면(표시·취소·되돌리기) 초안을 맞추고 묵은 안내를 지운다.
    setSyncedOn(visitedOn);
    setDraft(visitedOn ?? '');
    setFuture(false);
  }

  // 누른 버튼이 사라지고 다른 쪽이 나타나므로, 저장돼 화면이 바뀐 뒤 포커스를 옮겨 준다.
  const focusNext = useRef<'date' | 'mark' | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  // 저장이 실패하면 포커스 예약을 버린다. 안 그러면 나중에 날짜가 바뀔 때 포커스를 가져간다.
  const request = (next: 'date' | 'mark', save: () => Promise<boolean> | void) => {
    focusNext.current = next;
    void Promise.resolve(save()).then((ok) => {
      if (ok === false && focusNext.current === next) focusNext.current = null;
    });
  };
  useEffect(() => {
    if (focusNext.current === 'date' && visitedOn !== null) {
      dateRef.current?.focus();
      focusNext.current = null;
    } else if (focusNext.current === 'mark' && visitedOn === null) {
      markRef.current?.focus();
      focusNext.current = null;
    }
  }, [visitedOn]);

  if (visitedOn === null) {
    return (
      <Box
        component="button"
        type="button"
        ref={markRef}
        onClick={() => request('date', onMarkToday)}
        sx={{ ...BUTTON_SX, mt: 0.5 }}
      >
        <CheckIcon aria-hidden="true" style={{ color: 'var(--tm-accent-text)' }} />
        다녀왔어요
      </Box>
    );
  }

  // 칸을 떠날 때 저장되지 않은 값(비움·중간값·미래)이 남아 있으면 저장된 날짜로 돌린다.
  // 올바른 날짜는 저장을 부탁한 상태라 그대로 둔다(저장이 끝나면 prop이 따라온다).
  const onBlur = () => {
    if (draft !== '' && draft >= MIN_DATE && draft <= today) return;
    setDraft(visitedOn);
    setFuture(false);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const date = event.target.value;
    setDraft(date);
    // 비움(휴대폰 날짜 창의 지우기)이나 연도 입력 중간값: 저장도 안내도 없이 입력을 이어 가게 둔다.
    if (date === '' || date < MIN_DATE) return;
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
          ref={dateRef}
          aria-label="다녀온 날"
          min={MIN_DATE}
          max={today}
          value={draft}
          aria-invalid={future}
          aria-describedby={future ? errorId : undefined}
          onChange={onChange}
          onBlur={onBlur}
          sx={[fieldSx({ invalid: future }), { flex: '1 1 160px', width: 'auto' }]}
        />
        <Box
          component="button"
          type="button"
          onClick={() => request('mark', onClear)}
          sx={BUTTON_SX}
        >
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

import Box from '@mui/material/Box';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { fieldSx } from 'src/components/field-style';
import { PencilIcon } from 'src/components/icons';

type Props = {
  value: string;
  /** 입력란·수정 버튼의 접근성 이름("이름", "분류"). */
  label: string;
  /** 값이 비었을 때 수정 버튼에 보이는 안내. */
  emptyText?: string;
  /** 빈 값으로 저장해도 되는가. 아니면 빈 입력은 저장하지 않고 원래 값으로 둔다. */
  allowEmpty: boolean;
  variant?: 'title' | 'body';
  /** 제목(`h1`·`h2`)으로 만든다(장소 이름). 고치는 동안에도 제목 이름은 지금 값이다. */
  headingLevel?: 1 | 2;
  /** 입력칸의 글자 수 한도. 브라우저가 이 길이에서 멈춘다(붙여넣기도 잘린다). */
  maxLength?: number;
  /** 저장한다. 실패는 호출한 쪽이 알린다(토스트). */
  onSave(text: string): Promise<{ ok: boolean }>;
};

const isComposing = (event: KeyboardEvent) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

/**
 * 눌러서 고치는 한 줄 글. Enter·포커스를 잃을 때 저장하고 Esc는 취소한다.
 * 편집 중에 화면을 떠나면(포커스 이벤트 없이 사라짐) 그 자리에서 저장한다.
 */
export function EditableText({
  value,
  label,
  emptyText = '',
  allowEmpty,
  variant = 'body',
  headingLevel,
  maxLength,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // 저장하는 동안 보여 줄 값. 저장이 끝나면(성공이면 `value`가 이미 새 값) 지운다.
  const [pending, setPending] = useState<string | null>(null);

  // 이벤트·정리 함수가 항상 최신 값을 보도록 ref에 둔다.
  const live = useRef({ editing, draft, value, allowEmpty, onSave });
  useEffect(() => {
    live.current = { editing, draft, value, allowEmpty, onSave };
  });

  const finish = (): string | null => {
    const { editing: on, draft: text, value: saved, allowEmpty: empty } = live.current;
    if (!on) return null;
    live.current.editing = false;
    const trimmed = text.trim();
    return trimmed === saved || (trimmed === '' && !empty) ? null : trimmed;
  };

  const commit = async () => {
    const text = finish();
    setEditing(false);
    if (text === null) return;
    setPending(text);
    try {
      await live.current.onSave(text);
    } finally {
      setPending(null);
    }
  };

  // 편집 중에 사라지면 저장한다(블러가 오지 않는다).
  useEffect(
    () => () => {
      const text = finish();
      if (text !== null) void live.current.onSave(text);
    },
    [],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      live.current.editing = false;
      setEditing(false);
    }
  };

  const shown = pending ?? value;
  const font =
    variant === 'title'
      ? { fontSize: 20, fontWeight: 800, lineHeight: 1.35 }
      : { fontSize: 14, fontWeight: 600, lineHeight: 1.5 };

  // 제목이면 접근성 이름을 값으로 고정한다(안쪽 버튼의 "이름 수정"이 제목 이름이 되지 않게).
  const wrap = (node: ReactNode) =>
    headingLevel !== undefined ? (
      <Box component={`h${headingLevel}`} aria-label={shown} sx={{ m: 0, font: 'inherit' }}>
        {node}
      </Box>
    ) : (
      node
    );

  if (editing) {
    return wrap(
      <Box
        component="input"
        type="text"
        aria-label={label}
        autoFocus
        maxLength={maxLength}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        sx={[
          fieldSx(),
          {
            // 고치는 중이라는 표시로 늘 강조 테두리를 둔다(나머지 모양은 다른 입력칸과 같다).
            border: '2px solid var(--tm-accent-main)',
            // 제목은 보이던 글자 크기를 지킨다. 그 밖에는 16px(아이폰에서 눌러도 확대되지 않게).
            ...(variant === 'title' ? font : { fontWeight: font.fontWeight }),
          },
        ]}
      />,
    );
  }

  return wrap(
    <Box
      component="button"
      type="button"
      aria-label={`${label} 수정`}
      onClick={() => {
        setDraft(shown);
        setEditing(true);
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        minHeight: 44,
        px: 1,
        mx: -1,
        border: 0,
        borderRadius: 'var(--tm-radius-md)',
        background: 'transparent',
        color: shown === '' ? 'var(--tm-text-muted)' : 'var(--tm-text-primary)',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'text',
        '&:hover': { bgcolor: 'var(--tm-bg-raised)' },
        ...font,
      }}
    >
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {shown === '' ? emptyText : shown}
      </Box>
      <PencilIcon
        aria-hidden="true"
        width={14}
        height={14}
        style={{ flex: 'none', opacity: 0.6 }}
      />
    </Box>,
  );
}

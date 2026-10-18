import Box from '@mui/material/Box';
import { useState } from 'react';
import { TagsIcon } from 'src/components/icons';
import { LabelPickerDialog } from 'src/routes/lazy-routes';
import type { Label } from 'src/schema/library';
import { LabelBadge } from 'src/sections/library/LabelBadge';
import { BUTTON_SX } from 'src/sections/place/button-style';
import { LazyDialogHost } from 'src/sections/share-export/LazyDialogHost';
import type { LibraryActionResult } from 'src/stores/library-state';

type Props = {
  /** 붙일 수 있는 라벨(살아 있는 모든 라벨, 순서대로). */
  labels: Label[];
  /** 이 장소에 붙은 라벨 id. */
  attachedIds: readonly string[];
  /** 라벨을 켜거나 끈다. 실패는 호출한 쪽이 알린다(토스트). */
  onToggle(labelId: string): void;
  /** 이름으로 라벨을 만들어(같은 이름이 있으면 그것을) 붙인다. */
  onCreate(name: string): Promise<LibraryActionResult>;
};

/**
 * 장소 상세·추가 카드의 라벨 칸(스펙 §5.1). 붙은 라벨만 보이고, `라벨 바꾸기`가 라벨 고르기 창(나눠 받음)을 연다.
 * 창을 닫으면 포커스는 이 버튼으로 돌아온다.
 */
export function LabelPicker({ labels, attachedIds, onToggle, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const attached = labels.filter((label) => attachedIds.includes(label.id));
  return (
    <Box>
      {attached.length > 0 ? (
        <Box
          component="ul"
          aria-label="붙은 라벨"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
        >
          {attached.map((label) => (
            <Box component="li" key={label.id} sx={{ minWidth: 0, maxWidth: '100%' }}>
              <LabelBadge label={label} />
            </Box>
          ))}
        </Box>
      ) : (
        <Box component="p" sx={{ m: 0, fontSize: 14, color: 'var(--tm-text-secondary)' }}>
          붙은 라벨이 없어요
        </Box>
      )}
      <Box
        component="button"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        sx={[BUTTON_SX, { mt: 1 }]}
      >
        <TagsIcon aria-hidden="true" />
        라벨 바꾸기
      </Box>
      <LazyDialogHost open={open} onClose={close} heading="라벨 바꾸기">
        <LabelPickerDialog
          open={open}
          onClose={close}
          labels={labels}
          attachedIds={attachedIds}
          onToggle={onToggle}
          onCreate={onCreate}
        />
      </LazyDialogHost>
    </Box>
  );
}

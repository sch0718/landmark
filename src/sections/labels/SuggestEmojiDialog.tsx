import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';
import { toast } from 'sonner';
import { LabelGlyph } from 'src/components/icons';
import {
  applyLabelEmojiSuggestions,
  labelEmojiSuggestions,
  revertLabelEmojis,
  type EmojiChange,
} from 'src/domain/library/label-emoji-ops';
import type { Library } from 'src/schema/library';
import { emojiName } from 'src/sections/labels/emoji-options';
import { useLibraryAction } from 'src/stores/library-state';

const MERGED_NOTICE = '다른 곳에서 바뀐 부분은 그대로 두었어요';

/** LabelsPage가 이미 lazy라 추천 표·미리보기는 첫 로딩에 들어가지 않는다. */
export function SuggestEmojiDialog({ library, onClose }: { library: Library; onClose(): void }) {
  const { run } = useLibraryAction();
  const [suggestions] = useState(() => labelEmojiSuggestions(library));
  const [checked, setChecked] = useState(() => new Set(suggestions.map((item) => item.labelId)));
  const [saving, setSaving] = useState(false);

  const undo = async (changes: readonly EmojiChange[]) => {
    const result = await run((lib, ctx) => revertLabelEmojis(lib, changes, ctx));
    if (result.ok && (result.summary?.merged ?? 0) > 0) toast(MERGED_NOTICE);
  };

  const apply = async () => {
    if (saving) return;
    setSaving(true);
    const recorded: { changes: EmojiChange[] } = { changes: [] };
    const result = await run((lib, ctx) => {
      const out = applyLabelEmojiSuggestions(
        lib,
        suggestions.filter((item) => checked.has(item.labelId)),
        ctx,
      );
      recorded.changes = out.changes;
      return {
        ok: true,
        lib: out.lib,
        summary: { created: out.changes.length, merged: out.skipped, restored: 0 },
      };
    });
    setSaving(false);
    if (!result.ok) return;
    if (recorded.changes.length > 0) {
      toast(`라벨 ${recorded.changes.length}개의 이모지를 정했어요`, {
        duration: 8000,
        action: { label: '되돌리기', onClick: () => undo(recorded.changes) },
      });
    }
    if ((result.summary?.merged ?? 0) > 0) toast(MERGED_NOTICE);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      fullWidth
      maxWidth="sm"
      aria-labelledby="suggest-emoji-title"
    >
      <DialogTitle id="suggest-emoji-title">이름으로 이모지 정하기</DialogTitle>
      <DialogContent>
        <Box component="p" sx={{ mt: 0, color: 'var(--tm-text-secondary)' }}>
          이모지가 없는 라벨만 추천해요. 적용할 라벨을 골라 주세요.
        </Box>
        {suggestions.length === 0 ? (
          <Box component="p">추천할 라벨이 없어요</Box>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
            {suggestions.map((item) => (
              <Box component="li" key={item.labelId}>
                <Box
                  component="label"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 44,
                    cursor: 'pointer',
                    gap: 1,
                  }}
                >
                  <Checkbox
                    checked={checked.has(item.labelId)}
                    disabled={saving}
                    slotProps={{
                      input: {
                        'aria-label': `${item.nameBefore.value} — ${emojiName(item.suggested)}`,
                      },
                    }}
                    onChange={(_, selected) =>
                      setChecked((before) => {
                        const next = new Set(before);
                        if (selected) next.add(item.labelId);
                        else next.delete(item.labelId);
                        return next;
                      })
                    }
                    sx={{ p: 1.5 }}
                  />
                  <LabelGlyph name="star" emoji={item.suggested} size={24} />
                  <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {item.nameBefore.value}
                    <Box
                      component="span"
                      sx={{ ml: 1, fontSize: 12, color: 'var(--tm-text-secondary)' }}
                    >
                      {emojiName(item.suggested)}
                    </Box>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button disabled={saving} onClick={onClose} sx={{ minHeight: 44 }}>
          취소
        </Button>
        <Button
          variant="contained"
          disabled={saving || checked.size === 0}
          onClick={() => void apply()}
          sx={{ minHeight: 44 }}
        >
          적용
        </Button>
      </DialogActions>
    </Dialog>
  );
}

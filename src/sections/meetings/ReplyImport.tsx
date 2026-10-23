import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { applyReply, previewReply } from 'src/domain/meeting/apply-reply';
import type { ReplyDoc } from 'src/domain/meeting/link';
import { paths } from 'src/routes/paths';
import { useMeeting } from './use-meeting';

/** 받은 답장은 주최자 기기의 미리보기를 확인한 뒤에만 보관함에 쓴다. */
export function ReplyImport({ doc }: { doc: ReplyDoc }) {
  const { meeting, run } = useMeeting(doc.meetingId);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (meeting === null)
    return (
      <Box sx={{ p: 3 }}>
        <Box component="h1" sx={{ fontSize: 20 }}>
          이 기기에 없는 약속의 답장이에요
        </Box>
        <Button component={Link} to={paths.meetings} sx={{ minHeight: 44 }}>
          약속 목록으로
        </Button>
      </Box>
    );
  const preview = previewReply(meeting, doc);
  const apply = async () => {
    if (busy || preview.kind !== 'ok') return;
    setBusy(true);
    const result = await run((lib, ctx) => applyReply(lib, doc.meetingId, doc, ctx));
    setBusy(false);
    if (result.ok) navigate(paths.meeting(doc.meetingId));
  };
  return (
    <Box sx={{ p: 3, maxWidth: 600, mx: 'auto' }}>
      <Box component="h1" sx={{ fontSize: 20 }}>
        답장 미리보기
      </Box>
      {preview.kind === 'ok' ? (
        <>
          <p>{`${preview.participant.name}님 답장: 좋아요 ${preview.likes.length}곳${preview.originChanged ? ', 출발지 바뀜' : ''}`}</p>
          {preview.droppedLikes > 0 && <p>없어진 후보 {preview.droppedLikes}곳 제외</p>}
          {preview.participant.isNew && <p>새 참석자로 더해져요</p>}
          <Button
            onClick={() => void apply()}
            disabled={busy}
            variant="contained"
            sx={{ minHeight: 44 }}
          >
            반영
          </Button>
        </>
      ) : (
        <p>
          {preview.kind === 'stale'
            ? '더 오래된 답장이에요'
            : preview.kind === 'full'
              ? '참석자가 10명으로 차 있어요'
              : '이 약속의 참석자를 찾지 못했어요'}
        </p>
      )}
      <Button
        disabled={busy}
        onClick={() => navigate(paths.meeting(doc.meetingId))}
        sx={{ minHeight: 44 }}
      >
        반영하지 않기
      </Button>
    </Box>
  );
}

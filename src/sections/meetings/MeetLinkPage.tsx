import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { readMeetHash } from 'src/domain/meeting/link';
import { useDocumentTitle } from 'src/lib/use-document-title';
import { paths } from 'src/routes/paths';
import { FinalView } from './FinalView';
import { InviteView } from './InviteView';
import { ReplyImport } from './ReplyImport';

type ReadResult = Awaited<ReturnType<typeof readMeetHash>>;
/** 해시를 남겨 새로고침을 지원하고 이전 해시의 늦은 해석 결과는 버린다. */
export function MeetLinkPage() {
  const { hash } = useLocation();
  const [state, setState] = useState<{ hash: string; result: ReadResult } | null>(null);
  useDocumentTitle('약속 링크');
  useEffect(() => {
    let active = true;
    void readMeetHash(hash).then(
      (result) => {
        if (!active) return;
        if (!result.ok) console.warn('약속 링크를 읽지 못했어요', result.reason);
        setState({ hash, result });
      },
      (error: unknown) => {
        if (!active) return;
        console.warn('약속 링크를 읽지 못했어요', error);
        setState({ hash, result: { ok: false, reason: 'corrupt' } });
      },
    );
    return () => {
      active = false;
    };
  }, [hash]);
  if (state === null || state.hash !== hash)
    return (
      <Box role="status" sx={{ p: 3 }}>
        약속 링크를 읽는 중이에요
      </Box>
    );
  if (!state.result.ok)
    return (
      <Box role="alert" sx={{ p: 3, textAlign: 'center' }}>
        <Box component="h1" sx={{ fontSize: 20 }}>
          링크를 읽지 못했어요
        </Box>
        <Button component={Link} to={paths.meetings} variant="contained" sx={{ minHeight: 44 }}>
          약속 목록으로
        </Button>
      </Box>
    );
  const doc = state.result.doc;
  return doc.kind === 'd' ? (
    <InviteView key={hash} doc={doc} />
  ) : doc.kind === 'r' ? (
    <ReplyImport key={hash} doc={doc} />
  ) : (
    <FinalView key={hash} doc={doc} />
  );
}

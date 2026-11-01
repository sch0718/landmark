import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  sameOwner,
  type AgentApi,
  type AgentFailure,
  type AgentTokenView,
} from 'src/services/agent-inbox/api';
import { getSharedSyncStorage } from 'src/services/library-sync/shared-api';
import { readSession } from 'src/services/library-sync/storage';

type Props = { open: boolean; api: AgentApi; onClose(): void; onIssued(): void };

// 닫힐 때 내부 컴포넌트를 없애 원문과 진행 중 요청의 상태를 버려요.
export function AgentTokenDialog({ open, ...props }: Props) {
  return open ? <TokenDialogContent {...props} /> : null;
}

function issueFailure(reason: AgentFailure): string {
  return reason === 'too-many'
    ? '연결은 10개까지예요. 쓰지 않는 연결을 철회해 주세요'
    : reason === 'off'
      ? '지금은 AI 연결을 쓸 수 없어요'
      : reason === 'limit'
        ? '오늘은 더 만들 수 없어요. 내일 다시 해 주세요'
        : '연결을 만들지 못했어요';
}

function TokenDialogContent({ api, onClose, onIssued }: Omit<Props, 'open'>) {
  const titleId = useId();
  const [name, setName] = useState('Claude Code');
  const [inbox, setInbox] = useState(true);
  const [share, setShare] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const run = useRef(0);
  const [sessionId] = useState(() => readSession(getSharedSyncStorage())?.sessionId ?? null);
  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );
  const currentOwner = () =>
    sameOwner(api.owner) &&
    sessionId !== null &&
    readSession(getSharedSyncStorage())?.sessionId === sessionId;
  const close = () => {
    run.current += 1;
    const issued = token !== null;
    setToken(null);
    onClose();
    if (issued) onIssued();
  };
  const validName = name.trim().length >= 1 && name.trim().length <= 40;
  const issue = async () => {
    if (!validName || (!inbox && !share) || busyRef.current || !currentOwner()) return;
    const request = ++run.current;
    const current = () => request === run.current && currentOwner();
    busyRef.current = true;
    // 만들기 단추가 꺼져도 키보드 초점은 창 안에 남겨요.
    closeButton.current?.focus();
    setBusy(true);
    setError(null);
    const scopes: AgentTokenView['scopes'] = [
      ...(inbox ? ['inbox:write' as const] : []),
      ...(share ? ['share:create' as const] : []),
    ];
    try {
      const result = await api.issue({ name: name.trim(), scopes });
      if (!current()) return;
      if (result.ok) setToken(result.data.token);
      else setError(issueFailure(result.reason));
    } catch {
      if (current()) setError('연결을 만들지 못했어요');
    } finally {
      if (current()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const copy = async () => {
    if (token === null || !currentOwner()) return;
    const request = run.current;
    try {
      await navigator.clipboard.writeText(token);
      if (request === run.current && currentOwner()) {
        setError(null);
        toast('복사했어요');
      }
    } catch {
      if (request === run.current && currentOwner())
        setError('복사하지 못했어요. 토큰을 직접 복사해 주세요');
    }
  };
  return (
    <Dialog
      open
      onClose={() => {
        if (token === null) close();
      }}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle id={titleId}>새 AI 연결</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {token === null ? (
            <>
              <TextField
                label="이름"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                error={!validName}
                helperText={!validName ? '이름은 1~40자로 적어 주세요' : undefined}
                fullWidth
              />
              <FormControlLabel
                label="받은함으로 일정 보내기"
                control={
                  <Checkbox
                    checked={inbox}
                    disabled={busy}
                    onChange={(_, value) => setInbox(value)}
                    sx={{ minHeight: 44, minWidth: 44 }}
                  />
                }
              />
              <FormControlLabel
                label="공유 짧은 링크 만들기"
                control={
                  <Checkbox
                    checked={share}
                    disabled={busy}
                    onChange={(_, value) => setShare(value)}
                    sx={{ minHeight: 44, minWidth: 44 }}
                  />
                }
              />
            </>
          ) : (
            <>
              <TextField
                label="연결 토큰"
                value={token}
                inputProps={{ readOnly: true }}
                fullWidth
              />
              <Button onClick={() => void copy()} sx={{ minHeight: 44 }}>
                복사
              </Button>
              <Typography
                component="code"
                variant="body2"
                sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
              >{`security add-generic-password -U -s landmark-agent-token -a ${location.host} -w`}</Typography>
              <Typography variant="body2">
                이 창을 닫으면 다시 볼 수 없어요. 잃어버렸다면 철회하고 새로 만들어 주세요
              </Typography>
            </>
          )}
          {error && (
            <Typography role="alert" variant="body2" color="error">
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button ref={closeButton} onClick={close} sx={{ minHeight: 44 }}>
          닫기
        </Button>
        {token === null && (
          <Button
            onClick={() => void issue()}
            disabled={!validName || (!inbox && !share) || busy}
            sx={{ minHeight: 44 }}
          >
            만들기
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

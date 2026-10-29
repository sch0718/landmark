import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createSyncApi } from 'src/services/library-sync/api';
import { readSyncClientConfig } from 'src/services/library-sync/config';
import { takeCapturedCallback } from 'src/services/library-sync/callback-capture';
import { finishSocialLogin, deviceLabel, type LoginOutcome } from 'src/services/library-sync/login';
import { loadSyncEngine } from 'src/services/library-sync/boot';
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<LoginOutcome | null>(null);
  const task = useRef<Promise<LoginOutcome> | null>(null);
  useEffect(() => {
    let live = true;
    if (!task.current) {
      const config = readSyncClientConfig(import.meta.env, location.origin);
      task.current = config
        ? finishSocialLogin(
            createSyncApi({ config, storage: localStorage, auth: null }),
            takeCapturedCallback() ?? location.href,
            localStorage,
            deviceLabel(navigator.userAgent),
          )
        : Promise.resolve({ ok: false, reason: 'off' });
    }
    void task.current
      .then(async (result) => {
        if (!live) return;
        if (result.ok) {
          if (result.next === 'resume') {
            const m = await loadSyncEngine();
            if (!live) return;
            m.ensureLibrarySyncEngine().start();
          }
          const target = localStorage.getItem('tripmap:sync-return');
          localStorage.removeItem('tripmap:sync-return');
          navigate(
            target?.startsWith('/') && !target.startsWith('//') ? target : '/settings#sync',
            { replace: true },
          );
        } else setOutcome(result);
      })
      .catch(() => {
        if (live) setOutcome({ ok: false, reason: 'server' });
      });
    return () => {
      live = false;
    };
  }, [navigate]);
  let text = '로그인하는 중…';
  let account: string | undefined;
  if (outcome && !outcome.ok) {
    const reason = outcome.reason;
    text =
      reason === 'not-allowed'
        ? '이 계정은 아직 동기화를 쓸 수 없어요'
        : reason === 'cancelled'
          ? '로그인을 취소했어요'
          : ['mismatch', 'no-pending', 'expired'].includes(reason)
            ? '이 브라우저에서 시작한 로그인이 아니거나 시간이 지났어요. 다시 로그인해 주세요'
            : reason === 'off'
              ? '지금은 동기화를 쓸 수 없어요'
              : reason === 'storage'
                ? '브라우저 저장소를 쓸 수 없어 로그인하지 못했어요'
                : '잠시 뒤 다시 해 주세요';
    if (reason === 'not-allowed') account = outcome.account ?? outcome.email;
  }
  return (
    <Box sx={{ p: 3, display: 'grid', gap: 2 }}>
      <Typography>{text}</Typography>
      {account && (
        <>
          <Typography>{account}</Typography>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(account).catch(() => {});
            }}
          >
            복사
          </Button>
          <Typography>관리자에게 이 값을 알려 주세요</Typography>
        </>
      )}
      {outcome && !outcome.ok && (
        <Button component={Link} to="/settings#sync">
          설정으로 돌아가기
        </Button>
      )}
    </Box>
  );
}

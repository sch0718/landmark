import { injectShareDoc, shareFileName } from '../domain/share/inject';
import type { LiveTripDoc } from '../domain/trip-live/live-doc';
import { createLivePoll, fetchLive } from './live';
import { showShareDoc } from './show';
export const LIVE_TEXT = {
  loading: '갱신되는 일정을 불러오는 중이에요',
  watching: (hhmm: string) => `보낸 사람이 일정을 고치면 이 화면도 바뀌어요 · ${hhmm} 확인`,
  changed: (hhmm: string) => `일정이 바뀌었어요 · ${hhmm}`,
  failing: (hhmm: string) => `연결이 원활하지 않아요 · ${hhmm} 기준`,
  revoked: '보낸 사람이 이 링크를 닫았어요. 새 링크를 받아 주세요',
  ended: '공유가 끝난 일정이에요',
  busy: '잠시 뒤 다시 열어 주세요',
  firstFailed: '일정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요',
  retry: '다시 시도',
  save: '파일로 저장',
  saveFailed: '파일을 만들지 못했어요. 잠시 뒤 다시 해 주세요',
  keepHint: '마지막 일정은 파일로 저장할 수 있어요',
};
export async function startLiveViewer(
  root: HTMLElement,
  live: { id: string; token: string },
  deps: { fetch?: typeof fetch; win?: Window; now?: () => Date } = {},
): Promise<{ stop(): void }> {
  const win = deps.win ?? window,
    d = root.ownerDocument,
    fetcher = deps.fetch ?? fetch,
    now = deps.now ?? (() => new Date());
  let stopped = false,
    poll: { stop(): void } | undefined,
    shown: ReturnType<typeof showShareDoc> | undefined,
    current: LiveTripDoc,
    rev = 0,
    checked = '';
  const clock = () =>
    now().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const bar = d.createElement('div'),
    message = d.createElement('p'),
    save = d.createElement('button');
  bar.className = 'live-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  save.type = 'button';
  save.textContent = LIVE_TEXT.save;
  bar.append(message, save);
  save.addEventListener('click', () => {
    void (async () => {
      try {
        const response = await fetcher('/share-viewer.html');
        if (!response.ok) throw Error();
        const html = injectShareDoc(await response.text(), current.share),
          url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        try {
          const a = d.createElement('a');
          a.href = url;
          a.download = shareFileName(current.share.title, now());
          a.click();
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        const p = d.createElement('p');
        p.textContent = LIVE_TEXT.saveFailed;
        bar.append(p);
      }
    })();
  });
  function draw(doc: LiveTripDoc) {
    const tab = shown?.currentTab();
    shown?.stop();
    current = doc;
    shown = showShareDoc(root, doc.share, {
      app: win.location.origin,
      initialTab: tab ?? undefined,
    });
    root.prepend(bar);
  }
  async function load() {
    if (stopped) return;
    root.textContent = LIVE_TEXT.loading;
    const result = await fetchLive(live.id, live.token, null, fetcher);
    if (stopped) return;
    if (result.kind !== 'doc') {
      root.textContent =
        result.kind === 'revoked'
          ? LIVE_TEXT.revoked
          : result.kind === 'ended'
            ? LIVE_TEXT.ended
            : result.kind === 'busy'
              ? LIVE_TEXT.busy
              : LIVE_TEXT.firstFailed;
      if (result.kind === 'failed') {
        const retry = d.createElement('button');
        retry.textContent = LIVE_TEXT.retry;
        retry.addEventListener('click', () => void load());
        root.append(retry);
      }
      return;
    }
    rev = result.rev;
    checked = clock();
    draw(result.doc);
    message.textContent = LIVE_TEXT.watching(checked);
    poll = createLivePoll({
      win,
      tick: async () => {
        const next = await fetchLive(live.id, live.token, rev, fetcher);
        if (stopped) return 'stop';
        if (next.kind === 'doc') {
          rev = next.rev;
          checked = clock();
          draw(next.doc);
          message.textContent = LIVE_TEXT.changed(checked);
          return 'ok';
        }
        if (next.kind === 'unchanged') {
          checked = clock();
          message.textContent = LIVE_TEXT.watching(checked);
          return 'ok';
        }
        if (next.kind === 'revoked' || next.kind === 'ended') {
          message.textContent = `${LIVE_TEXT[next.kind]} ${LIVE_TEXT.keepHint}`;
          return 'stop';
        }
        message.textContent = LIVE_TEXT.failing(checked);
        return 'error';
      },
    });
  }
  await load();
  return {
    stop() {
      stopped = true;
      poll?.stop();
      shown?.stop();
    },
  };
}

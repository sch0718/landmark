type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      execution: 'execute';
      callback(token: string): void;
      'error-callback'(): void;
      'expired-callback'(): void;
      'timeout-callback'(): void;
    },
  ): string;
  execute(id: string): void;
  remove(id: string): void;
};
const TIMEOUT = 30_000;
let loading: Promise<Turnstile> | null = null;
const readApi = () => (window as Window & { turnstile?: Turnstile }).turnstile;

function load(): Promise<Turnstile> {
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    const timer = setTimeout(fail, TIMEOUT);
    function cleanup() {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    }
    function fail() {
      cleanup();
      script.remove();
      loading = null;
      reject(new Error('확인 도구를 불러오지 못했어요'));
    }
    script.onload = () => {
      const api = readApi();
      if (!api) {
        fail();
        return;
      }
      cleanup();
      resolve(api);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

/** 약속을 올릴 때만 외부 도구를 불러온다. 로딩·위젯을 합쳐 30초까지 기다린다. */
export async function getTurnstileToken(): Promise<string> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (!sitekey) return 'dev';
  const started = Date.now();
  const api = await load();
  const remaining = TIMEOUT - (Date.now() - started);
  if (remaining <= 0) throw new Error('확인 시간이 지났어요');
  return new Promise<string>((resolve, reject) => {
    const container = document.createElement('div');
    container.dataset.meetTurnstile = '';
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    document.body.append(container);
    let widgetId: string | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(), remaining);
    function finish(value?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (widgetId !== undefined) api.remove(widgetId);
      container.remove();
      if (value) resolve(value);
      else reject(new Error('확인에 실패했어요. 다시 해 주세요'));
    }
    try {
      widgetId = api.render(container, {
        sitekey,
        // 보이지 않는 방식은 Cloudflare에서 이 사이트 키의 위젯 모드로 정한다.
        execution: 'execute',
        callback: (value) => finish(value),
        'error-callback': () => finish(),
        'expired-callback': () => finish(),
        'timeout-callback': () => finish(),
      });
      if (settled) api.remove(widgetId);
      else api.execute(widgetId);
    } catch {
      finish();
    }
  });
}

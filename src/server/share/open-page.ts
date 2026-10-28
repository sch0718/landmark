// `/s/<id>`가 돌려주는 작은 HTML. 보기 화면 번들을 쓰지 않고, 링크의 `#k=` 키로 암호문을 풀어
// 앱의 `viewLink`와 같은 해시를 만든 뒤 `/view#d=…`로 옮긴다. 키는 해시에만 있어 서버로 오지 않는다.

export const OPEN_TEXT = {
  opening: '여는 중…',
  broken: '링크가 온전하지 않아요. 보낸 사람에게 링크를 다시 받아 주세요',
  unsupported: '이 브라우저에서는 열 수 없어요. 다른 브라우저로 열어 주세요',
  noscript: '이 링크는 JavaScript가 필요해요.',
  notFound:
    '링크를 찾을 수 없어요. 지워졌거나 기한이 지났어요. 보낸 사람에게 다시 보내 달라고 해 주세요',
  ended: '링크 기한이 지났어요. 보낸 사람에게 다시 보내 달라고 해 주세요',
  busy: '잠시 뒤 다시 열어 주세요',
  unavailable:
    '잠시 뒤 다시 열어 주세요. 계속 안 되면 보낸 사람에게 다른 방법으로 보내 달라고 해 주세요',
} as const;

// 인라인 스크립트는 CSP 해시로만 실행을 허락한다. 문구는 JSON으로 넣어 따옴표가 깨지지 않게 한다.
export const OPEN_SCRIPT = `(async () => {
  const say = (text) => { document.getElementById('m').textContent = text; };
  const bytes = (value) => {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  try {
    const key = new URLSearchParams(location.hash.slice(1)).get('k');
    if (!key || !/^[A-Za-z0-9_-]{22}$/.test(key)) return say(${JSON.stringify(OPEN_TEXT.broken)});
    if (!window.crypto || !crypto.subtle) return say(${JSON.stringify(OPEN_TEXT.unsupported)});
    const sealed = bytes(JSON.parse(document.getElementById('c').textContent));
    const aes = await crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, aes, sealed.slice(12)),
    );
    let bin = '';
    for (const b of plain) bin += String.fromCharCode(b);
    const hash = btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    location.replace('/view#d=' + hash);
  } catch {
    say(${JSON.stringify(OPEN_TEXT.broken)});
  }
})();`;

const STYLE = `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:16px/1.6 system-ui,-apple-system,sans-serif;background:#fff;color:#222;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}a{color:#9ecbff}}
main{max-width:420px;text-align:center}`;

let scriptHash: Promise<string> | null = null;
function openScriptHash(): Promise<string> {
  scriptHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(OPEN_SCRIPT))
    .then((digest) => btoa(String.fromCharCode(...new Uint8Array(digest))));
  return scriptHash;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Landmark</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

function headers(csp: string): Headers {
  return new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': csp,
  });
}

const BASE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** 암호문(base64url 글자만)을 데이터 블록에 넣는다. 데이터 블록은 실행되지 않는다. */
export async function openPageResponse(body: string): Promise<Response> {
  const html = page(
    `<p id="m">${OPEN_TEXT.opening}</p><noscript><p>${OPEN_TEXT.noscript}</p></noscript>` +
      `<script type="application/json" id="c">${JSON.stringify(body)}</script>` +
      `<script>${OPEN_SCRIPT}</script>`,
  );
  return new Response(html, {
    status: 200,
    headers: headers(`${BASE_CSP}; script-src 'sha256-${await openScriptHash()}'`),
  });
}

export function messagePageResponse(status: number, text: string): Response {
  return new Response(page(`<p>${escapeHtml(text)}</p><p><a href="/">Landmark 열기</a></p>`), {
    status,
    headers: headers(BASE_CSP),
  });
}

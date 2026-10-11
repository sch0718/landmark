import type { Plugin } from 'vite';

/**
 * 보기 화면을 파일 하나로 만든다: HTML이 가리키는 모듈 스크립트와 스타일시트를 HTML 안에 넣고
 * 그 청크·자산을 번들에서 지운다(결과 폴더에 다른 파일이 남지 않는다).
 * 치환은 함수 replacer로 한다(코드 안의 `$&` 같은 문자열이 치환 패턴으로 해석되지 않게).
 */

type Entry =
  | { type: 'asset'; fileName: string; source: string | Uint8Array }
  | { type: 'chunk'; fileName: string; code: string };

const SCRIPT_TAG = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
const STYLESHEET_TAG = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g;

/** `./assets/a.js`·`/assets/a.js` → 번들 키 `assets/a.js`. */
function bundleKey(url: string): string {
  return url.replace(/^\.?\//, '');
}

function textOf(entry: Entry): string {
  if (entry.type === 'chunk') return entry.code;
  return typeof entry.source === 'string' ? entry.source : new TextDecoder().decode(entry.source);
}

export function inlineAssets(options: { fileName?: string } = {}): Plugin {
  return {
    name: 'tripmap:inline-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle(_output, bundle) {
      const entries = bundle as unknown as Record<string, Entry>;
      const used = new Set<string>();
      const take = (url: string): string | null => {
        const key = bundleKey(url);
        const entry = entries[key];
        if (entry === undefined) return null;
        used.add(key);
        return textOf(entry);
      };

      const htmlKeys = Object.keys(entries).filter((k) => k.endsWith('.html'));
      for (const key of htmlKeys) {
        const html = entries[key];
        if (html?.type !== 'asset') continue;
        const source = textOf(html)
          .replace(SCRIPT_TAG, (tag, src: string) => {
            const code = take(src);
            if (code === null) return tag;
            // 코드 안의 `</script`가 태그를 끝내지 않게 한다(문자열·정규식 안에서는 같은 뜻이다).
            return `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`;
          })
          .replace(STYLESHEET_TAG, (tag, href: string) => {
            const css = take(href);
            if (css === null) return tag;
            return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
          });
        html.source = source;
      }

      for (const key of used) delete bundle[key];

      // 결과 이름 바꾸기: HTML이 하나일 때만 의미가 있다. Rolldown은 `bundle`에 새 키를 넣는 것을
      // 무시하므로(지우기는 된다) 원래 것을 지우고 `emitFile`로 다시 낸다.
      if (options.fileName !== undefined && htmlKeys.length === 1) {
        const [key] = htmlKeys;
        const html = key === undefined ? undefined : entries[key];
        if (key !== undefined && html !== undefined && key !== options.fileName) {
          delete bundle[key];
          this.emitFile({ type: 'asset', fileName: options.fileName, source: textOf(html) });
        }
      }
    },
  };
}

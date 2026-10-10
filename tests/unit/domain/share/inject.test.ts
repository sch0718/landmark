import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  injectShareDoc,
  serializeShareDoc,
  shareFileName,
  SHARE_DATA_PLACEHOLDER,
} from 'src/domain/share/inject';
import type { ShareDoc } from 'src/schema/share';

const TEMPLATE =
  '<!doctype html><html><head><script type="application/json" id="tripmap-share">__TRIPMAP_DATA__</script></head><body></body></html>';

/** 소스에 U+2028/U+2029를 리터럴로 쓰지 않으려고 코드로 만든다. */
const LS_PS = String.fromCharCode(0x2028, 0x2029);

function makeDoc(overrides: { memo?: string; name?: string } = {}): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '강릉 여행',
    createdAt: '2026-10-11T03:04:05.678Z',
    labels: [{ id: 'l1', name: '맛집', color: 'red', order: 0 }],
    places: [
      {
        id: 'p1',
        name: overrides.name ?? '카페',
        address: '강원 강릉시',
        lng: 128.9,
        lat: 37.75,
        labelIds: ['l1'],
        ...(overrides.memo === undefined ? {} : { memo: overrides.memo }),
      },
    ],
  };
}

describe('serializeShareDoc', () => {
  it('contains no raw <, U+2028, U+2029', () => {
    const doc = makeDoc({ memo: `</script><!-- ${LS_PS}`, name: '<b>x</b>' });
    expect(new RegExp('[<\\u2028\\u2029]').test(serializeShareDoc(doc))).toBe(false);
  });

  it('escapes with 6-character backslash-u sequences', () => {
    const out = serializeShareDoc(makeDoc({ memo: `<${LS_PS}` }));
    expect(out).toContain('\\u003c\\u2028\\u2029');
  });

  it('round-trips through JSON.parse', () => {
    const doc = makeDoc({ memo: `a<b${LS_PS}c` });
    expect(JSON.parse(serializeShareDoc(doc))).toEqual(doc);
  });
});

describe('injectShareDoc', () => {
  it('blocks script injection from user strings', () => {
    const doc = makeDoc({
      memo: `</script><script>window.__injected = 1</script><!-- ${LS_PS}`,
    });
    const html = injectShareDoc(TEMPLATE, doc);
    const dom = new JSDOM(html, { runScripts: 'dangerously' });
    const { document } = dom.window;
    const block = document.getElementById('tripmap-share')!;

    expect(block.textContent).not.toContain('<');
    expect(document.scripts.length).toBe(1);
    expect((dom.window as unknown as { __injected?: unknown }).__injected).toBeUndefined();
    expect(JSON.parse(block.textContent!)).toEqual(doc);
  });

  it('throws when the placeholder is missing or repeated', () => {
    const doc = makeDoc();
    expect(() => injectShareDoc('<html></html>', doc)).toThrow();
    expect(() =>
      injectShareDoc(`${SHARE_DATA_PLACEHOLDER} ${SHARE_DATA_PLACEHOLDER}`, doc),
    ).toThrow();
  });

  it('does not treat $ patterns in data as replacement tokens', () => {
    const doc = makeDoc({ name: '$& $1 $$' });
    const html = injectShareDoc(TEMPLATE, doc);
    const dom = new JSDOM(html);
    const parsed = JSON.parse(dom.window.document.getElementById('tripmap-share')!.textContent!);
    expect(parsed.places[0].name).toBe('$& $1 $$');
  });
});

describe('shareFileName', () => {
  const NOW = new Date(2026, 9, 11, 12, 0);

  it('joins words with a hyphen and appends the local date', () => {
    expect(shareFileName('정자역 카페', NOW)).toBe('정자역-카페-20261011.html');
  });

  it('replaces forbidden characters and collapses hyphens', () => {
    expect(shareFileName('a/b:c*?"<>|d', NOW)).toBe('a-b-c-d-20261011.html');
  });

  it('falls back to trip-map for blank titles', () => {
    expect(shareFileName('   ', NOW)).toBe('trip-map-20261011.html');
  });

  it('trims leading and trailing hyphens and dots', () => {
    expect(shareFileName('..이름..', NOW)).toBe('이름-20261011.html');
  });

  it('cuts the title to 40 characters', () => {
    expect(shareFileName('가'.repeat(50), NOW)).toBe(`${'가'.repeat(40)}-20261011.html`);
  });

  it('cuts by code point so surrogate pairs stay intact', () => {
    const emoji = String.fromCodePoint(0x1f600);
    const name = shareFileName(emoji.repeat(41), NOW);
    expect(name).toBe(`${emoji.repeat(40)}-20261011.html`);
  });

  it('uses the local date', () => {
    expect(shareFileName('x', new Date(2026, 9, 11, 23, 59))).toBe('x-20261011.html');
  });
});

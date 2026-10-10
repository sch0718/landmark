import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareDoc, SharePlace } from 'src/schema/share';
import {
  applyTheme,
  naverUrl,
  renderBroken,
  renderViewer,
  type MapPort,
} from 'src/share-viewer/render';

function place(over: Partial<SharePlace> & { id: string }): SharePlace {
  return {
    name: `장소 ${over.id}`,
    address: '경기 성남시 분당구 정자동 1',
    lng: 127.1,
    lat: 37.36,
    labelIds: [],
    ...over,
  };
}

function makeDoc(over: Partial<ShareDoc> = {}): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '정자역 카페',
    createdAt: '2026-10-11T03:00:00.000Z',
    labels: [
      { id: 'l1', name: '카페', color: 'orange', order: 0 },
      { id: 'l2', name: '빵집', color: 'blue', order: 1 },
    ],
    places: [
      place({ id: 'a', name: '서혜커피', labelIds: ['l1'], naverSid: '123', memo: '크로플\n맛집' }),
      place({ id: 'b', name: '빵집B', labelIds: ['l2'] }),
      place({ id: 'c', name: '카페C', labelIds: ['l1', 'l2'] }),
    ],
    ...over,
  };
}

let root: HTMLElement;
let map: { focus: ReturnType<typeof vi.fn>; filter: ReturnType<typeof vi.fn> };

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root')!;
  map = { focus: vi.fn(), filter: vi.fn() };
  Element.prototype.scrollIntoView = vi.fn();
});

function mount(doc: ShareDoc) {
  return renderViewer(root, doc, map as unknown as MapPort);
}

const card = (id: string) => root.querySelector<HTMLElement>(`article[data-place-id="${id}"]`)!;
const chipsOf = () => [...root.querySelectorAll<HTMLButtonElement>('[role=group] button')];

describe('머리글', () => {
  it('제목·부제·document.title', () => {
    mount(makeDoc());
    expect(root.querySelector('header h1')!.textContent).toBe('정자역 카페');
    const d = new Date('2026-10-11T03:00:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    expect(root.querySelector('header p')!.textContent).toBe(`${local} · 3곳`);
    expect(document.title).toBe('정자역 카페');
  });

  it('createdAt이 로컬 날짜로 나온다', () => {
    mount(makeDoc({ createdAt: '2026-10-11T12:00:00.000Z' }));
    expect(root.querySelector('header p')!.textContent).toMatch(/^2026\.10\.1[12] · 3곳$/);
  });

  it('바닥글·지도 자리', () => {
    mount(makeDoc());
    expect(root.querySelector('footer')!.textContent).toBe('trip-map에서 만든 파일');
    expect(root.querySelector('div#map')).not.toBeNull();
  });
});

describe('장소 카드', () => {
  it('카드 수·이름·주소·라벨 칩', () => {
    mount(makeDoc());
    const items = root.querySelectorAll('ul[aria-label="장소 목록"] > li > article[data-place-id]');
    expect(items).toHaveLength(3);
    expect(card('a').querySelector('h2')!.textContent).toBe('서혜커피');
    expect(card('a').querySelector('p:not(.memo)')!.textContent).toBe(
      '경기 성남시 분당구 정자동 1',
    );
    expect([...card('c').querySelectorAll('span')].map((s) => s.textContent)).toEqual([
      '카페',
      '빵집',
    ]);
  });

  it('메모가 있을 때만 p.memo를 만든다', () => {
    mount(makeDoc());
    expect(card('a').querySelector('p.memo')!.textContent).toBe('크로플\n맛집');
    expect(card('b').querySelector('p.memo')).toBeNull();
  });

  it('이름·메모의 태그는 글자로 보인다', () => {
    mount(
      makeDoc({
        places: [place({ id: 'x', name: '<b>x</b>', memo: '<b>y</b>' })],
        labels: [],
      }),
    );
    expect(root.querySelector('b')).toBeNull();
    expect(card('x').querySelector('h2')!.textContent).toBe('<b>x</b>');
    expect(card('x').querySelector('p.memo')!.textContent).toBe('<b>y</b>');
  });

  it('링크는 새 탭으로 열린다', () => {
    mount(makeDoc());
    const a = card('a').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://map.naver.com/p/entry/place/123');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe('네이버 지도에서 보기');
  });

  it('300곳도 그린다', () => {
    const places = Array.from({ length: 300 }, (_, i) => place({ id: `p${i}` }));
    mount(makeDoc({ places, labels: [] }));
    expect(root.querySelectorAll('article[data-place-id]')).toHaveLength(300);
  });
});

describe('naverUrl', () => {
  it('sid가 있으면 장소 주소', () => {
    expect(naverUrl(place({ id: 'a', naverSid: '123' }))).toBe(
      'https://map.naver.com/p/entry/place/123',
    );
  });

  it('sid가 없으면 이름+주소 검색', () => {
    const p = place({ id: 'a', name: '서혜커피', address: '경기 성남시 분당구' });
    expect(naverUrl(p)).toBe(
      'https://map.naver.com/p/search/' + encodeURIComponent('서혜커피 경기 성남시 분당구'),
    );
  });

  it('주소가 비면 이름만', () => {
    expect(naverUrl(place({ id: 'a', name: '서혜커피', address: '' }))).toBe(
      'https://map.naver.com/p/search/' + encodeURIComponent('서혜커피'),
    );
  });
});

describe('라벨 칩', () => {
  it('라벨이 1개면 칩 줄이 없다', () => {
    mount(makeDoc({ labels: [{ id: 'l1', name: '카페', color: 'orange', order: 0 }] }));
    expect(root.querySelector('[role=group]')).toBeNull();
  });

  it('라벨이 없으면 칩 줄이 없다', () => {
    mount(makeDoc({ labels: [] }));
    expect(root.querySelector('[role=group]')).toBeNull();
  });

  it('2개 이상이면 "모두" + 라벨 칩', () => {
    mount(makeDoc());
    const group = root.querySelector('[role=group]')!;
    expect(group.getAttribute('aria-label')).toBe('라벨');
    expect(chipsOf().map((b) => b.textContent)).toEqual(['모두', '카페', '빵집']);
    expect(chipsOf().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('칩을 누르면 그 라벨의 장소만 보이고 지도에 알린다', () => {
    mount(makeDoc());
    chipsOf()[1]!.click();
    expect(card('a').closest('li')!.hidden).toBe(false);
    expect(card('b').closest('li')!.hidden).toBe(true);
    expect(card('c').closest('li')!.hidden).toBe(false);
    expect(map.filter).toHaveBeenLastCalledWith(['a', 'c']);
    expect(chipsOf().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('"모두"를 누르면 전부 보인다', () => {
    mount(makeDoc());
    chipsOf()[2]!.click();
    chipsOf()[0]!.click();
    expect(root.querySelectorAll('li[hidden]')).toHaveLength(0);
    expect(map.filter).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });

  it('눌려 있는 칩을 다시 누르면 "모두"로 돌아간다', () => {
    mount(makeDoc());
    chipsOf()[1]!.click();
    chipsOf()[1]!.click();
    expect(root.querySelectorAll('li[hidden]')).toHaveLength(0);
    expect(map.filter).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });
});

describe('카드 동작', () => {
  it('카드를 누르면 지도가 이동하고 강조된다(이전 강조는 해제)', () => {
    mount(makeDoc());
    card('a').click();
    expect(map.focus).toHaveBeenLastCalledWith('a');
    expect(card('a').getAttribute('aria-current')).toBe('true');
    card('b').click();
    expect(map.focus).toHaveBeenLastCalledWith('b');
    expect(card('b').getAttribute('aria-current')).toBe('true');
    expect(card('a').hasAttribute('aria-current')).toBe(false);
  });

  it('카드 안 링크를 눌러도 지도는 움직이지 않는다', () => {
    mount(makeDoc());
    const a = card('a').querySelector('a')!;
    // jsdom은 새 탭 이동을 구현하지 않으므로 기본 동작만 막고 클릭 이벤트를 흘려 본다.
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    expect(map.focus).not.toHaveBeenCalled();
    expect(card('a').hasAttribute('aria-current')).toBe(false);
  });

  it('카드에서 Enter를 누르면 눌렀을 때와 같다', () => {
    mount(makeDoc());
    card('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(map.focus).toHaveBeenLastCalledWith('b');
  });

  it('highlight(id)는 카드를 강조하고 스크롤한다', () => {
    const view = mount(makeDoc());
    view.highlight('b');
    expect(card('b').getAttribute('aria-current')).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(map.focus).not.toHaveBeenCalled();
    view.highlight('c');
    expect(card('b').hasAttribute('aria-current')).toBe(false);
    expect(card('c').getAttribute('aria-current')).toBe('true');
  });

  it('없는 id는 조용히 넘긴다', () => {
    const view = mount(makeDoc());
    expect(() => view.highlight('zzz')).not.toThrow();
  });
});

describe('renderBroken', () => {
  it('안내 문구만 보인다', () => {
    mount(makeDoc());
    renderBroken(root);
    expect(root.textContent).toBe('파일 내용을 읽지 못했어요');
    expect(root.querySelector('article')).toBeNull();
  });
});

describe('applyTheme', () => {
  it('라이트 토큰과 다크 미디어 쿼리를 style로 넣는다', () => {
    applyTheme(document);
    const css = document.head.querySelector('style')!.textContent!;
    expect(css).toContain(':root{');
    expect(css).toContain('--tm-bg-base:#FAFAF7');
    expect(css).toContain('--tm-label-orange-fill:#FFE3C4');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--tm-bg-base:#111113');
  });
});

describe('styles.css', () => {
  const css = readFileSync('src/share-viewer/styles.css', 'utf8');

  it('메모는 줄바꿈을 살린다', () => {
    expect(css).toMatch(/\.memo\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it('토큰 값을 복제하지 않고 변수만 읽는다', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

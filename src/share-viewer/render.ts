import { LABEL_COLORS } from 'src/schema/label-colors';
import type { ShareDoc, ShareLabel, SharePlace } from 'src/schema/share';
import { pastel } from 'src/theme/tokens/pastel';
import type { Tokens } from 'src/theme/tokens';

/**
 * 보기 화면 그리기. 사용자 문자열은 `textContent`·속성 값으로만 DOM에 넣는다(`innerHTML` 금지).
 * 지도는 이 파일이 모른다: 호출하는 쪽이 넘기는 `MapPort`로만 알린다.
 */

export type MapPort = {
  focus(placeId: string | null): void;
  filter(placeIds: string[]): void;
};

/** 앱의 `--tm-*` 변수 이름과 같은 규칙으로 토큰을 펼친다(`create-app-theme.ts`와 같은 이름). */
function cssVarsOf(t: Tokens): string {
  const vars: Record<string, string> = {
    '--tm-bg-base': t.bg.base,
    '--tm-bg-surface': t.bg.surface,
    '--tm-bg-raised': t.bg.raised,
    '--tm-text-primary': t.text.primary,
    '--tm-text-secondary': t.text.secondary,
    '--tm-text-muted': t.text.muted,
    '--tm-border': t.border,
    '--tm-accent-main': t.accent.main,
    '--tm-accent-contrast': t.accent.contrast,
    '--tm-accent-text': t.accent.text,
    '--tm-radius-sm': `${t.radius.sm}px`,
    '--tm-radius-md': `${t.radius.md}px`,
    '--tm-radius-lg': `${t.radius.lg}px`,
    '--tm-shadow-1': t.shadow[1],
    '--tm-shadow-2': t.shadow[2],
    '--tm-font-body': t.font.body,
  };
  for (const color of LABEL_COLORS) {
    const { fill, text } = t.label[color];
    vars[`--tm-label-${color}-fill`] = fill;
    vars[`--tm-label-${color}-text`] = text;
  }
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** 파스텔 라이트 토큰을 `:root`에, 다크 토큰을 `prefers-color-scheme: dark`에 넣는다(값을 CSS에 복제하지 않는다). */
export function applyTheme(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent =
    `:root{color-scheme:light dark;${cssVarsOf(pastel.light)}}` +
    `@media (prefers-color-scheme: dark){:root{${cssVarsOf(pastel.dark)}}}`;
  doc.head.append(style);
}

/** 네이버 지도에서 장소를 여는 주소. sid가 있으면 장소 페이지, 없으면 이름+주소 검색. 값은 늘 인코딩한다. */
export function naverUrl(place: SharePlace): string {
  if (place.naverSid !== undefined) {
    return `https://map.naver.com/p/entry/place/${encodeURIComponent(place.naverSid)}`;
  }
  const query = place.address === '' ? place.name : `${place.name} ${place.address}`;
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function labelChip(doc: Document, label: ShareLabel): HTMLSpanElement {
  const chip = el(doc, 'span', label.name, 'chip');
  chip.dataset.color = label.color;
  return chip;
}

/** `2026.10.11`(로컬 날짜). 해석할 수 없는 값이면 빈 문자열. */
function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function renderViewer(
  root: HTMLElement,
  doc: ShareDoc,
  map: MapPort,
): { highlight(placeId: string): void } {
  const d = root.ownerDocument;
  d.title = doc.title;
  root.replaceChildren();

  const labels = [...doc.labels].sort((a, b) => a.order - b.order);
  const labelById = new Map(labels.map((l) => [l.id, l]));

  // 머리글
  const header = el(d, 'header');
  header.append(el(d, 'h1', doc.title));
  const date = localDate(doc.createdAt);
  header.append(
    el(d, 'p', date === '' ? `${doc.places.length}곳` : `${date} · ${doc.places.length}곳`),
  );
  root.append(header);

  // 지도 자리와 목록
  const main = el(d, 'main');
  const mapSlot = el(d, 'div');
  mapSlot.id = 'map';
  const list = el(d, 'ul');
  list.setAttribute('aria-label', '장소 목록');

  const cards = new Map<string, HTMLElement>();
  const items = new Map<string, HTMLLIElement>();
  let current: HTMLElement | null = null;

  function mark(placeId: string): HTMLElement | null {
    const next = cards.get(placeId) ?? null;
    if (current !== null) current.removeAttribute('aria-current');
    current = next;
    if (next !== null) next.setAttribute('aria-current', 'true');
    return next;
  }

  for (const place of doc.places) {
    const li = el(d, 'li');
    const article = el(d, 'article');
    article.dataset.placeId = place.id;
    article.tabIndex = 0;

    article.append(el(d, 'h2', place.name));
    // 앱과 같이 장소의 labelIds 순서로 보인다(첫 라벨이 대표 — 마커 색도 이것을 쓴다).
    const placeLabels = place.labelIds
      .map((id) => labelById.get(id))
      .filter((l): l is ShareLabel => l !== undefined);
    if (placeLabels.length > 0) {
      const chips = el(d, 'div', undefined, 'chips');
      for (const label of placeLabels) chips.append(labelChip(d, label));
      article.append(chips);
    }
    article.append(el(d, 'p', place.address, 'address'));
    // 메모는 줄바꿈을 살린다(`white-space: pre-wrap`은 .memo에 있다). 링크로 바꾸지 않는다.
    if (place.memo !== undefined) article.append(el(d, 'p', place.memo, 'memo'));
    const link = el(d, 'a', '네이버 지도에서 보기');
    link.href = naverUrl(place);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    article.append(link);

    // 링크를 눌렀을 때는 카드 동작(지도 이동)을 하지 않는다. 키보드는 카드 자체에서 온 것만 받는다.
    article.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a') !== null) return;
      mark(place.id);
      map.focus(place.id);
    });
    article.addEventListener('keydown', (event) => {
      if (event.target !== article) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      mark(place.id);
      map.focus(place.id);
    });

    cards.set(place.id, article);
    items.set(place.id, li);
    li.append(article);
    list.append(li);
  }

  // 라벨 칩 줄: 2개 이상일 때만. 하나만 고르는 토글이고 "모두"가 기본이다.
  if (labels.length >= 2) {
    const group = el(d, 'div', undefined, 'filters');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '라벨');
    const buttons: { button: HTMLButtonElement; labelId: string | null }[] = [];
    let selected: string | null = null;

    const apply = (labelId: string | null) => {
      selected = labelId;
      const visible: string[] = [];
      for (const place of doc.places) {
        const show = labelId === null || place.labelIds.includes(labelId);
        const li = items.get(place.id);
        if (li !== undefined) li.hidden = !show;
        if (show) visible.push(place.id);
      }
      for (const b of buttons)
        b.button.setAttribute('aria-pressed', String(b.labelId === selected));
      map.filter(visible);
    };

    const add = (text: string, labelId: string | null, color?: ShareLabel['color']) => {
      const button = el(d, 'button', text, 'filter');
      button.type = 'button';
      if (color !== undefined) button.dataset.color = color;
      button.setAttribute('aria-pressed', String(labelId === null));
      button.addEventListener('click', () =>
        apply(labelId !== null && labelId === selected ? null : labelId),
      );
      buttons.push({ button, labelId });
      group.append(button);
    };
    add('모두', null);
    for (const label of labels) add(label.name, label.id, label.color);
    root.append(group);
  }

  main.append(mapSlot, list);
  root.append(main);
  root.append(el(d, 'footer', 'trip-map에서 만든 파일'));

  return {
    highlight(placeId: string) {
      const card = mark(placeId);
      if (card !== null) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  };
}

/** 데이터를 읽지 못했을 때: 아무것도 그리지 않고 안내만 보인다. */
export function renderBroken(root: HTMLElement): void {
  root.replaceChildren(el(root.ownerDocument, 'p', '파일 내용을 읽지 못했어요', 'broken'));
}

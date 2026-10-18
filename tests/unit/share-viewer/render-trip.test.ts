import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dayColor } from 'src/components/map/map-colors';
import type { ShareDocV2 } from 'src/schema/share';
import type { MapPort } from 'src/share-viewer/map-frame';
import { renderTripViewer } from 'src/share-viewer/render-trip';
import { tripPins } from 'src/share-viewer/trip-view';
import { IDS, leg, makeShareV2Doc } from '../helpers/share-v2-doc';

const APP = 'https://x.test';

type FakeMap = {
  focus: ReturnType<typeof vi.fn>;
  filter: ReturnType<typeof vi.fn>;
  draw: ReturnType<typeof vi.fn>;
};

let root: HTMLElement;
let map: FakeMap;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  document.title = '';
  root = document.getElementById('root')!;
  map = { focus: vi.fn(), filter: vi.fn(), draw: vi.fn() };
  Element.prototype.scrollIntoView = vi.fn();
});

function mount(doc: ShareDocV2 = makeShareV2Doc(), compact = false) {
  return renderTripViewer(root, doc, map as unknown as MapPort, {
    app: APP,
    compact: () => compact,
  });
}

const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
const tab = (text: string) => tabs().find((t) => t.textContent === text)!;
const list = () => root.querySelector<HTMLElement>('[role=tabpanel] ul')!;
const text = () => root.querySelector('[role=tabpanel]')!.textContent;
const rowTexts = () => [...list().querySelectorAll(':scope > li')].map((li) => li.textContent);
const lastDraw = () => map.draw.mock.calls.at(-1)![0] as ReturnType<typeof tripPins>;

describe('머리글', () => {
  it('h1·document.title·부제', () => {
    mount();
    expect(root.querySelector('h1')!.textContent).toBe('강릉');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(document.title).toBe('강릉');
    expect(root.querySelector('header p')!.textContent).toBe(
      '10.24(토) ~ 10.25(일) · 1박 2일 · 일정 3곳 · 후보 1곳',
    );
    expect(root.dataset.mode).toBe('trip');
  });

  it('후보가 없으면 부제에 후보가 없고 후보 탭도 없다', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.candidateIds = [];
    mount(doc);
    expect(root.querySelector('header p')!.textContent).toBe(
      '10.24(토) ~ 10.25(일) · 1박 2일 · 일정 3곳',
    );
    expect(tabs().map((t) => t.textContent)).toEqual(['Day 1 10.24(토)', 'Day 2 10.25(일)']);
  });

  it('Landmark에 담기 링크와 too-big 안내', () => {
    const handle = mount();
    const a = root.querySelector<HTMLAnchorElement>('header a')!;
    expect(a.textContent).toBe('Landmark에 담기');
    expect(a.getAttribute('href')).toBe(`${APP}/import`);
    handle.setImportLink({ kind: 'direct', href: `${APP}/import#d=abc` });
    expect(a.getAttribute('href')).toBe(`${APP}/import#d=abc`);

    handle.setImportLink({ kind: 'too-big', href: `${APP}/import` });
    expect(root.querySelector('header .import-note')!.textContent).toBe(
      '일정이 커서 바로 담을 수 없어요. Landmark에서 이 파일을 가져와 주세요',
    );
    const open = root.querySelector<HTMLAnchorElement>('header .import a')!;
    expect(open.textContent).toBe('Landmark 열기');
    expect(open.getAttribute('href')).toBe(`${APP}/import`);
  });
});

describe('Day 탭', () => {
  it('탭 이름·역할·처음 선택·map.draw 한 번(Day 1 핀)', () => {
    const doc = makeShareV2Doc();
    mount(doc);
    expect(root.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Day 고르기');
    expect(tabs().map((t) => t.textContent)).toEqual([
      'Day 1 10.24(토)',
      'Day 2 10.25(일)',
      '후보 1',
    ]);
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    for (const t of tabs()) {
      expect(t.id).not.toBe('');
      expect(t.getAttribute('aria-controls')).toBe('trip-panel');
    }
    const panel = root.querySelector('[role=tabpanel]')!;
    expect(panel.id).toBe('trip-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0]!.id);
    expect(map.draw).toHaveBeenCalledTimes(1);
    expect(lastDraw()).toEqual(tripPins(doc, { kind: 'day', dayIndex: 0 }));
  });

  it('Day 2를 누르면 다시 그리고 목록 이름이 바뀐다', () => {
    const doc = makeShareV2Doc();
    mount(doc);
    expect(list().getAttribute('aria-label')).toBe('Day 1 일정');
    tab('Day 2 10.25(일)').click();
    expect(map.draw).toHaveBeenCalledTimes(2);
    expect(lastDraw()).toEqual(tripPins(doc, { kind: 'day', dayIndex: 1 }));
    expect(list().getAttribute('aria-label')).toBe('Day 2 일정');
    expect(tab('Day 2 10.25(일)').getAttribute('aria-selected')).toBe('true');
    expect(tab('Day 1 10.24(토)').getAttribute('aria-selected')).toBe('false');
    expect(root.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(
      tab('Day 2 10.25(일)').id,
    );
  });

  it('화살표·Home·End로 옮기고 고르며 포커스가 따라간다', () => {
    mount();
    const press = (key: string) =>
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    tab('Day 1 10.24(토)').focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(tab('Day 2 10.25(일)'));
    expect(tab('Day 2 10.25(일)').getAttribute('aria-selected')).toBe('true');
    expect(tab('Day 2 10.25(일)').tabIndex).toBe(0);
    expect(tab('Day 1 10.24(토)').tabIndex).toBe(-1);
    expect(list().getAttribute('aria-label')).toBe('Day 2 일정');

    press('End');
    expect(document.activeElement).toBe(tab('후보 1'));
    press('ArrowRight'); // 끝에서 처음으로
    expect(document.activeElement).toBe(tab('Day 1 10.24(토)'));
    press('ArrowLeft'); // 처음에서 끝으로
    expect(document.activeElement).toBe(tab('후보 1'));
    press('Home');
    expect(document.activeElement).toBe(tab('Day 1 10.24(토)'));
    expect(map.draw).toHaveBeenCalledTimes(6);
  });
});

describe('시간표', () => {
  it('Day 1 행 순서: 출발 · 장소 · 구간 · 장소 · 구간 · 도착 · 합계', () => {
    mount();
    expect(rowTexts()[0]).toBe('09:00 출발 · 🏠 장소 0');
    expect(rowTexts().at(-2)).toMatch(/^\d\d:\d\d 도착 · 🛏 장소 1$/);
    const kinds = [...list().querySelectorAll(':scope > li > *')].map((n) => n.className);
    expect(kinds).toEqual([
      'row point',
      'row leg',
      'row stop',
      'row leg',
      'row stop',
      'row leg',
      'row point',
      'row totals',
    ]);
  });

  it('장소 행: 번호 테두리 Day 색 · 도착~출발 · 체류 · 고정 · 메모', () => {
    mount();
    const stops = [...list().querySelectorAll<HTMLElement>('article.stop')];
    expect(stops).toHaveLength(2);
    const num = stops[0]!.querySelector<HTMLElement>('.num')!;
    expect(num.textContent).toBe('1');
    expect(num.style.borderColor).not.toBe('');
    expect(stops[0]!.querySelector('h2')!.textContent).toBe('장소 2');
    // 09:00 출발 + 10분 이동 = 09:10 도착, 체류 60분 = 10:10 출발
    expect(stops[0]!.querySelector('.times')!.textContent).toBe('09:10 ~ 10:10 · 체류 1시간');
    // 두 번째: 10:20 도착, 12:00 고정 → 여유 100분
    expect(stops[1]!.querySelector('.times')!.textContent).toBe('10:20 ~ 12:00');
    expect(stops[1]!.querySelector('.fixed')!.textContent).toBe('12:00 고정 · 여유 1시간 40분');
    expect(stops[1]!.querySelector('.memo')!.textContent).toBe('점심');
    expect(stops[1]!.querySelector('a')!.textContent).toBe('네이버 지도에서 보기');
  });

  it('번호 동그라미 테두리는 그날의 Day 색이다', () => {
    mount();
    tab('Day 2 10.25(일)').click();
    const num = list().querySelector<HTMLElement>('.num')!;
    const probe = document.createElement('span');
    probe.style.borderColor = dayColor(1);
    expect(num.style.borderColor).toBe(probe.style.borderColor);
  });

  it('늦으면 늦음 글자와 late 클래스', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.days[0]!.stops[0]!.stayMin = 300; // 14:10 출발 → 12:00 고정에 늦음
    mount(doc);
    const late = list().querySelector('.late')!;
    expect(late.textContent).toMatch(/^늦음 /);
  });

  it('자정을 넘기면 다음 날로 보인다', () => {
    const doc = makeShareV2Doc();
    const day = doc.trips[0]!.days[0]!;
    day.startTime = '23:50';
    day.legs[0]!.durationS = 1200;
    mount(doc);
    expect(list().querySelector('article.stop .times')!.textContent).toBe(
      '다음 날 00:10 ~ 다음 날 01:10 · 체류 1시간',
    );
  });

  it('구간 문구: 자동차·거리·통행료', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.days[0]!.legs[0] = leg(IDS.home, IDS.a, {
      durationS: 1500,
      distanceM: 18000,
      tollFare: 3000,
    });
    mount(doc);
    const legs = [...list().querySelectorAll('.leg-text')].map((n) => n.textContent);
    expect(legs[0]).toBe('자동차 25분 · 18km · 통행료 3,000원');
    expect(legs[1]).toBe('도보 10분 · 5km');
  });

  it('어림값 구간: 직선 추정 / 경로 없음 · 직선 추정', () => {
    const doc = makeShareV2Doc();
    const d0 = doc.trips[0]!.days[0]!;
    d0.legs[0] = leg(IDS.home, IDS.a, { status: 'estimated', queriedAt: null, path: [] });
    d0.legs[1] = leg(IDS.a, IDS.b, { status: 'no-route', queriedAt: null, path: [], mode: 'walk' });
    mount(doc);
    const legs = [...list().querySelectorAll('.leg-text')].map((n) => n.textContent);
    expect(legs[0]).toBe('자동차 10분 · 5km · 직선 추정');
    expect(legs[1]).toBe('도보 10분 · 5km · 경로 없음 · 직선 추정');
  });

  it('같은 지점 구간은 행이 없다', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.days[0]!.legs[2] = leg(IDS.b, IDS.hotel, {
      status: 'same-point',
      durationS: 0,
      distanceM: 0,
      queriedAt: null,
      path: [],
    });
    mount(doc);
    expect(list().querySelectorAll('.leg')).toHaveLength(2);
  });

  it('길찾기 링크: 좁은 화면은 nmap://, 넓은 화면은 웹', () => {
    mount(makeShareV2Doc(), true);
    const hrefs = [...list().querySelectorAll<HTMLAnchorElement>('a.directions')];
    expect(hrefs).toHaveLength(3);
    expect(hrefs[0]!.textContent).toBe('길찾기');
    expect(hrefs[0]!.getAttribute('href')).toMatch(/^nmap:\/\/route\/car\?/);
    expect(hrefs[1]!.getAttribute('href')).toMatch(/^nmap:\/\/route\/walk\?/);
    expect(hrefs[0]!.hasAttribute('target')).toBe(false);

    mount(makeShareV2Doc(), false);
    const web = [...list().querySelectorAll<HTMLAnchorElement>('a.directions')];
    expect(web[0]!.getAttribute('href')).toMatch(
      /^https:\/\/map\.naver\.com\/p\/directions\/.+\/car$/,
    );
    expect(web[0]!.target).toBe('_blank');
    expect(web[0]!.rel).toBe('noopener noreferrer');
  });

  it('화면 폭이 바뀌어 refreshDirections를 부르면 지금 패널의 길찾기 주소·새 탭 속성을 다시 정한다', () => {
    let compact = false;
    const handle = renderTripViewer(root, makeShareV2Doc(), map as unknown as MapPort, {
      app: APP,
      compact: () => compact,
    });
    const anchors = () => [...list().querySelectorAll<HTMLAnchorElement>('a.directions')];
    expect(anchors()).toHaveLength(3);
    for (const a of anchors()) expect(a.getAttribute('href')).toMatch(/^https:\/\//);

    compact = true;
    handle.refreshDirections();
    expect(anchors()).toHaveLength(3);
    expect(anchors()[0]!.getAttribute('href')).toMatch(/^nmap:\/\/route\/car\?/);
    expect(anchors()[1]!.getAttribute('href')).toMatch(/^nmap:\/\/route\/walk\?/);
    for (const a of anchors()) {
      expect(a.getAttribute('href')).toMatch(/^nmap:\/\//);
      expect(a.hasAttribute('target')).toBe(false);
      expect(a.hasAttribute('rel')).toBe(false);
    }

    compact = false;
    handle.refreshDirections();
    expect(anchors()[0]!.getAttribute('href')).toMatch(
      /^https:\/\/map\.naver\.com\/p\/directions\/.+\/car$/,
    );
    for (const a of anchors()) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//);
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener noreferrer');
    }
  });

  it('탭을 바꾼 뒤의 refreshDirections는 새 패널의 링크만 바꾼다', () => {
    let compact = false;
    const handle = renderTripViewer(root, makeShareV2Doc(), map as unknown as MapPort, {
      app: APP,
      compact: () => compact,
    });
    const old = list().querySelector<HTMLAnchorElement>('a.directions')!;
    const oldHref = old.getAttribute('href');
    tab(tabs()[1]!.textContent!).click();
    tab(tabs()[0]!.textContent!).click();
    compact = true;
    handle.refreshDirections();
    expect(old.getAttribute('href')).toBe(oldHref);
    for (const a of list().querySelectorAll<HTMLAnchorElement>('a.directions')) {
      expect(a.getAttribute('href')).toMatch(/^nmap:\/\//);
    }
  });

  it('좌표가 어긋나 주소를 만들 수 없는 구간은 링크가 없다', () => {
    const doc = makeShareV2Doc();
    doc.places.find((p) => p.id === IDS.a)!.lat = Number.NaN;
    mount(doc);
    expect(list().querySelectorAll('a.directions')).toHaveLength(1);
  });

  it('합계와 조회 날짜', () => {
    const doc = makeShareV2Doc();
    for (const l of doc.trips[0]!.days[0]!.legs) l.queriedAt = '2026-10-16T12:00:00.000Z';
    mount(doc);
    const totals = list().querySelector('.totals')!;
    expect(totals.querySelector('.totals-line')!.textContent).toBe('이동 30분 · 15km');
    expect(totals.querySelector('.queried')!.textContent).toBe('10월 16일 조회');
  });

  it('받은 경로가 없으면 조회 줄 대신 안내, 합계 앞에 약', () => {
    const doc = makeShareV2Doc();
    for (const l of doc.trips[0]!.days[0]!.legs) {
      l.status = 'estimated';
      l.queriedAt = null;
      l.path = [];
    }
    mount(doc);
    const totals = list().querySelector('.totals')!;
    expect(totals.querySelector('.totals-line')!.textContent).toBe('약 이동 30분 · 15km');
    expect(totals.querySelector('.queried')!.textContent).toBe('경로를 받지 못해 어림값이에요');
  });

  it('빈 Day: 안내와 출발점 행, 합계는 없다', () => {
    const doc = makeShareV2Doc();
    const d1 = doc.trips[0]!.days[1]!;
    d1.stops = [];
    d1.legs = [];
    mount(doc);
    tab('Day 2 10.25(일)').click();
    expect(rowTexts()).toEqual(['09:30 출발 · 🛏 장소 1', '이 날은 아직 일정이 없어요']);
  });

  it('출발점이 없으면 첫 장소에서 출발', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.originId = null;
    doc.trips[0]!.days[0]!.legs.shift();
    mount(doc);
    expect(rowTexts()[0]).toBe('첫 장소에서 출발 · 09:00');
    expect(list().querySelector('article.stop .times')!.textContent).toMatch(/^09:00 ~ /);
  });

  it('숙소가 없으면 도착 행이 없다', () => {
    mount();
    tab('Day 2 10.25(일)').click();
    expect(rowTexts().some((t) => t!.includes('도착 ·'))).toBe(false);
  });

  it('메모·한 줄 평·장소 메모는 글자 그대로 보인다', () => {
    const doc = makeShareV2Doc();
    doc.trips[0]!.days[0]!.stops[0]!.note = '<b>x</b>\n둘째 줄';
    const a = doc.places.find((p) => p.id === IDS.a)!;
    a.memo = '<i>메모</i>';
    a.review = '<u>맛있다</u>';
    mount(doc);
    expect(root.querySelector('b, i, u')).toBeNull();
    const first = list().querySelector('article.stop')!;
    const memos = [...first.querySelectorAll('.memo')].map((n) => n.textContent);
    expect(memos).toEqual(['<b>x</b>\n둘째 줄', '<i>메모</i>']);
    expect(first.querySelector('.review')!.textContent).toBe('한 줄 평 <u>맛있다</u>');
  });
});

describe('행 누르기와 지도', () => {
  const stopRow = (i: number) => list().querySelectorAll<HTMLElement>('article.stop')[i]!;

  it('장소 행을 누르면 강조하고 핀 id로 map.focus', () => {
    mount();
    stopRow(0).click();
    expect(map.focus).toHaveBeenCalledWith(IDS.a);
    expect(stopRow(0).getAttribute('aria-current')).toBe('true');
    stopRow(1).click();
    expect(stopRow(0).hasAttribute('aria-current')).toBe(false);
    expect(stopRow(1).getAttribute('aria-current')).toBe('true');
    expect(map.focus).toHaveBeenLastCalledWith(IDS.b);
  });

  it('출발점·도착점 행은 start:/end: 핀 id로 보낸다', () => {
    mount();
    const points = list().querySelectorAll<HTMLElement>('article.point');
    points[0]!.click();
    expect(map.focus).toHaveBeenLastCalledWith(`start:${IDS.home}`);
    points[1]!.click();
    expect(map.focus).toHaveBeenLastCalledWith(`end:${IDS.hotel}`);
  });

  it('Enter·Space로도 누르고, 행 안 링크를 누르면 지도를 움직이지 않는다', () => {
    mount();
    const row = stopRow(0);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(map.focus).toHaveBeenCalledTimes(2);

    map.focus.mockClear();
    const other = stopRow(1);
    const a = other.querySelector('a')!;
    a.addEventListener('click', (e) => e.preventDefault());
    a.click();
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(map.focus).not.toHaveBeenCalled();
    expect(other.hasAttribute('aria-current')).toBe(false);
  });

  it('출발점과 숙소가 같은 Day에서 도착 행을 누르면(Enter도) 도착 행을 강조한다', () => {
    const doc = makeShareV2Doc();
    const day2 = doc.trips[0]!.days[1]!;
    day2.lodgingId = IDS.hotel;
    day2.legs = [leg(IDS.hotel, IDS.c), leg(IDS.c, IDS.hotel)];
    mount(doc);
    tab('Day 2 10.25(일)').click();
    const points = () => list().querySelectorAll<HTMLElement>('article.point');
    expect(points()).toHaveLength(2);

    points()[1]!.click();
    expect(points()[1]!.getAttribute('aria-current')).toBe('true');
    expect(points()[0]!.hasAttribute('aria-current')).toBe(false);
    expect(map.focus).toHaveBeenLastCalledWith(`start:${IDS.hotel}`);

    points()[0]!.click();
    points()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(points()[1]!.getAttribute('aria-current')).toBe('true');
    expect(points()[0]!.hasAttribute('aria-current')).toBe(false);
  });

  it('highlight(end:숙소)는 도착 행을 강조하고 스크롤한다', () => {
    const handle = mount();
    handle.highlight(`end:${IDS.hotel}`);
    const end = list().querySelectorAll<HTMLElement>('article.point')[1]!;
    expect(end.getAttribute('aria-current')).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(map.draw).toHaveBeenCalledTimes(1); // 같은 탭이라 다시 그리지 않는다
  });

  it('다른 Day의 점(흐린 점)을 누르면 그 Day 탭으로 바꾸고 행을 강조한다', () => {
    const handle = mount();
    handle.highlight(IDS.c);
    expect(tab('Day 2 10.25(일)').getAttribute('aria-selected')).toBe('true');
    expect(list().getAttribute('aria-label')).toBe('Day 2 일정');
    expect(list().querySelector('article.stop')!.getAttribute('aria-current')).toBe('true');
    expect(map.draw).toHaveBeenCalledTimes(2);
    expect(map.focus).toHaveBeenCalledWith(IDS.c);
  });

  it('옛 지도 페이지가 접두사 없는 장소 id를 보내도 숙소 행을 찾는다', () => {
    const handle = mount();
    handle.highlight(IDS.hotel);
    expect(
      list().querySelectorAll<HTMLElement>('article.point')[1]!.getAttribute('aria-current'),
    ).toBe('true');
  });

  it('지금 Day의 숙소가 다른 Day의 Stop이면 접두사 없는 id는 그 Day로, end: id는 도착 행으로', () => {
    // 숙소(hotel)는 Day 1의 숙소이자 Day 2의 Stop이다.
    const doc = makeShareV2Doc();
    const day2 = doc.trips[0]!.days[1]!;
    day2.stops.push({ placeId: IDS.hotel, stayMin: 30, fixedTime: null });
    day2.legs = [leg(IDS.hotel, IDS.c), leg(IDS.c, IDS.hotel)];
    const handle = mount(doc);

    handle.highlight(`end:${IDS.hotel}`);
    expect(list().getAttribute('aria-label')).toBe('Day 1 일정');
    expect(
      list().querySelectorAll<HTMLElement>('article.point')[1]!.getAttribute('aria-current'),
    ).toBe('true');

    handle.highlight(IDS.hotel);
    expect(tab('Day 2 10.25(일)').getAttribute('aria-selected')).toBe('true');
    expect(list().getAttribute('aria-label')).toBe('Day 2 일정');
    const stops = list().querySelectorAll<HTMLElement>('article.stop');
    expect(stops[1]!.querySelector('h2')!.textContent).toBe('장소 1');
    expect(stops[1]!.getAttribute('aria-current')).toBe('true');
    expect(list().querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(map.focus).toHaveBeenLastCalledWith(IDS.hotel);
  });

  it('모르는 id는 아무것도 바꾸지 않는다', () => {
    const handle = mount();
    handle.highlight('nope');
    expect(list().querySelector('[aria-current]')).toBeNull();
    expect(map.draw).toHaveBeenCalledTimes(1);
  });
});

describe('후보 탭', () => {
  it('안내 한 줄과 장소 카드, 후보 핀만 그린다', () => {
    const doc = makeShareV2Doc();
    doc.places.find((p) => p.id === IDS.d)!.review = '다시 가고 싶다';
    mount(doc);
    tab('후보 1').click();
    expect(root.querySelector('.cand-note')!.textContent).toBe('아직 Day에 넣지 않은 장소예요');
    expect(list().getAttribute('aria-label')).toBe('후보 장소');
    const cards = list().querySelectorAll<HTMLElement>('article');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector('h2')!.textContent).toBe('장소 5');
    expect(cards[0]!.querySelector('.review')!.textContent).toBe('한 줄 평 다시 가고 싶다');
    expect(cards[0]!.querySelector('a')!.textContent).toBe('네이버 지도에서 보기');
    expect(lastDraw()).toEqual(tripPins(doc, { kind: 'candidates' }));
    cards[0]!.click();
    expect(map.focus).toHaveBeenCalledWith(IDS.d);
    expect(cards[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('후보 점을 highlight하면 후보 탭으로 바뀐다', () => {
    const handle = mount();
    handle.highlight(IDS.d);
    expect(tab('후보 1').getAttribute('aria-selected')).toBe('true');
    expect(text()).toContain('장소 5');
  });
});

describe('안전', () => {
  it('제목·이름의 태그는 글자로 보인다', () => {
    const doc = makeShareV2Doc();
    doc.title = '<b>제목</b>';
    doc.places[2]!.name = '<img src=x onerror=alert(1)>';
    mount(doc);
    expect(root.querySelector('b, img')).toBeNull();
    expect(root.querySelector('h1')!.textContent).toBe('<b>제목</b>');
  });
});

import { formatClock, formatSlack, formatSpan } from 'src/domain/trips/schedule';
import { NO_CATEGORY_COLOR, dayColor } from 'src/components/map/map-colors';
import type { ShareDocV2, ShareLabel, ShareLeg, SharePlace } from 'src/schema/share';
import {
  formatDistance,
  formatDuration,
  formatTotals,
  queriedLabel,
} from 'src/sections/trips/planner/format';
import { naverDirectionsUrl } from 'src/sections/trips/planner/naver-directions';
import { addDays, periodLabel, shortDate } from 'src/sections/trips/trip-dates';
import type { ImportLink } from './encode';
import type { MapPort } from './map-frame';
import { el, importControl, naverLink, placeCard } from './render';
import { dayView, placeIdOfPin, tripPins, type DayRow, type TripTab } from './trip-view';

/**
 * 보기 화면 일정 모드 그리기(스펙 §4.2~§4.5). 사용자 문자열은 `textContent`·속성 값으로만 넣는다.
 * 시각은 `dayView`(앱과 같은 `computeSchedule`)가 계산하고, 지도는 `MapPort`로만 알린다.
 */

const MODE_LABEL = { car: '자동차', walk: '도보' } as const;

const START_PREFIX = 'start:';
const END_PREFIX = 'end:';

/** 구간 문구 뒤에 붙는 상태(`routed`는 없음). */
const STATUS_TEXT: Record<ShareLeg['status'], string | null> = {
  routed: null,
  estimated: '직선 추정',
  'no-route': '경로 없음 · 직선 추정',
  'same-point': null,
};

const TAB_LABEL = 'Day 고르기';
const PANEL_ID = 'trip-panel';

export function renderTripViewer(
  root: HTMLElement,
  doc: ShareDocV2,
  map: MapPort,
  opts: { app: string; compact(): boolean },
): {
  highlight(id: string): void;
  setImportLink(link: ImportLink): void;
  /** 화면 폭(`compact`)이 바뀐 뒤 부른다. 지금 패널의 길찾기 링크를 다시 정한다(스펙 §4.4). */
  refreshDirections(): void;
} {
  const d = root.ownerDocument;
  const trip = doc.trips[0]!;
  d.title = doc.title;
  root.replaceChildren();
  root.dataset.mode = 'trip';

  const placeById = new Map<string, SharePlace>(doc.places.map((p) => [p.id, p]));
  const labelById = new Map<string, ShareLabel>(doc.labels.map((l) => [l.id, l]));
  const candidateCount = trip.candidateIds.length;
  const stopCount = trip.days.reduce((n, day) => n + day.stops.length, 0);

  // 머리글: 제목 · 부제 · 가져오기 링크
  const header = el(d, 'header');
  header.append(el(d, 'h1', doc.title));
  header.append(
    el(
      d,
      'p',
      `${periodLabel(trip.startDate, trip.endDate)} · 일정 ${stopCount}곳` +
        (candidateCount > 0 ? ` · 후보 ${candidateCount}곳` : ''),
    ),
  );
  const importer = importControl(
    d,
    opts.app,
    '일정이 커서 바로 담을 수 없어요. Landmark에서 이 파일을 가져와 주세요',
  );
  header.append(importer.slot);
  root.append(header);

  // 지도 자리 · Day 탭 줄 · 시간표
  const main = el(d, 'main');
  const mapSlot = el(d, 'div');
  mapSlot.id = 'map';
  const panelBox = el(d, 'div', undefined, 'trip-panel');
  const tablist = el(d, 'div', undefined, 'tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', TAB_LABEL);
  const panel = el(d, 'div', undefined, 'tab-body');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'tabpanel');
  panelBox.append(tablist, panel);
  main.append(mapSlot, panelBox);
  root.append(main);
  root.append(el(d, 'footer', '랜드마크에서 만든 파일'));

  // 탭
  const tabs: { tab: TripTab; button: HTMLButtonElement }[] = [];
  const addTab = (tab: TripTab, text: string, color: string, id: string) => {
    const button = el(d, 'button', text, 'tab');
    button.type = 'button';
    button.id = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', PANEL_ID);
    button.style.setProperty('--tab-color', color);
    button.addEventListener('click', () => select(tab));
    tabs.push({ tab, button });
    tablist.append(button);
  };
  trip.days.forEach((_, i) => {
    addTab(
      { kind: 'day', dayIndex: i },
      `Day ${i + 1} ${shortDate(addDays(trip.startDate, i))}`,
      dayColor(i),
      `tab-day-${i}`,
    );
  });
  if (candidateCount > 0) {
    addTab({ kind: 'candidates' }, `후보 ${candidateCount}`, NO_CATEGORY_COLOR, 'tab-candidates');
  }

  tablist.addEventListener('keydown', (event) => {
    const at = tabs.findIndex((t) => t.button === event.target);
    if (at === -1) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (at + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (at - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next]!;
    select(target.tab);
    target.button.focus();
  });

  // 시간표 행: 핀 id → 행. 탭을 바꿀 때마다 새로 채운다.
  let rows = new Map<string, HTMLElement>();
  let currentRow: HTMLElement | null = null;
  // 지금 패널의 길찾기 링크와 그 구간. 탭을 바꿀 때마다 새로 채운다.
  let directions: { a: HTMLAnchorElement; leg: ShareLeg }[] = [];

  function markRow(next: HTMLElement | null): HTMLElement | null {
    if (currentRow !== null) currentRow.removeAttribute('aria-current');
    currentRow = next;
    if (next !== null) next.setAttribute('aria-current', 'true');
    return next;
  }

  /** 지도에서 고른 핀의 행을 강조한다(핀 하나에 행이 둘이면 첫 행). */
  const mark = (id: string): HTMLElement | null => markRow(rows.get(id) ?? null);

  /**
   * 누르거나 Enter·Space를 누르면 그 행을 강조하고 지도를 그 핀으로 옮긴다. 링크를 누를 때는 하지 않는다.
   * 출발점과 숙소가 같은 Day는 두 행이 핀 하나를 나눠 쓰므로, 핀이 아니라 누른 행을 강조한다.
   */
  function makeSelectable(row: HTMLElement, pinId: string) {
    row.tabIndex = 0;
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a') !== null) return;
      markRow(row);
      map.focus(pinId);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      markRow(row);
      map.focus(pinId);
    });
    if (!rows.has(pinId)) rows.set(pinId, row);
  }

  function nameOf(placeId: string): string {
    return placeById.get(placeId)?.name ?? '';
  }

  /** 장소 이름 아래에 붙는 한 줄 글. 값이 없으면 만들지 않는다. */
  const line = (text: string, className: string) => el(d, 'p', text, className);

  function pointRow(text: string, pinId: string): HTMLLIElement {
    const li = el(d, 'li');
    const article = el(d, 'article', undefined, 'row point');
    article.append(el(d, 'p', text, 'point-line'));
    makeSelectable(article, pinId);
    li.append(article);
    return li;
  }

  function stopRow(row: Extract<DayRow, { kind: 'stop' }>, dayIndex: number): HTMLLIElement {
    const { stop } = row;
    const place = placeById.get(stop.placeId);
    const li = el(d, 'li');
    const article = el(d, 'article', undefined, 'row stop');
    const number = el(d, 'span', String(row.number), 'num');
    number.style.borderColor = dayColor(dayIndex);
    const body = el(d, 'div', undefined, 'stop-body');
    body.append(el(d, 'h2', place?.name ?? ''));

    const times = [
      row.arriveMin === row.departMin
        ? formatClock(row.arriveMin)
        : `${formatClock(row.arriveMin)} ~ ${formatClock(row.departMin)}`,
    ];
    if (stop.stayMin !== null) times.push(`체류 ${formatSpan(stop.stayMin)}`);
    body.append(line(times.join(' · '), 'times'));

    if (stop.fixedTime !== null || row.slackMin !== null) {
      const fixed = el(d, 'p', undefined, 'fixed');
      if (stop.fixedTime !== null) fixed.append(`${stop.fixedTime} 고정`);
      if (row.slackMin !== null) {
        if (stop.fixedTime !== null) fixed.append(' · ');
        fixed.append(el(d, 'span', formatSlack(row.slackMin), row.slackMin < 0 ? 'late' : 'slack'));
      }
      body.append(fixed);
    }
    if (stop.note !== undefined) body.append(line(stop.note, 'memo'));
    if (place?.memo !== undefined) body.append(line(place.memo, 'memo'));
    if (place?.review !== undefined) body.append(line(`한 줄 평 ${place.review}`, 'review'));
    if (place !== undefined) body.append(naverLink(d, place));

    article.append(number, body);
    makeSelectable(article, stop.placeId);
    li.append(article);
    return li;
  }

  function legRow(leg: ShareLeg): HTMLLIElement {
    const li = el(d, 'li');
    const box = el(d, 'div', undefined, 'row leg');
    const parts = [
      `${MODE_LABEL[leg.mode]} ${formatDuration(leg.durationS)} · ${formatDistance(leg.distanceM)}`,
    ];
    const status = STATUS_TEXT[leg.status];
    if (status !== null) parts.push(status);
    if (leg.tollFare !== null && leg.tollFare > 0) {
      parts.push(`통행료 ${leg.tollFare.toLocaleString('ko-KR')}원`);
    }
    box.append(el(d, 'span', parts.join(' · '), 'leg-text'));

    const href = directionsHref(leg);
    if (href !== null) {
      const a = el(d, 'a', '길찾기', 'directions');
      setDirections(a, href);
      directions.push({ a, leg });
      box.append(a);
    }
    li.append(box);
    return li;
  }

  /** 구간의 길찾기 주소. 좁은 화면은 앱(`nmap://`), 아니면 웹. 좌표가 어긋나면 null. */
  function directionsHref(leg: ShareLeg): string | null {
    const from = placeById.get(leg.from);
    const to = placeById.get(leg.to);
    if (from === undefined || to === undefined) return null;
    return naverDirectionsUrl(
      {
        from: { name: from.name, lng: from.lng, lat: from.lat },
        to: { name: to.name, lng: to.lng, lat: to.lat },
        mode: leg.mode,
      },
      opts.compact() ? 'app' : 'web',
    );
  }

  /** 링크 주소를 정한다. 웹 길찾기만 새 탭으로 연다. 앱 주소(nmap://)는 새 탭이면 빈 탭이 남는다. */
  function setDirections(a: HTMLAnchorElement, href: string) {
    a.href = href;
    if (href.startsWith('https://')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  }

  function dayList(dayIndex: number): HTMLUListElement {
    const list = el(d, 'ul');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `Day ${dayIndex + 1} 일정`);
    const view = dayView(trip, dayIndex);
    const startId = view.rows.find(
      (r): r is Extract<DayRow, { kind: 'start' }> => r.kind === 'start',
    )?.placeId;
    const items: HTMLLIElement[] = [];
    for (const row of view.rows) {
      switch (row.kind) {
        case 'start':
          items.push(
            pointRow(
              `${formatClock(row.departMin)} 출발 · ${row.icon} ${nameOf(row.placeId)}`,
              `${START_PREFIX}${row.placeId}`,
            ),
          );
          break;
        case 'no-start':
          items.push(el(d, 'li', `첫 장소에서 출발 · ${formatClock(row.departMin)}`, 'plain'));
          break;
        case 'stop':
          items.push(stopRow(row, dayIndex));
          break;
        case 'leg':
          items.push(legRow(row.leg));
          break;
        case 'end':
          // 출발점과 같은 장소면 지도에는 핀이 하나(`start:`)뿐이다.
          items.push(
            pointRow(
              `${formatClock(row.arriveMin)} 도착 · 🛏 ${nameOf(row.placeId)}`,
              `${row.placeId === startId ? START_PREFIX : END_PREFIX}${row.placeId}`,
            ),
          );
          break;
      }
    }
    if (trip.days[dayIndex]?.stops.length === 0) {
      // 출발점 행은 위에 두고, 장소가 없다는 안내를 그 아래에 둔다.
      const at = view.rows[0]?.kind === 'start' || view.rows[0]?.kind === 'no-start' ? 1 : 0;
      items.splice(at, 0, el(d, 'li', '이 날은 아직 일정이 없어요', 'empty'));
    }
    if (view.hasLegs) {
      const totals = el(d, 'li');
      const box = el(d, 'div', undefined, 'row totals');
      box.append(el(d, 'p', formatTotals(view.totals), 'totals-line'));
      box.append(
        el(
          d,
          'p',
          view.oldestQueriedAt === null
            ? '경로를 받지 못해 어림값이에요'
            : queriedLabel(view.oldestQueriedAt),
          'queried',
        ),
      );
      totals.append(box);
      items.push(totals);
    }
    list.append(...items);
    return list;
  }

  function candidateList(): HTMLUListElement {
    const list = el(d, 'ul');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', '후보 장소');
    for (const placeId of trip.candidateIds) {
      const place = placeById.get(placeId);
      if (place === undefined) continue;
      const li = el(d, 'li');
      const card = placeCard(d, place, labelById);
      card.dataset.placeId = place.id;
      makeSelectable(card, place.id);
      li.append(card);
      list.append(li);
    }
    return list;
  }

  function select(tab: TripTab) {
    const at = tabs.findIndex((t) =>
      tab.kind === 'day'
        ? t.tab.kind === 'day' && t.tab.dayIndex === tab.dayIndex
        : t.tab.kind === 'candidates',
    );
    tabs.forEach((t, i) => {
      t.button.setAttribute('aria-selected', String(i === at));
      t.button.tabIndex = i === at ? 0 : -1;
    });
    rows = new Map();
    currentRow = null;
    directions = [];
    if (tab.kind === 'day') {
      panel.replaceChildren(dayList(tab.dayIndex));
    } else {
      panel.replaceChildren(
        el(d, 'p', '아직 Day에 넣지 않은 장소예요', 'cand-note'),
        candidateList(),
      );
    }
    panel.setAttribute('aria-labelledby', tabs[at]?.button.id ?? '');
    panel.scrollTop = 0;
    map.draw(tripPins(doc, tab));
  }

  /** 핀 id가 있는 탭을 찾는다: 다른 Day의 Stop(흐린 점)이나 후보. 없으면 null. */
  function tabOfPin(id: string): TripTab | null {
    const placeId = placeIdOfPin(id);
    const dayIndex = trip.days.findIndex((day) => day.stops.some((s) => s.placeId === placeId));
    if (dayIndex !== -1) return { kind: 'day', dayIndex };
    if (trip.candidateIds.includes(placeId) && candidateCount > 0) return { kind: 'candidates' };
    return null;
  }

  function show(row: HTMLElement) {
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  select({ kind: 'day', dayIndex: 0 });

  return {
    highlight(id: string) {
      // 1) 지금 탭에 그 핀 id의 행이 있으면 강조한다.
      if (rows.has(id)) {
        const row = mark(id);
        if (row !== null) show(row);
        return;
      }
      // 2) 다른 Day의 점(또는 후보)이면 그 탭으로 바꾼 뒤 강조한다. 바뀐 지도에서도 그 핀을 강조한다.
      //    지금 Day의 숙소가 다른 Day의 Stop이어도 그 점을 누르면 그 Day로 간다(스펙 §4.6).
      const tab = tabOfPin(id);
      if (tab !== null) {
        select(tab);
        const row = mark(placeIdOfPin(id));
        if (row !== null) show(row);
        map.focus(placeIdOfPin(id));
        return;
      }
      // 3) 옛 지도 페이지는 접두사 없는 장소 id를 보내므로, 지금 탭에서 접두사를 뗀 id로도 찾는다.
      for (const pinId of rows.keys()) {
        if (placeIdOfPin(pinId) === id) {
          const row = mark(pinId);
          if (row !== null) show(row);
          return;
        }
      }
    },
    setImportLink: importer.set,
    refreshDirections() {
      // 만들 때와 같은 규칙. 주소를 만들 수 없게 되면 만들 때처럼 링크를 두지 않는다.
      directions = directions.filter(({ a, leg }) => {
        const href = directionsHref(leg);
        if (href === null) {
          a.remove();
          return false;
        }
        setDirections(a, href);
        return true;
      });
    },
  };
}

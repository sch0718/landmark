import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareDoc, SharePlace } from 'src/schema/share';
import { envelope, type FromMap, type MapLine, type MapPin, type ToMap } from 'src/share-protocol';
import {
  DEFAULT_MAP_URL,
  READY_TIMEOUT_MS,
  connectMapFrame,
  shareMapUrl,
  toMapPlaces,
} from 'src/share-viewer/map-frame';

const MAP_URL = 'https://sch0718.github.io/landmark/';
const MAP_ORIGIN = 'https://sch0718.github.io';
const FAILED = '지도를 불러오지 못했어요. 목록과 네이버 지도 링크는 그대로 쓸 수 있어요';

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

function makeDoc(): ShareDoc {
  return {
    format: 'tripmap-share',
    version: 1,
    title: '정자역 카페',
    createdAt: '2026-10-11T03:00:00.000Z',
    labels: [
      { id: 'l1', name: '카페', color: 'orange', order: 1 },
      { id: 'l2', name: '빵집', color: 'blue', order: 0 },
    ],
    places: [
      place({
        id: 'a',
        name: '서혜커피',
        lng: 127.11,
        lat: 37.37,
        labelIds: ['l1', 'l2'],
        memo: '크로플',
        naverSid: '123',
      }),
      place({ id: 'b', labelIds: ['gone', 'l2'] }),
      place({ id: 'c' }),
    ],
  };
}

describe('toMapPlaces', () => {
  it('첫 라벨(장소에 붙은 순서, 없는 라벨은 건너뜀)의 색 또는 null만 담는다', () => {
    expect(toMapPlaces(makeDoc())).toEqual([
      { id: 'a', name: '서혜커피', lng: 127.11, lat: 37.37, color: 'orange' },
      { id: 'b', name: '장소 b', lng: 127.1, lat: 37.36, color: 'blue' },
      { id: 'c', name: '장소 c', lng: 127.1, lat: 37.36, color: null },
    ]);
  });

  it('메모·주소·네이버 ID 키가 없다', () => {
    for (const p of toMapPlaces(makeDoc())) {
      expect(Object.keys(p).sort()).toEqual(['color', 'id', 'lat', 'lng', 'name']);
    }
  });
});

describe('shareMapUrl', () => {
  it('빌드 변수가 없거나 빈 문자열이면 기본 주소, 있으면 그 값', () => {
    expect(DEFAULT_MAP_URL).toBe('https://sch0718.github.io/landmark/');
    expect(shareMapUrl(undefined)).toBe(DEFAULT_MAP_URL);
    expect(shareMapUrl('')).toBe(DEFAULT_MAP_URL);
    expect(shareMapUrl('http://localhost:5174/')).toBe('http://localhost:5174/');
  });
});

describe('connectMapFrame', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    host.id = 'map';
    document.body.append(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  function setup(onSelect = vi.fn()) {
    const places = toMapPlaces(makeDoc());
    const port = connectMapFrame(host, { mapUrl: MAP_URL, places, onSelect });
    const iframe = host.querySelector('iframe');
    if (iframe === null || iframe.contentWindow === null) throw new Error('iframe 없음');
    const frameWin = iframe.contentWindow;
    const post = vi.spyOn(frameWin, 'postMessage').mockImplementation(() => {});
    const receive = (
      msg: FromMap,
      opts: { origin?: string; source?: MessageEventSource | null } = {},
    ) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: envelope(msg),
          origin: opts.origin ?? MAP_ORIGIN,
          source: opts.source === undefined ? frameWin : opts.source,
        }),
      );
    };
    const sent = () => post.mock.calls.map((c) => c[0] as ToMap & { source: string; v: number });
    const notice = () => host.querySelector('p');
    return { port, iframe, post, receive, sent, notice, places, onSelect };
  }

  it('iframe을 지도 주소로 만들고 제목은 "지도"다', () => {
    const { iframe } = setup();
    expect(iframe.getAttribute('src')).toBe(MAP_URL);
    expect(iframe.title).toBe('지도');
    expect(iframe.hasAttribute('loading')).toBe(false);
    expect(iframe.hidden).toBe(false);
  });

  it('ready 전 focus·filter는 보내지 않고, ready 뒤 init·focus·filter 순서로 지도 출처에 보낸다', () => {
    const { port, post, receive, sent, places } = setup();
    port.focus('a');
    port.filter(['a']);
    expect(post).not.toHaveBeenCalled();

    receive({ kind: 'ready', maxV: 1 });
    expect(sent()).toEqual([
      envelope({ kind: 'init', places }),
      envelope({ kind: 'focus', placeId: 'a' }),
      envelope({ kind: 'filter', placeIds: ['a'] }),
    ]);
    for (const call of post.mock.calls) expect(call[1]).toBe(MAP_ORIGIN);

    // ready 뒤에는 바로 보낸다.
    port.focus(null);
    expect(sent().at(-1)).toEqual(envelope({ kind: 'focus', placeId: null }));
    expect(post.mock.calls.at(-1)?.[1]).toBe(MAP_ORIGIN);
  });

  it('ready 전에 같은 종류를 여러 번 부르면 마지막 것만 보낸다', () => {
    const { port, receive, sent, places } = setup();
    port.focus('a');
    port.filter(['a', 'b']);
    port.focus('b');
    receive({ kind: 'ready', maxV: 1 });
    expect(sent()).toEqual([
      envelope({ kind: 'init', places }),
      envelope({ kind: 'filter', placeIds: ['a', 'b'] }),
      envelope({ kind: 'focus', placeId: 'b' }),
    ]);
  });

  it('지도 페이지가 다시 읽혀 ready가 또 오면 init 뒤에 마지막 filter·focus를 다시 보낸다', () => {
    const { port, receive, sent, places } = setup();
    receive({ kind: 'ready', maxV: 1 });
    port.filter(['a']);
    port.focus('a');
    const before = sent().length;

    receive({ kind: 'ready', maxV: 1 });
    expect(sent().slice(before)).toEqual([
      envelope({ kind: 'init', places }),
      envelope({ kind: 'filter', placeIds: ['a'] }),
      envelope({ kind: 'focus', placeId: 'a' }),
    ]);
  });

  it('마커로 고른 장소(select)도 다시 읽힌 지도에 focus로 되살린다(select 때는 보내지 않는다)', () => {
    const { port, receive, sent, places } = setup();
    receive({ kind: 'ready', maxV: 1 });
    port.focus('a');
    receive({ kind: 'select', placeId: 'b' });
    const before = sent().length;
    expect(sent().at(-1)).toEqual(envelope({ kind: 'focus', placeId: 'a' }));

    receive({ kind: 'ready', maxV: 1 });
    expect(sent().slice(before)).toEqual([
      envelope({ kind: 'init', places }),
      envelope({ kind: 'focus', placeId: 'b' }),
    ]);
  });

  it('init.places에 memo·address·naverSid 키가 없다', () => {
    const { receive, sent } = setup();
    receive({ kind: 'ready', maxV: 1 });
    const init = sent()[0];
    if (init?.kind !== 'init') throw new Error('init 아님');
    expect(init.places).toHaveLength(3);
    for (const p of init.places) {
      expect(p).not.toHaveProperty('memo');
      expect(p).not.toHaveProperty('address');
      expect(p).not.toHaveProperty('naverSid');
    }
  });

  it('출처가 다르거나 다른 창에서 온 select는 무시하고, 맞으면 onSelect를 부른다', () => {
    const { receive, onSelect } = setup();
    receive({ kind: 'select', placeId: 'a' }, { origin: 'https://evil.example' });
    receive({ kind: 'select', placeId: 'a' }, { source: window });
    receive({ kind: 'select', placeId: 'a' }, { source: null });
    expect(onSelect).not.toHaveBeenCalled();

    receive({ kind: 'select', placeId: 'b' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('봉투가 없거나 모양이 틀린 메시지는 무시한다', () => {
    const { iframe, post, onSelect } = setup();
    const frameWin = iframe.contentWindow;
    for (const data of [{ kind: 'ready', maxV: 1 }, { source: 'tripmap-share', v: 1 }, 'ready']) {
      window.dispatchEvent(
        new MessageEvent('message', { data, origin: MAP_ORIGIN, source: frameWin }),
      );
    }
    expect(post).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('출처가 다른 ready로는 init을 보내지 않는다', () => {
    const { receive, post } = setup();
    receive({ kind: 'ready', maxV: 1 }, { origin: 'https://evil.example' });
    expect(post).not.toHaveBeenCalled();
  });

  it(`${READY_TIMEOUT_MS}ms 안에 ready가 없으면 iframe을 감추고 실패 문구를 보인다`, () => {
    expect(READY_TIMEOUT_MS).toBe(10_000);
    const { iframe, notice } = setup();
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    expect(iframe.hidden).toBe(false);
    expect(notice()?.hidden ?? true).toBe(true);

    vi.advanceTimersByTime(1);
    expect(iframe.hidden).toBe(true);
    expect(notice()?.hidden).toBe(false);
    expect(notice()?.textContent).toBe(FAILED);
  });

  it('제때 온 ready 뒤에는 시한이 지나도 안내가 뜨지 않는다', () => {
    const { iframe, receive, notice } = setup();
    receive({ kind: 'ready', maxV: 1 });
    vi.advanceTimersByTime(READY_TIMEOUT_MS * 2);
    expect(iframe.hidden).toBe(false);
    expect(notice()?.hidden ?? true).toBe(true);
  });

  it('tiles-failed가 오면 같은 안내를 보인다', () => {
    const { iframe, receive, notice } = setup();
    receive({ kind: 'ready', maxV: 1 });
    receive({ kind: 'tiles-failed' });
    expect(iframe.hidden).toBe(true);
    expect(notice()?.hidden).toBe(false);
    expect(notice()?.textContent).toBe(FAILED);
  });

  it('시한 뒤 늦게 온 ready는 안내를 걷고 iframe을 보이며 init을 보낸다', () => {
    const { port, iframe, receive, sent, notice, places } = setup();
    port.focus('c');
    vi.advanceTimersByTime(READY_TIMEOUT_MS + 5_000);
    expect(iframe.hidden).toBe(true);

    receive({ kind: 'ready', maxV: 1 });
    expect(iframe.hidden).toBe(false);
    expect(notice()?.hidden ?? true).toBe(true);
    expect(sent()).toEqual([
      envelope({ kind: 'init', places }),
      envelope({ kind: 'focus', placeId: 'c' }),
    ]);
  });

  describe('일정 모드(draw)', () => {
    const pins: MapPin[] = [
      { id: 'a', label: '1 서혜커피', lng: 127.1, lat: 37.3, day: 0, role: 'stop' },
      { id: 'start:b', label: '🏠 장소 b', lng: 127.2, lat: 37.4, day: 0, role: 'endpoint' },
    ];
    const lines: MapLine[] = [
      {
        id: 'b>a',
        day: 0,
        walk: false,
        path: [
          [127.2, 37.4],
          [127.1, 37.3],
        ],
      },
    ];

    it('ready(maxV 2)이면 v 2 draw 다음 v 2 focus를 보낸다(부른 순서와 상관없이)', () => {
      const { port, receive, sent } = setup();
      port.focus('a');
      port.draw({ pins, lines });
      receive({ kind: 'ready', maxV: 2 });
      expect(sent()).toEqual([
        envelope({ kind: 'draw', pins, lines }, 2),
        envelope({ kind: 'focus', placeId: 'a' }, 2),
      ]);
      expect(sent().map((m) => m.v)).toEqual([2, 2]);
    });

    it('ready 뒤 draw·focus는 바로 v 2로 보내고 같은 종류는 마지막 것만 다시 보낸다', () => {
      const { port, receive, sent } = setup();
      receive({ kind: 'ready', maxV: 2 });
      expect(sent()).toEqual([envelope({ kind: 'init', places: toMapPlaces(makeDoc()) })]);
      port.draw({ pins, lines });
      port.draw({ pins: [], lines: [] });
      port.focus('start:b');
      expect(
        sent()
          .slice(1)
          .map((m) => [m.kind, m.v]),
      ).toEqual([
        ['draw', 2],
        ['draw', 2],
        ['focus', 2],
      ]);

      const before = sent().length;
      receive({ kind: 'ready', maxV: 2 });
      expect(sent().slice(before)).toEqual([
        envelope({ kind: 'draw', pins: [], lines: [] }, 2),
        envelope({ kind: 'focus', placeId: 'start:b' }, 2),
      ]);
    });

    it('ready(maxV 1)이면 v 1 init(라벨 색 장소)과 접두사를 뗀 focus만 보내고 draw는 보내지 않는다', () => {
      const { port, receive, sent, places } = setup();
      port.draw({ pins, lines });
      port.focus('start:b');
      receive({ kind: 'ready', maxV: 1 });
      expect(sent()).toEqual([
        envelope({ kind: 'init', places }),
        envelope({ kind: 'focus', placeId: 'b' }),
      ]);
      expect(sent().every((m) => m.v === 1 && m.kind !== 'draw')).toBe(true);

      // ready 뒤에 부르는 draw도 보내지 않고, focus는 접두사를 뗀다.
      port.draw({ pins, lines });
      port.focus('end:c');
      expect(sent().slice(2)).toEqual([envelope({ kind: 'focus', placeId: 'c' })]);
    });

    it('ready가 두 번 와도 두 번째에 마지막 draw를 다시 보낸다', () => {
      const { port, receive, sent } = setup();
      receive({ kind: 'ready', maxV: 2 });
      port.draw({ pins, lines });
      const before = sent().length;
      receive({ kind: 'ready', maxV: 2 });
      expect(sent().slice(before)).toEqual([envelope({ kind: 'draw', pins, lines }, 2)]);
    });

    it('select로 고른 핀은 다시 읽힌 지도에 focus로 되살린다', () => {
      const { port, receive, sent, onSelect } = setup();
      port.draw({ pins, lines });
      receive({ kind: 'ready', maxV: 2 });
      receive({ kind: 'select', placeId: 'start:b' });
      expect(onSelect).toHaveBeenCalledWith('start:b');
      const before = sent().length;
      receive({ kind: 'ready', maxV: 2 });
      expect(sent().slice(before)).toEqual([
        envelope({ kind: 'draw', pins, lines }, 2),
        envelope({ kind: 'focus', placeId: 'start:b' }, 2),
      ]);
    });

    it('draw를 부르지 않은 장소 모드는 maxV 2에서도 v 1 init이다', () => {
      const { port, receive, sent, places } = setup();
      port.focus('a');
      receive({ kind: 'ready', maxV: 2 });
      expect(sent()).toEqual([
        envelope({ kind: 'init', places }),
        envelope({ kind: 'focus', placeId: 'a' }),
      ]);
    });
  });
});

it('연결을 끝내면 message 리스너와 준비 타이머를 푼다', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const remove = vi.spyOn(window, 'removeEventListener');
  const handle = connectMapFrame(host, {
    mapUrl: 'https://map.test/',
    places: [],
    onSelect: vi.fn(),
  });
  handle.stop();
  expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
});

# Trip Map Virtual Place Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 500곳에서 기존 연속 스크롤·가변 높이 카드/목록·선택 이동을 유지하면서 화면 범위만 렌더링하고 동일 조건으로 성능을 재측정한다.

**Architecture:** `ViewPanel`은 스크롤 host를 명시적으로 제공하고 위치만 기록한다. 목록은 TanStack Virtual로 실제 CSS grid 행을 측정하며 Provider 메모리 cache와 pending selection을 관리한다. FakeMapAdapter의 marker와 polyline 갱신을 분리하고 기존 측정 harness의 완료 조건을 실제 표시 결과로 갱신한다.

**Tech Stack:** React 19.3, TypeScript 6, Jotai 3, MUI 7, Vite 8.3.2, React Compiler, Yarn 1.22.22, Vitest 5, Playwright, `@tanstack/react-virtual@3.14.13` (transitive `@tanstack/virtual-core@3.17.11`).

## Global Constraints

- 검토 기준 main: `3b36bdd9f1325f6c2264bdbd0e115d5f003c79f1` (2026-10-04 확인). 실행 시작 시 main 차이를 다시 확인한다.
- 이 문서는 구현 계획이다. 계획 작성 단계에서는 앱 코드를 변경하거나 구현 커밋·배포를 하지 않는다.
- 세 모드는 기능 뷰다. 별도의 디자인 테마 선택 + 기능 메뉴를 중첩하지 않는다.
- 화면 이름: `지도`, `일정`, `장소`. 공통 앱 이름·탐색 순서·아이콘·편집 문구를 유지하고 뷰별 부드러운 강조색만 다르게 한다.
- 기존 여행 JSON·EditLayer `schemaVersion: 1`, LWW 병합·되돌리기·Web Locks·storage event 처리를 유지한다. UI 선호와 초안을 편집 파일에 넣지 않는다.
- 기존 `?mode=explore|itinerary&day=<n>&place=<PlaceKey>` 링크와 `#e=...` 가져오기를 지원한다.
- 신규 뷰 쿼리: `view=map|day|places`. `day`는 기존 1부터 번호를 유지한다.
- 새 UI 프레임워크·아이콘 런타임·지도 라이브러리·원격 이미지 API·웹폰트·이모지 이미지 팩을 추가하지 않는다. 필요한 MDI 아이콘을 개별 정적 import한다.
- `.env`·시크릿·여행 원본 YAML·수집 파이프라인은 변경하지 않는다. 네이버 장소 연결은 기존 `naverPlaceUrl()`을 사용한다.
- GPS 추적·자동 다음 방문 판단·예약·새 즐겨찾기 상태·실시간 공동 편집은 범위에 넣지 않는다.
- 메모 2000자, 태그 20개/개당 30자, 하루 방문 50곳 등 기존 `LIMITS`와 입력 검증을 유지한다.
- 사용자 요청에 따라 웹 접근성 감사·인증을 별도 작업으로 넣지 않는다. 버튼 이름과 역할은 사용성과 기존 테스트를 위해 유지한다.
- 모든 새 기능에는 의미 있는 테스트를 추가한다. 기존 회귀 테스트를 삭제해 통과시키지 않는다.
- 커밋 전 `git diff --check`와 해당 diff를 확인한다. 관련 파일만 stage하고 Conventional Commits를 사용한다.


- 승인된 추가 설계: `outputs/implementation/2026-10-05/performance-followup-proposal.md`. 사용자 승인은 완료되었고 실행 방식은 새 implementer/task 및 두 단계 review이다. 재승인을 요구하지 않는다.
- 실행 checkout: `/private/tmp/trip-map-design-main-20261004`, 기존 branch `feature/responsive-views`, 시작 HEAD `e6b52fd1731ac9eda7307d56f3f35a15a305fb98`. 계획 작성자는 문서 workspace만 수정한다.
- worker-instructions의 “No new dependencies”는 승인된 직접 runtime dependency `@tanstack/react-virtual` 한 개에 한해 예외다. 다른 dependency, 도메인/스키마/데이터/.env 변경, 페이지화, push/merge/PR은 금지한다.
- 예산 유지: 전체 JS gzip 증가율 ≤20% 및 증가량 ≤75KiB, 초기 JS gzip 증가율 ≤15% 및 증가량 ≤50KiB, CSS 증가량 ≤10KiB, 아이콘 gzip 증가량 ≤10KiB. 각 조작 p95 ≤200ms; 원래 duration >100ms LongTask가 조작군별 2개 이상이면 FAIL. 워밍업5+표본30.
- `ViewPanel key={view}`와 MapView 단일 SDK 인스턴스를 보존한다. `testid`/closest로 production host를 찾지 않는다. React private introspection과 전역 Compiler 해제 금지.
- 실물 iPhone/Android, 유효 키 Naver SDK, WebKit capture/paint 미확인 상태를 별도 제한으로 유지한다. 측정 전 PASS를 예상하여 문서를 변경하지 않는다.

---

## 확인한 소스와 API

Serena initial_instructions → activate_project → 각 관련 파일 get_symbols_overview → ViewPanel find_symbol 순으로 읽었다. 기존 `useViewScroll`은 mount 때 즉시 scrollTop을 쓰고 PlaceList는 이미 mount된 DOM에 scrollIntoView를 호출한다. PlacesPanel은 모든 key의 요약을 미리 만든다. FakeMapAdapter는 두 setter 모두 전체 root를 재생성한다.

공식 [React API](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual), [Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)와 npm 게시 tarball의 실제 d.ts/source를 교차 확인했다. npm metadata의 React peer는 `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`; tarball integrity는 `sha512-JbDTAwtzZ99aOeCrAfW5EsE5KSq5RWh6Af2dtFwyLIIk48Ja7vm6n4axu/43T3vfjFnEGJalxJ1wyYjSQD6bSg==`이다. 사용 API는 useVirtualizer, defaultRangeExtractor, initialOffset, initialMeasurementsCache, scrollMargin, getItemKey, measureElement, scrollToIndex, takeSnapshot이다. React adapter는 stable mutable instance를 반환하므로 이를 읽는 `MeasuredPlaceRows` 함수만 `'use no memo'` 경계로 둔다. directDomUpdates는 사용하지 않는다. compiler 전체 설정은 바꾸지 않는다.

## 파일 책임 및 실행 순서

1. host/context/cache, 실제 CSS geometry 순수 helper와 테스트, dependency (독립 검토 가능).
2. VirtualPlaceRows + grid/list 연결 + pending selection + Provider 복원 + 실제 브라우저 기능 테스트 (하나의 사용자 기능).
3. FakeMapAdapter marker DOM 재사용/line 분리와 cleanup 테스트 (독립 검토 가능).
4. production browser 회귀·측정 harness·예산·증거 문서 (통과 여부에 따라 보고; 실패를 숨기지 않음).

각 task를 새 implementer가 실행하고 spec review → quality review → 수정 재검토 후 다음 task로 간다. 코드 블록은 적용할 실제 코드다. 기존 markup 이동은 아래 명시된 원본 범위를 그대로 옮기며 이름/동작을 바꾸지 않는다. 실행 중 HEAD 변화는 먼저 controller에 보고한다.

### Task 1: host, geometry 및 Provider cache 계약

**Files:** Create `src/sections/views/view-scroll-context.tsx`, `src/sections/explore/view/virtual-place-state.ts`, `tests/unit/sections/virtual-place-state.test.ts`; Modify `src/sections/views/use-view-scroll.ts`, `package.json`, `yarn.lock`.

**Interfaces:** `ViewScrollContext`는 `{ref: RefObject<HTMLDivElement|null>, element: HTMLDivElement|null, view: ViewMode}|null`; `virtualPlaceCacheAtom`은 Provider별 map/places 최신 cache만 보관한다. `columnsFromTemplate(template:string):number`; `rowsOf(keys:readonly string[], columns:number):string[][]`; `cacheKey(variant,width,columns,keys):string`. cache content는 실효 여행 객체 참조로 같은 이름/메모 편집 전후 높이를 재사용하지 않는다.

- [ ] **1. RED 테스트 작성** — `tests/unit/sections/virtual-place-state.test.ts` 전체:
```ts
import { createStore } from 'jotai';
import { expect, it } from 'vitest';
import { cacheKey, columnsFromTemplate, rowsOf, virtualPlaceCacheAtom } from 'src/sections/explore/view/virtual-place-state';
it('CSS가 계산한 track을 세고 마지막 행 순서를 보존한다', () => {
  expect(columnsFromTemplate('173px 173px')).toBe(2);
  expect(columnsFromTemplate('280px 280px 280px')).toBe(3);
  expect(columnsFromTemplate('280px 0px 0px')).toBe(1);
  expect(rowsOf(['a','b','c','d','e'],2)).toEqual([['a','b'],['c','d'],['e']]);
  expect(rowsOf([],2)).toEqual([]);
});
it('동일 길이 재정렬, 폭, 표시방식은 다른 cache이며 Provider를 격리한다', () => {
  const a = cacheKey('grid',390,2,['a','b']);
  expect(cacheKey('grid',390,2,['b','a'])).not.toBe(a);
  expect(cacheKey('grid',389,2,['a','b'])).not.toBe(a);
  expect(cacheKey('list',390,1,['a','b'])).not.toBe(a);
  const first=createStore(), second=createStore();
  first.set(virtualPlaceCacheAtom,{places:{key:a,content:{},offset:500,measurements:[]}});
  expect(second.get(virtualPlaceCacheAtom)).toEqual({});
});
```
- [ ] **2. RED 실행:** `yarn vitest run tests/unit/sections/virtual-place-state.test.ts`; 새 모듈 해석 실패를 기록한다.
- [ ] **3. 설치와 구현:** `yarn add --exact @tanstack/react-virtual@3.14.13`. lockfile 변경이 해당 패키지와 core뿐인지 확인한다. 신규 `virtual-place-state.ts` 전체:
```ts
import { atom } from 'jotai';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { ViewMode } from 'src/stores/ui-store';
export type PlaceVariant = 'grid' | 'list';
export type PlaceAnchor = {index:number;delta:number};
export type PlaceCache = { key:string; content:object; offset:number; measurements:VirtualItem[]; anchor?:PlaceAnchor };
export const virtualPlaceCacheAtom = atom<Partial<Record<ViewMode,PlaceCache>>>({});
export const placeScrollAckAtom = atom(0);
export function columnsFromTemplate(template:string):number {
  return Math.max(1,template.split(' ').filter(part=>Number.parseFloat(part)>0).length);
}
export function rowsOf(keys:readonly string[], columns:number):string[][] {
  const rows:string[][]=[];
  for(let i=0;i<keys.length;i+=Math.max(1,columns)) rows.push(keys.slice(i,i+Math.max(1,columns)));
  return rows;
}
export function cacheKey(variant:PlaceVariant,width:number,columns:number,keys:readonly string[]):string {
  return JSON.stringify([variant,width,columns,keys]);
}
```
`view-scroll-context.tsx` 전체:
```tsx
import { createContext, type RefObject } from 'react';
import type { ViewMode } from 'src/stores/ui-store';
export const ViewScrollContext=createContext<{
  ref:RefObject<HTMLDivElement|null>; element:HTMLDivElement|null; view:ViewMode;
}|null>(null);
```
`use-view-scroll.ts`의 함수 선언을 아래로 바꾸고, 기존 대입을 조건문으로 바꾸며 dependency에 restore를 넣는다. 나머지 위치 기록 코드는 그대로 유지한다.
```ts
export function useViewScroll(ref: RefObject<HTMLElement | null>, view: ViewMode, restore = true): void {
  const store = useStore();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (restore) element.scrollTop = store.get(viewScrollAtom)[view];
    const remember = () => store.set(viewScrollAtom, positions => ({...positions,[view]:element.scrollTop}));
    element.addEventListener('scroll',remember,{passive:true});
    return () => { remember(); element.removeEventListener('scroll',remember); };
  },[ref,store,view,restore]);
}
```
- [ ] **4. GREEN:** `yarn vitest run tests/unit/sections/virtual-place-state.test.ts tests/unit/components/view-scroll.test.tsx`; `yarn typecheck`; `yarn eslint src/sections/views/use-view-scroll.ts src/sections/views/view-scroll-context.tsx src/sections/explore/view/virtual-place-state.ts tests/unit/sections/virtual-place-state.test.ts`. 예상은 해당 tests PASS와 종료코드0이며 실행 결과를 기록한다.
- [ ] **5. 검토/커밋:** `git diff --check`; `git diff -- package.json yarn.lock src/sections/views src/sections/explore/view/virtual-place-state.ts tests/unit/sections/virtual-place-state.test.ts`; 위 파일만 stage; `git commit -m "feat: add virtual place scroll host and session cache"`.

### Task 2: 가변 행·선택 이동·목록 연결

**Files:** Create `src/sections/explore/view/VirtualPlaceRows.tsx`, `tests/unit/components/virtual-place-rows.test.tsx`; Modify `src/sections/explore/view/PlacesPanel.tsx`, `src/sections/explore/view/PlaceList.tsx`, `src/layouts/ResponsiveTripLayout.tsx`, `tests/unit/components/places-panel.test.tsx`, `tests/e2e/views.spec.ts`. Task1의 `src/sections/views/view-scroll-context.tsx`와 `src/sections/explore/view/virtual-place-state.ts` 최종 interface를 소비하며 Task2에서 다시 고치지 않는다.

**Interfaces:** `VirtualPlaceRows({keys,variant,content,ready,renderPlace})`; content는 effective 객체 또는 trip; ready=false 동안 요청을 ack하지 않는다. 실제 host 없음은 standalone 렌더 계약이며, 실제 앱의 60개 이하는 가상화 측정 비용을 피하는 bounded product fast path로 전체 markup을 유지한다(최대60개의 요약만 계산). 큰 fixture를 작게 바꾸거나 stress 측정을 이 경로로 우회하지 않는다. 실제 host가 있으면 작은 목록도 이 컴포넌트가 복원의 유일한 주체다. cache는 view당 최신1개다. layout signature가 같으면 위치를 복원하되 높이 measurements는 content 참조까지 같은 경우에만 재사용한다. signature 불일치만 offset0으로 보정한다. 현재 mount 중 content 변경은 스크롤 초기화 조건이 아니다. 측정 목록은 content 변경 시 현재 행 index/행내 위치를 유지하며 높이를 다시 측정한다. 원본 삭제/필터 제외는 ready일 때 현재 요청을 ack하며 나중에 같은 장소 재요청은 새 seq로 이동한다.

- [ ] **1. RED 테스트 작성:** `tests/unit/components/virtual-place-rows.test.tsx`:
```tsx
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VirtualPlaceRows } from 'src/sections/explore/view/VirtualPlaceRows';
import { placeScrollAckAtom, virtualPlaceCacheAtom } from 'src/sections/explore/view/virtual-place-state';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
import { selectedPlaceScrollRequestAtom } from 'src/sections/views/store/view-session';
import { selectedPlaceAtom } from 'src/stores/ui-store';
let originalScroll:PropertyDescriptor|undefined;
const scroll=vi.fn();
beforeEach(()=>{
  originalScroll=Object.getOwnPropertyDescriptor(Element.prototype,'scrollIntoView');
  scroll.mockReset();
  Object.defineProperty(Element.prototype,'scrollIntoView',{configurable:true,writable:true,value:scroll});
});
afterEach(()=>{
  cleanup();vi.restoreAllMocks();
  if(originalScroll)Object.defineProperty(Element.prototype,'scrollIntoView',originalScroll);
  else Reflect.deleteProperty(Element.prototype,'scrollIntoView');
});
it('데이터 준비 전 요청을 보존하고 준비된 행 측정 뒤 ack한다', async () => {
  const store=createStore(), content={};
  store.set(selectedPlaceAtom,'last'); store.set(selectedPlaceScrollRequestAtom,1);
  const draw=(ready:boolean)=><Provider store={store}><VirtualPlaceRows keys={ready?['first','last']:[]} variant="list" content={content} ready={ready} renderPlace={key=><button>{key}</button>} /></Provider>;
  const view=render(draw(false));
  expect(store.get(placeScrollAckAtom)).toBe(0);
  view.rerender(draw(true));
  await waitFor(()=>expect(store.get(placeScrollAckAtom)).toBe(1));
  expect(screen.getByRole('button',{name:'last'})).toBeInTheDocument();
  act(()=>store.set(selectedPlaceScrollRequestAtom,2));
  await waitFor(()=>expect(store.get(placeScrollAckAtom)).toBe(2));
  expect(scroll).toHaveBeenCalledTimes(2);
});
it('진행 중 요청이 filter/delete로 사라지면 예약 frame을 취소하고 다음 요청을 처리한다', async()=>{
  const callbacks=new Map<number,FrameRequestCallback>();let next=0;
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{callbacks.set(++next,callback);return next;});
  const cancel=vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>{callbacks.delete(id);});
  const store=createStore(),content={};
  store.set(selectedPlaceAtom,'last');store.set(selectedPlaceScrollRequestAtom,1);
  const draw=(keys:string[])=><Provider store={store}><VirtualPlaceRows keys={keys} variant="list" content={content} ready renderPlace={key=><button>{key}</button>}/></Provider>;
  const view=render(draw(['first','last']));
  expect(store.get(placeScrollAckAtom)).toBe(0);
  expect(callbacks.size).toBe(1);
  view.rerender(draw(['first']));
  expect(cancel).toHaveBeenCalled();expect(callbacks.size).toBe(0);
  expect(store.get(placeScrollAckAtom)).toBe(1);
  act(()=>{store.set(selectedPlaceAtom,'first');store.set(selectedPlaceScrollRequestAtom,2);});
  act(()=>{for(const [id,callback] of [...callbacks]){callbacks.delete(id);callback(0);}});
  await waitFor(()=>expect(store.get(placeScrollAckAtom)).toBe(2));
  act(()=>{store.set(selectedPlaceAtom,'first');store.set(selectedPlaceScrollRequestAtom,3);});
  view.unmount();expect(callbacks.size).toBe(0);expect(store.get(placeScrollAckAtom)).toBe(2);
});
it('활성 정적 목록 content 갱신은 offset을 유지하고 cache에는 최신 content를 기록한다',()=>{
  const store=createStore(),first={},second={},host=document.createElement('div');
  document.body.appendChild(host);
  Object.defineProperty(host,'clientWidth',{configurable:true,value:390});
  const ref={current:host};const keys=Array.from({length:60},(_,i)=>String(i));
  const draw=(content:object)=><Provider store={store}><ViewScrollContext value={{ref,element:host,view:'places'}}><VirtualPlaceRows keys={keys} variant="list" content={content} ready renderPlace={key=><button>{key}</button>}/></ViewScrollContext></Provider>;
  const view=render(draw(first),{container:host});host.scrollTop=420;
  view.rerender(draw(second));expect(host.scrollTop).toBe(420);
  view.unmount();expect(store.get(virtualPlaceCacheAtom).places?.content).toBe(second);
  expect(store.get(virtualPlaceCacheAtom).places?.offset).toBe(420);host.remove();
});
it('준비 완료 후 필터 제외·삭제된 대상은 ack하고 빈 목록을 표시한다', () => {
  const store=createStore();store.set(selectedPlaceAtom,'gone');store.set(selectedPlaceScrollRequestAtom,3);
  render(<Provider store={store}><VirtualPlaceRows keys={[]} variant="list" content={{}} ready renderPlace={key=><button>{key}</button>} /></Provider>);
  expect(store.get(placeScrollAckAtom)).toBe(3);
  expect(screen.queryByRole('button')).toBeNull();
});
```
- [ ] **2. RED:** `yarn vitest run tests/unit/components/virtual-place-rows.test.tsx`; 모듈 부재 FAIL을 기록한다.
- [ ] **3. 구현:** 다음 전체 코드를 새 파일에 배치한다. CSS probe는 카드와 같은 grid이며 desktop의 최대280px/최소160px 동작을 브라우저가 계산한다. 목록 앞 header offset은 RO로 다시 측정한다. 같은 grid 행을 한 측정 요소로 취급하며 masonry lanes를 쓰지 않는다.
```tsx
import Box from '@mui/material/Box';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue, useStore } from 'jotai';
import {
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FocusEvent,
} from 'react';
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
import {
  selectedPlaceScrollRequestAtom,
  viewScrollAtom,
} from 'src/sections/views/store/view-session';
import { selectedPlaceAtom } from 'src/stores/ui-store';
import {
  cacheKey,
  columnsFromTemplate,
  placeScrollAckAtom,
  rowsOf,
  virtualPlaceCacheAtom,
  type PlaceVariant,
  type PlaceAnchor,
} from './virtual-place-state';

type Props = {
  keys: string[];
  variant: PlaceVariant;
  content: object;
  ready: boolean;
  renderPlace(key: string): ReactNode;
};
type Entry = {
  canRestore(host: HTMLDivElement): boolean;
  activate(host: HTMLDivElement): void;
};
type Geometry = {
  host: HTMLDivElement;
  width: number;
  columns: number;
  template: string;
  gap: number;
  margin: number;
};
const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
  '@media (min-width:768px)': { gridTemplateColumns: 'repeat(auto-fit,minmax(160px,280px))' },
  gap: 1.25,
};

export function VirtualPlaceRows(props: Props) {
  const context = useContext(ViewScrollContext);
  const root = useRef<HTMLDivElement>(null),
    probe = useRef<HTMLDivElement>(null);
  const activeHost = useRef<HTMLDivElement | null>(null);
  const entry = useMemo<Entry>(
    () => ({
      canRestore: (host) => activeHost.current !== host,
      activate: (host) => {
        activeHost.current = host;
      },
    }),
    [],
  );
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [probeCount, setProbeCount] = useState(props.variant === 'list' ? 1 : 2);
  useLayoutEffect(() => {
    const host = context?.element,
      box = root.current,
      ruler = probe.current;
    if (props.keys.length <= 60 || !host || !box || !ruler) return;
    const media = matchMedia('(min-width:768px)');
    const measure = () => {
      const style = getComputedStyle(ruler),
        rect = box.getBoundingClientRect();
      const width = ruler.getBoundingClientRect().width;
      const count =
        props.variant === 'list'
          ? 1
          : media.matches
            ? Math.min(props.keys.length, Math.max(2, Math.ceil(width / 160) + 1))
            : 2;
      if (count !== probeCount) {
        setProbeCount(count);
        setGeometry(null);
        return;
      }
      const template = style.gridTemplateColumns;
      const next = {
        host,
        width,
        columns: props.variant === 'grid' ? columnsFromTemplate(template) : 1,
        template,
        gap: props.variant === 'grid' ? parseFloat(style.rowGap) || 0 : 0,
        margin: rect.top - host.getBoundingClientRect().top - host.clientTop + host.scrollTop,
      };
      setGeometry((old) =>
        old &&
        Object.keys(next).every((key) => old[key as keyof Geometry] === next[key as keyof Geometry])
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(box);
    observer.observe(ruler);
    if (box.parentElement) observer.observe(box.parentElement);
    if (host.firstElementChild) observer.observe(host.firstElementChild);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, [context?.element, props.variant, props.keys.length, probeCount]);
  const virtual = !!context && props.keys.length > 60;
  return (
    <Box sx={{ p: props.variant === 'grid' ? 1.5 : 0 }}>
      <Box
        ref={root}
        sx={{ position: 'relative' }}
        data-place-count={props.keys.length}
        data-place-variant={props.variant}
      >
        <Box
          ref={probe}
          aria-hidden
          sx={{
            ...gridSx,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {Array.from({ length: probeCount }, (_, index) => (
            <span key={index} />
          ))}
        </Box>
        {virtual ? (
          geometry && geometry.host === context.element ? (
            <MeasuredPlaceRows
              key={cacheKey(props.variant, geometry.width, geometry.columns, props.keys)}
              {...props}
              entry={entry}
              geometry={geometry}
              host={context.element}
              view={context.view}
            />
          ) : null
        ) : (
          <StaticPlaceRows {...props} entry={entry} />
        )}
      </Box>
    </Box>
  );
}

function isAtOffset(host: HTMLDivElement, offset: number) {
  return Math.abs(host.scrollTop - offset) < 1;
}

function restoreOffset(host: HTMLDivElement, offset: number) {
  host.scrollTop = offset;
}

function StaticPlaceRows({
  keys,
  variant,
  content,
  ready,
  renderPlace,
  entry,
}: Props & { entry: Entry }) {
  const context = useContext(ViewScrollContext),
    store = useStore();
  const request = useAtomValue(selectedPlaceScrollRequestAtom),
    selected = useAtomValue(selectedPlaceAtom),
    ack = useAtomValue(placeScrollAckAtom);
  const nodes = useRef(new Map<string, HTMLElement>());
  const latestContent = useRef(content);
  useLayoutEffect(() => {
    latestContent.current = content;
  }, [content]);
  const identity = cacheKey(variant, context?.element?.clientWidth ?? 0, 1, keys);
  useLayoutEffect(() => {
    const host = context?.element;
    if (!host || !ready) return;
    const cached = store.get(virtualPlaceCacheAtom)[context.view];
    restoreOffset(host, cached?.key === identity ? cached.offset : 0);
    entry.activate(host);
    return () => {
      store.set(virtualPlaceCacheAtom, (old) => ({
        ...old,
        [context.view]: {
          key: identity,
          content: latestContent.current,
          offset: host.scrollTop,
          measurements: [],
        },
      }));
    };
  }, [context?.element, context?.view, store, identity, ready, entry]);
  useLayoutEffect(() => {
    if (!ready || request <= ack) return;
    const node = selected ? nodes.current.get(selected) : undefined;
    if (!node) {
      store.set(placeScrollAckAtom, request);
      return;
    }
    node.scrollIntoView?.({ block: 'nearest' });
    let frame = 0;
    const finish = () => {
      const host = context?.element;
      if (!host) {
        store.set(placeScrollAckAtom, request);
        return;
      }
      const rect = node.getBoundingClientRect(),
        bounds = host.getBoundingClientRect();
      const top = bounds.top + host.clientTop,
        bottom = top + host.clientHeight;
      if (
        rect.height > 0 &&
        rect.top >= top - 1 &&
        Math.min(rect.bottom, rect.top + host.clientHeight) <= bottom + 1
      ) {
        store.set(placeScrollAckAtom, request);
        return;
      }
      node.scrollIntoView?.({ block: rect.height > host.clientHeight ? 'start' : 'nearest' });
      frame = requestAnimationFrame(finish);
    };
    frame = requestAnimationFrame(finish);
    return () => cancelAnimationFrame(frame);
  }, [ready, request, ack, selected, keys, store, context?.element]);
  return (
    <Box
      component={variant === 'list' ? 'ul' : 'div'}
      aria-label={variant === 'list' ? '장소 목록' : undefined}
      sx={variant === 'grid' ? gridSx : { listStyle: 'none', m: 0, p: 0 }}
    >
      {keys.map((key) => (
        <Box
          component={variant === 'list' ? 'li' : 'div'}
          key={key}
          data-place-key={key}
          ref={(node: HTMLElement | null) => {
            if (node) nodes.current.set(key, node);
            else nodes.current.delete(key);
          }}
        >
          {renderPlace(key)}
        </Box>
      ))}
    </Box>
  );
}

const PlaceContent = memo(function PlaceContent({
  placeKey,
  renderPlace,
}: {
  placeKey: string;
  renderPlace: Props['renderPlace'];
}) {
  return renderPlace(placeKey);
});

function MeasuredPlaceRows({
  keys,
  variant,
  content,
  ready,
  renderPlace,
  geometry,
  entry,
  host,
  view,
}: Props & {
  entry: Entry;
  geometry: Geometry;
  host: HTMLDivElement;
  view: 'map' | 'day' | 'places';
}) {
  'use no memo';
  const store = useStore();
  const request = useAtomValue(selectedPlaceScrollRequestAtom),
    selected = useAtomValue(selectedPlaceAtom),
    ack = useAtomValue(placeScrollAckAtom);
  const rows = useMemo(() => rowsOf(keys, geometry.columns), [keys, geometry.columns]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const previousContent = useRef(content);
  const latestContent = useRef(content);
  useLayoutEffect(() => {
    latestContent.current = content;
  }, [content]);
  const getItemKey = useCallback((index: number) => JSON.stringify(rows[index]), [rows]);
  const [focused, setFocused] = useState<number | null>(null);
  const index = selected ? keys.indexOf(selected) : -1;
  const pending =
    ready && request > ack && index >= 0 ? Math.floor(index / geometry.columns) : null;
  const signature = cacheKey(variant, geometry.width, geometry.columns, keys);
  const [initial] = useState(() => {
    const cached = store.get(virtualPlaceCacheAtom)[view];
    return entry.canRestore(host) && cached?.key === signature
      ? {
          offset: cached.offset,
          measurements: cached.content === content ? cached.measurements : [],
          anchor: cached.content === content ? undefined : cached.anchor,
        }
      : undefined;
  });
  useLayoutEffect(() => {
    entry.activate(host);
  }, [entry, host]);
  const [contentAnchor, setContentAnchor] = useState<PlaceAnchor | null>(initial?.anchor ?? null);
  // The component opts out of compiler memoization for TanStack's mutable virtualizer.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: rows.length,
    useAnimationFrameWithResizeObserver: true,
    useScrollendEvent: true,
    getScrollElement: () => host,
    estimateSize: () => (variant === 'grid' ? 280 : 170),
    getItemKey,
    overscan: 3,
    gap: geometry.gap,
    scrollMargin: geometry.margin,
    initialOffset: initial?.offset ?? 0,
    initialMeasurementsCache: initial?.measurements,
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      if (pending !== null) indexes.add(pending);
      if (contentAnchor !== null) indexes.add(contentAnchor.index);
      if (focused !== null)
        for (const n of [focused - 1, focused, focused + 1])
          if (n >= 0 && n < rows.length) indexes.add(n);
      return [...indexes].sort((a, b) => a - b);
    },
  });
  useLayoutEffect(() => {
    return () => {
      const offset = host.scrollTop;
      const item = virtualizer.getVirtualItemForOffset(offset);
      const anchor = item ? { index: item.index, delta: offset - item.start } : undefined;
      store.set(virtualPlaceCacheAtom, (old) => ({
        ...old,
        [view]: {
          key: signature,
          content: latestContent.current,
          offset,
          measurements: virtualizer.takeSnapshot(),
          anchor,
        },
      }));
      store.set(viewScrollAtom, (old) => ({ ...old, [view]: offset }));
    };
  }, [store, view, signature, host, virtualizer]);
  useLayoutEffect(() => {
    if (previousContent.current === content) return;
    previousContent.current = content;
    const item = virtualizer.getVirtualItemForOffset(host.scrollTop);
    const anchor =
      contentAnchor ?? (item ? { index: item.index, delta: host.scrollTop - item.start } : null);
    virtualizer.measure();
    setContentAnchor(anchor);
  }, [content, contentAnchor, host, virtualizer]);
  useLayoutEffect(() => {
    if (!contentAnchor) return;
    if (request > ack) {
      setContentAnchor(null);
      return;
    }
    let frame = 0,
      stable = 0,
      previousSize = -1;
    const restore = () => {
      const key = rows[contentAnchor.index]?.[0];
      const row = key ? nodes.current.get(key)?.parentElement : null;
      if (!row) {
        frame = requestAnimationFrame(restore);
        return;
      }
      for (const node of nodes.current.values()) {
        const element = node.parentElement;
        if (element) virtualizer.measureElement(element);
      }
      const offset = virtualizer.getOffsetForIndex(contentAnchor.index, 'start');
      if (offset) {
        const delta = Math.min(
          contentAnchor.delta,
          Math.max(0, row.getBoundingClientRect().height - 1),
        );
        const maximum = Math.max(0, host.scrollHeight - host.clientHeight);
        const target = Math.min(maximum, Math.max(0, offset[0] + delta));
        const size = virtualizer.getTotalSize();
        stable = isAtOffset(host, target) && previousSize === size ? stable + 1 : 0;
        previousSize = size;
        if (stable >= 2) {
          setContentAnchor(null);
          return;
        }
        virtualizer.scrollToOffset(target, { behavior: 'auto' });
      }
      frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [contentAnchor, request, ack, rows, host, virtualizer]);
  useLayoutEffect(() => {
    if (!ready || request <= ack) return;
    if (pending === null || !selected) {
      store.set(placeScrollAckAtom, request);
      return;
    }
    let frame = 0,
      stable = 0,
      previousSize = -1,
      cancelled = false;
    const finish = () => {
      if (cancelled) return;
      const node = nodes.current.get(selected);
      if (node) {
        const row = node.parentElement;
        if (row) virtualizer.measureElement(row);
        const rect = node.getBoundingClientRect(),
          box = host.getBoundingClientRect();
        const top = box.top + host.clientTop,
          bottom = top + host.clientHeight;
        if (
          rect.height > 0 &&
          rect.top >= top - 1 &&
          Math.min(rect.bottom, rect.top + host.clientHeight) <= bottom + 1
        ) {
          const size = virtualizer.getTotalSize();
          stable = previousSize === size ? stable + 1 : 0;
          previousSize = size;
          if (stable >= 2) {
            store.set(placeScrollAckAtom, request);
            return;
          }
          frame = requestAnimationFrame(finish);
          return;
        }
        stable = 0;
      }
      virtualizer.scrollToIndex(pending, { align: 'start', behavior: 'auto' });
      frame = requestAnimationFrame(finish);
    };
    virtualizer.scrollToIndex(pending, { align: 'start', behavior: 'auto' });
    frame = requestAnimationFrame(finish);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [ready, request, ack, selected, pending, store, host, virtualizer]);
  const items = virtualizer.getVirtualItems();
  return (
    <Box
      data-place-columns={geometry.columns}
      component={variant === 'list' ? 'ul' : 'div'}
      aria-label={variant === 'list' ? '장소 목록' : undefined}
      sx={{
        height: virtualizer.getTotalSize(),
        position: 'relative',
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
    >
      {items.map((item) => (
        <Box
          component={variant === 'list' ? 'li' : 'div'}
          key={String(item.key)}
          data-index={item.index}
          ref={virtualizer.measureElement}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start - geometry.margin}px)`,
            display: variant === 'grid' ? 'grid' : 'block',
            gridTemplateColumns: geometry.template,
            columnGap: `${geometry.gap}px`,
          }}
          onFocusCapture={() => setFocused(item.index)}
          onBlur={(event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
          }}
        >
          {rows[item.index]!.map((key) => (
            <Box
              key={key}
              data-place-key={key}
              ref={(node: HTMLElement | null) => {
                if (node) nodes.current.set(key, node);
                else nodes.current.delete(key);
              }}
            >
              <PlaceContent placeKey={key} renderPlace={renderPlace} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

```

`ResponsiveTripLayout.tsx`에서는 다음 import와 두 교체만 수행한다.
```tsx
import { ViewScrollContext } from 'src/sections/views/view-scroll-context';
// 기존 useViewScroll(scrollRef, view) 자리를 대체:
useViewScroll(scrollRef, view, view === 'day');
// data-testid="view-scroll" Box 안의 {children}만 대체:
<ViewScrollContext value={{ref:scrollRef,element:scrollElement,view}}>{children}</ViewScrollContext>
```

**host 연결 (Task2):** Task1의 최종 `ViewScrollContext.element` 준비 신호를 사용하며 ref.current 변화에 의존하지 않는다. ViewPanel의 `scrollRef` 선언 뒤 state를 추가하고 기존 `ref={scrollRef}`를 callback ref로 바꾼다. `useCallback` import도 추가한다. 아래 코드는 초기 host null이면 큰 목록을 mount하지 않고, host 준비 시 반드시 재렌더한다.
```tsx
const [scrollElement,setScrollElement]=useState<HTMLDivElement|null>(null);
const attachScroll=useCallback((element:HTMLDivElement|null)=>{
  scrollRef.current=element;
  setScrollElement(element);
},[]);
// 기존 scroll Box의 ref:
ref={attachScroll}
// 기존 context value:
<ViewScrollContext value={{ref:scrollRef,element:scrollElement,view}}>{children}</ViewScrollContext>
```
Task1에서 확정한 `columnsFromTemplate`과 collapsed-track 테스트를 그대로 사용한다. probe child 수가 필요한 수와 다르면 `geometry=null`만 설정하고 반환한다. 맞는 개수가 DOM에 commit된 뒤 다음 layout 측정에서만 geometry를 공개한다. 따라서 같은 폭으로 돌아왔을 때 2열 임시 renderer가 mount되거나 유효 cache를 덮어쓰지 않는다. resize로 기존 renderer를 unmount할 때는 마지막 확정 geometry의 cache만 저장한다.

- [ ] **4. 기존 markup 연결 (원본 동작 그대로):**
  - `PlacesPanel.tsx` import에 VirtualPlaceRows 추가. `summaries = keys.flatMap(...)` 전체를 삭제. grid 분기의 기존 Box 전체를 다음 코드로 교체한다. PlaceTile import는 유지한다.
```tsx
<VirtualPlaceRows keys={keys} variant="grid" content={effective} ready={!!trip && !!effective} renderPlace={key=>{
  const summary=summarizePlace(trip,edit,effective,key);
  return summary?<PlaceTile summary={summary} onOpen={()=>open(summary.placeKey)} onAdd={()=>setDetail({kind:'add',placeKey:summary.placeKey})}/>:null;
}} />
```
  - `PlaceList.tsx`에서 React useEffect/useRef import와 `lastRequest`, `rows`, DOM scroll effect를 삭제한다. request atom은 setter만 유지한다: `const setRequest=useSetAtom(selectedPlaceScrollRequestAtom);`. `VirtualPlaceRows` import를 추가한다. 기존 `Box component="ul"`부터 닫는 Box까지 다음 변경을 적용한다. 기존 `keys.map((key)=>{...})` body에서 place/isSelected/summary/hidden 계산과 내부 ListItemButton/Button JSX는 그대로 유지하고, wrapper `<Box component="li" key={key} ref={...}>`를 `<Box>`로 교체한다. 함수 전체가 아닌 표현식의 실제 교체 계약:
```tsx
<VirtualPlaceRows keys={keys} variant="list" content={effective ?? trip} ready={!!trip && !!effective} renderPlace={(key)=>{
  const place=trip.places[key];
  if(!place)return null;
  const isSelected=key===selected;
  const summary=effective?summarizePlace(trip,edit,effective,key):null;
  const hidden=edit?.places[key]?.hidden?.value??false;
  return <Box>
    <ListItemButton selected={isSelected} aria-label={`${place.name} 상세`} aria-current={isSelected?'true':undefined} onClick={()=>{
      setSelected(key);setRequest(n=>n+1);setDetail({kind:'place',placeKey:key});setFocus(f=>({point:[place.lng,place.lat],seq:(f?.seq??0)+1}));
    }} sx={{display:'block'}}>
      <Typography component="span" sx={{fontWeight:600,display:'block'}}>{summary?`${summary.emoji} `:''}{place.name}</Typography>
      <Typography component="span" variant="caption" color="text.secondary" sx={{display:'block'}}>{place.category??'미분류'}{hidden?' · 숨김':''}{summary?` · 💬 ${summary.memoCount}`:''}</Typography>
      {summary && <>
        <Typography component="span" variant="caption" noWrap sx={{display:'block'}}>{summary.memoPreview||'메모 없음'}</Typography>
        <Box sx={{display:'flex',gap:0.5,flexWrap:'wrap',mt:0.5}}>{summary.dayLabels.slice(0,2).map(label=><Chip key={label} size="small" label={label}/>)}{summary.dayLabels.length>2 && <Typography variant="caption">+{summary.dayLabels.length-2}</Typography>}</Box>
      </>}
    </ListItemButton>
    <Button aria-label={`${place.name} 일정에 추가`} onClick={()=>setDetail({kind:'add',placeKey:key})} sx={{minHeight:44}}>일정에 추가</Button>
  </Box>;
}} />
```
기존 null trip/empty early return은 pending 소실 방지를 위해 VirtualPlaceRows를 항상 mount하도록 아래 branch로 교체한다. 데이터가 없는 동안 renderPlace가 호출되지 않으며 request는 ready=false로 남는다. grid PlacesPanel의 `if (!trip || !effective) return null`도 같은 원칙으로 아래 null-data 코드를 반환한다.
```tsx
// PlaceList:
if (!trip || keys.length === 0) return <>
  {trip && <Typography sx={{p:2}} color="text.secondary">조건에 맞는 장소가 없어요</Typography>}
  <VirtualPlaceRows keys={[]} variant="list" content={effective ?? trip ?? ts} ready={!!trip && !!effective} renderPlace={()=>null}/>
</>;
// PlacesPanel:
if (!trip || !effective) return <VirtualPlaceRows keys={[]} variant="grid" content={ts} ready={false} renderPlace={()=>null}/>;
```
- [ ] **5. 이전 요청 회귀 의미 보존:** 기존 `places-panel.test.tsx`의 mount/remount 테스트에서 초기 request5를 이미 처리한 상태로 만드는 `s.set(placeScrollAckAtom,5)`를 추가한다. 테스트 import에 `waitFor`를 추가하고 request6 뒤에는 `await waitFor(()=>expect(store.get(placeScrollAckAtom)).toBe(6));`, request7 뒤에는 `await waitFor(()=>expect(store.get(placeScrollAckAtom)).toBe(7));`를 삽입한 후 기존 spy 횟수 assertions를 유지한다. 새 요청을 mount 전에 받았으면 무시하는 옛 동작은 새로운 데이터준비/500번째 이동 테스트가 대체한다. 새 atom import만 추가하고 나머지 assertions는 삭제하지 않는다.
- [ ] **6. 브라우저 RED/GREEN — 아래 테스트를 tests/e2e/views.spec.ts에 추가한다.** 실제 native scroll/RO/가변 card 높이/viewport 열 변화/마지막 marker를 검증한다. fixture route는 request scope에서만 교체하고 원본 데이터 파일은 수정하지 않는다.
```ts
test('500곳 가변 행은 첫·중간·끝·왕복 복원·폭 변경과 마지막 marker 이동을 유지한다', async ({page})=>{
  test.setTimeout(180_000);
  const data=JSON.parse(await readFile(E2E_FIXTURE_FILE,'utf8'));
  const source=data.places['n:1001'];
  data.places=Object.fromEntries(Array.from({length:500},(_,i)=>[`n:${1001+i}`,{...source,sid:String(1001+i),name:`가상 장소 ${String(i+1).padStart(3,'0')}${i%3===0?' 아주 긴 장소 이름을 여러 줄에 걸쳐 표시합니다 '.repeat(4):''}`} ]));
  data.folders[0].count=500;
  await page.route('**/data/e2etest000001.json',route=>route.fulfill({json:data}));
  await openTrip(page,`${TRIP_PATH}?view=places`);
  const host=page.getByTestId('view-scroll');
  const rows=page.locator('[data-place-key]');
  await expect(page.locator('[data-place-count="500"]')).toBeVisible();
  await expect(page.locator('[data-place-key="n:1001"]')).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  const seen=new Set<string>();
  for(let pass=0;pass<2;pass++){
    await host.evaluate(el=>{el.scrollTop=0;});
    let previous=-1;
    for(let n=0;n<1000;n++){
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      for(const key of await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-place-key')!)))seen.add(key);
      const position=await host.evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
      if(position.top>=position.max-1 && position.top===previous)break;
      previous=position.top;
      await host.evaluate(el=>{el.scrollTop+=Math.max(40,el.clientHeight/2);});
    }
  }
  expect(seen.size).toBe(500);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  await host.evaluate(el=>{el.scrollTop=el.scrollHeight/2;});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const before=await host.evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await page.getByRole('button',{name:'장소',exact:true}).click();
  await expect.poll(async()=>Math.abs(await host.evaluate(el=>el.scrollTop)-before)).toBeLessThan(3);
  await page.setViewportSize({width:900,height:844});
  await host.evaluate(el=>{el.scrollTop=0;});
  await expect(page.locator('[data-place-key="n:1001"]')).toBeInViewport();
  const boxes=await rows.evaluateAll(nodes=>nodes.slice(0,8).map(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left};}));
  const firstLine=boxes.filter(box=>Math.abs(box.top-boxes[0]!.top)<1);
  const next=boxes.find(box=>box.top>boxes[0]!.top+1);
  expect(firstLine.length).toBeGreaterThan(0);
  expect(next!.top).toBeGreaterThanOrEqual(Math.max(...firstLine.map(box=>box.bottom)));
  await page.getByRole('button',{name:'지도',exact:true}).click();
  await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(500);
  await page.getByTestId('marker-n:1500').click();
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  await host.evaluate(el=>{el.scrollTop=0;});
  await page.getByTestId('marker-n:1500').click();
  await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
});
```
RED 실행은 Task2 코드 적용 전 `yarn playwright test tests/e2e/views.spec.ts --project=narrow-mobile -g '500곳 가변 행'`로 mounted count≥500 실패를 기록한다. GREEN에서는 같은 명령과 desktop을 실행한다. 길이가 긴 테스트 timeout은 해당 테스트의 시작에 `test.setTimeout(180_000)`으로 정한다. 기존 42개 fixture tests는 static 경로로 유지되며 기존 row7 직접 click도 유지된다.
- [ ] **7. 회귀/형식/커밋:** `yarn vitest run tests/unit/components/virtual-place-rows.test.tsx tests/unit/components/places-panel.test.tsx tests/unit/components/view-scroll.test.tsx tests/unit/components/trip-page.test.tsx tests/unit/components/trip-layout.test.tsx`; `yarn typecheck`; `yarn prettier --write src/sections/explore/view/VirtualPlaceRows.tsx src/sections/explore/view/PlacesPanel.tsx src/sections/explore/view/PlaceList.tsx src/layouts/ResponsiveTripLayout.tsx tests/unit/components/virtual-place-rows.test.tsx tests/unit/components/places-panel.test.tsx tests/e2e/views.spec.ts`; 해당 파일 eslint. `git diff --check`와 파일별 diff를 검토한 뒤 위 파일만 stage하고 `git commit -m "feat: virtualize place rows with measured selection and scroll restoration"`.

**검토 gate 및 Task2 소유 범위:** 아래 `Task 2 추가 필수 회귀: 복원/활성 편집/요청 우선순위`의 전체 native 테스트와 단위 테스트를 이 task의 RED/GREEN/commit에 포함한다. Task4로 기능 검증을 미루지 않는다. 헤더 높이/테마 spacing/viewport 변화, mobile2cols/desktop actual tracks, CSS probe 0px collapsed track, 같은 key의 effective content 변경 뒤 높이 재측정, 같은 여행 remount 복원·다른 Provider 분리, 요청 도중 filter/delete, focus 복귀 fallback, sheet half 첫 행/초안, observer/RAF cleanup. 아래 task4의 production matrix가 모두 이 계약을 확인하기 전 성능 완료를 선언하지 않는다.

### Task 3: FakeMapAdapter DOM 재사용

**Files:** Modify `src/components/map/FakeMapAdapter.ts`; Create `tests/unit/components/fake-map-reuse.test.ts`.

**Interfaces:** 기존 MapAdapter interface와 FAKE_BOUNDS export는 그대로다. `setMarkers`는 모든 id를 유지하되 변경된 label/selection만 갱신한다. `setPolylines`는 marker subtree를 만지지 않는다. destroy는 보관된 detached button을 눌러도 callback이 발생하지 않게 listener를 해제한다.

- [ ] **1. RED 테스트 — 새 테스트 파일 전체:**
```ts
import { expect, it, vi } from 'vitest';
import { FakeMapAdapter } from 'src/components/map/FakeMapAdapter';
import type { MapMarker } from 'src/components/map/MapAdapter';
it('500개 id와 click을 보존하고 line 갱신·동일 marker 입력에서 DOM을 재사용한다',async()=>{
  const host=document.createElement('div'),adapter=new FakeMapAdapter();
  const markers:MapMarker[]=Array.from({length:500},(_,i)=>({id:String(i),lng:128,lat:37,label:`장소${i}`,color:'#123456',clusterable:true}));
  await adapter.mount(host);adapter.setMarkers(markers);
  const buttons=[...host.querySelectorAll('button')];expect(buttons).toHaveLength(500);
  adapter.setPolylines([{id:'route',path:[[128,37],[129,38]],color:'#123456',dashed:true}]);
  expect([...host.querySelectorAll('button')]).toEqual(buttons);
  adapter.setMarkers(markers.map(marker=>({...marker})));
  expect(host.querySelector('[data-testid="marker-499"]')).toBe(buttons[499]);
  const click=vi.fn();adapter.onMarkerClick(click);buttons[499]!.click();expect(click).toHaveBeenCalledWith('499');
  adapter.setMarkers(markers.map(marker=>({...marker,selected:marker.id==='499'})));
  expect(buttons[499]).toHaveAttribute('aria-pressed','true');
  expect(host.querySelector('[data-testid="polyline-route"]')).toHaveAttribute('data-points','2');
  adapter.setMarkers(markers.slice(0,499));buttons[499]!.click();expect(click).toHaveBeenCalledTimes(1);
  adapter.destroy();buttons[0]!.click();expect(click).toHaveBeenCalledTimes(1);expect(host.children).toHaveLength(0);
});
```
- [ ] **2. RED:** `yarn vitest run tests/unit/components/fake-map-reuse.test.ts`; line setter로 DOM identity가 달라지는 FAIL을 기록한다.
- [ ] **3. 구현:** 기존 `clickCleanups`와 `render`를 없애고 아래 필드·함수로 대체한다. 기존 camera/resize/bounds/fit 메서드와 imports는 유지한다.
```ts
private markerRoot:HTMLElement|null=null;
private lineRoot:HTMLElement|null=null;
private markerNodes=new Map<string,{button:HTMLButtonElement;label:string;cleanup:()=>void}>();

private renderMarkers():void {
  const root=this.markerRoot;if(!root)return;
  const wanted=new Set(this.markers.map(marker=>marker.id));
  for(const [id,entry] of this.markerNodes) if(!wanted.has(id)){
    entry.cleanup();entry.button.remove();this.markerNodes.delete(id);
  }
  this.markers.forEach((marker,index)=>{
    let entry=this.markerNodes.get(marker.id);
    if(!entry){
      const button=document.createElement('button');button.type='button';
      button.setAttribute('data-testid',`marker-${marker.id}`);
      const click=()=>this.markerCb?.(marker.id);button.addEventListener('click',click);
      entry={button,label:'',cleanup:()=>button.removeEventListener('click',click)};
      this.markerNodes.set(marker.id,entry);
    }
    const {button}=entry;
    const label=JSON.stringify([marker.label??'',marker.color,marker.selected,marker.dimmed,marker.clusterable]);
    if(entry.label!==label){
      entry.label=label;
      if(marker.selected)button.setAttribute('aria-pressed','true');else button.removeAttribute('aria-pressed');
      if(marker.dimmed)button.dataset.dimmed='true';else delete button.dataset.dimmed;
      button.replaceChildren(createMarkerLabelElement(marker.label??'',marker.color,marker));
    }
    if(root.children[index]!==button)root.insertBefore(button,root.children[index]??null);
  });
}
private renderLines():void {
  const root=this.lineRoot;if(!root)return;
  const fragment=document.createDocumentFragment();
  for(const line of this.lines){
    const div=document.createElement('div');div.setAttribute('data-testid',`polyline-${line.id}`);
    div.dataset.dashed=String(line.dashed);div.dataset.color=line.color;div.dataset.points=String(line.path.length);
    fragment.appendChild(div);
  }
  root.replaceChildren(fragment);
}
```
기존 mount의 `this.render()` 한 줄을 다음으로 교체한다.
```ts
this.markerRoot=document.createElement('div');
this.lineRoot=document.createElement('div');
root.append(this.markerRoot,this.lineRoot);
this.renderMarkers();this.renderLines();
```
두 setter 전체:
```ts
setMarkers(markers:MapMarker[]):void {this.markers=markers;this.renderMarkers();}
setPolylines(lines:MapPolyline[]):void {this.lines=lines;this.renderLines();}
```
destroy 전체:
```ts
destroy():void {
  for(const entry of this.markerNodes.values())entry.cleanup();
  this.markerNodes.clear();this.markerCb=null;this.boundsCb=null;
  this.markers=[];this.lines=[];this.root?.remove();this.root=null;
  this.markerRoot=null;this.lineRoot=null;
}
```
- [ ] **4. GREEN:** `yarn vitest run tests/unit/components/fake-map-reuse.test.ts tests/unit/components/map-view.test.tsx tests/unit/components/map-lifecycle.test.tsx`; `yarn typecheck`; `yarn eslint src/components/map/FakeMapAdapter.ts tests/unit/components/fake-map-reuse.test.ts`. marker click/tap, lifecycle 회귀가 모두 통과해야 한다.
- [ ] **5. 커밋:** `git diff --check`; `git diff -- src/components/map/FakeMapAdapter.ts tests/unit/components/fake-map-reuse.test.ts`; 두 파일만 stage; `git commit -m "perf: reuse fake map markers across independent layer updates"`.

### Task 4: production 검증 및 동일 조건 재측정

**Files:** Create `outputs/implementation/2026-10-05/task-11-measurements/measure-latency-virtual-hardened.cjs` 및 `latency-virtual-hardened/` 증거; Modify source `tests/e2e/views.spec.ts`의 새 테스트와 결과에 따른 기존 성능 문서만. 측정 스크립트/결과는 문서 workspace에 둔다.

**Interfaces:** 원본 `measure-latency-optimized.cjs`의 서버/fixture/capture event 시작점/run(5+30)/CDP/trace/LongTask 수집을 그대로 재사용한다. 완료 조건은 `[data-place-count]` 전체 결과와 `[data-place-key]` 실제 viewport 교집합의 이름/순서/위치를 확인한 뒤 다음 RAF다. 단순 선택 atom 변경, DOM count만 감소, timeout 임의 연장은 완료 조건이 아니다. JS/CSS/network budget baseline은 기존 task11 원시 파일을 사용한다.

- [ ] **1. 측정 계약 RED:** Task1 실행 전 source HEAD 고정 production fake 빌드를 먼저 실행하여 새 endpoint가 부재하므로 deadline FAIL인지 확인한다. 기존 소스가 이미 진행되었으면 보존 checkpoint 별도 복사본에서 실행하고 git checkout/reset으로 작업자의 변경을 되돌리지 않는다. 새 harness 자체 오류와 성능 FAIL을 분리한다.
- [ ] **2. 후속 공유 helper 및 hardened harness를 문서 workspace에서 실행한다.** 원본 harness를 지우지 않고 별도 파일의 전체 diff를 review한다.
이전 생성 예제의 세로 부분집합 endpoint는 Warning1로 폐기되었다. 역사적 brief/raw는 유지하며 후속 실행은 아래 공유 pure predicate 및 실제 DOM collector를 불러오는 별도 hardened harness를 사용한다. 실행 가능한 소스는 문서 workspace의 `task-11-measurements/place-viewport-endpoint.cjs`와 `measure-latency-virtual-hardened.cjs`다. 예전 harness를 다시 생성하거나 덮어쓰지 않는다.

```bash
node outputs/implementation/2026-10-05/task-11-measurements/endpoint-focused.cjs
node outputs/implementation/2026-10-05/task-11-measurements/endpoint-native-focused.cjs
node outputs/implementation/2026-10-05/task-11-measurements/measure-latency-virtual-hardened.cjs
```

공유 완료 검증/수집 코드(제품 코드에 넣지 않음):
```js
function validatePlaceViewport(s) {
 const rect = r => r && [r.left,r.right,r.top,r.bottom].every(Number.isFinite) && r.right>r.left && r.bottom>r.top;
 const intersects=(a,b)=>a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;
 const near=(a,b)=>Math.abs(a-b)<=1;
 const fail=reason=>({ready:false,reason});
 if(!rect(s.host)||!rect(s.list)||s.total!==s.expectedKeys.length||!Number.isInteger(s.columns)||s.columns<1||s.gap<0)return fail('invalid host/list/count/columns');
 if(!Array.isArray(s.tracks)||s.tracks.length!==s.columns||s.tracks.some(track=>!Number.isFinite(track)||track<=0)||!Number.isFinite(s.gap)||!Number.isFinite(s.columnGap))return fail('invalid tracks/gaps');
 const listVariant=s.variant==='list'||(!s.variant&&s.columns===1);
 if(listVariant?(s.columns!==1||s.gap!==0||s.columnGap!==0):!near(s.columnGap,s.gap))return fail('measured column gap mismatch');
 const horizontalSize=s.tracks.reduce((sum,track)=>sum+track,0)+(s.columns-1)*s.columnGap;
 if(horizontalSize>s.list.right-s.list.left+1)return fail('tracks exceed list width');
 const clip={left:Math.max(s.host.left,s.list.left),right:Math.min(s.host.right,s.list.right),top:Math.max(s.host.top,s.list.top),bottom:Math.min(s.host.bottom,s.list.bottom)};
 if(!rect(clip)){if(s.allowBelowViewport&&s.list.top>=s.host.bottom&&s.list.right>s.host.left&&s.list.left<s.host.right)return {ready:true,visibleKeys:[],visibleRows:[],coverage:{peekExcluded:true,host:s.host,list:s.list},rows:[]};return fail('no list intersection');}
 const rows=s.rows.filter(r=>rect(r.rect)&&intersects(r.rect,clip));
 if(!rows.length)return fail('no visible rows');
 const first=rows[0],last=rows.at(-1),totalRows=Math.ceil(s.expectedKeys.length/s.columns);
 const visibleKeys=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(!Number.isInteger(row.index)||row.index<0||row.index>=totalRows||!near(row.rect.left,s.list.left)||!near(row.rect.right,s.list.right))return fail('row index/horizontal bounds');
  if(i&&(row.index!==rows[i-1].index+1||!near(row.rect.top-rows[i-1].rect.bottom,s.gap)))return fail('nonconsecutive/overlapping/missing rows');
  const expected=s.expectedKeys.slice(row.index*s.columns,(row.index+1)*s.columns);
  if(row.cells.length!==expected.length||s.tracks.length!==s.columns)return fail('missing cells/columns');
  if(horizontalSize>row.rect.right-row.rect.left+1)return fail('tracks exceed row width');
  let x=row.rect.left;
  let maximum=0;
  for(let c=0;c<row.cells.length;c++){
   const cell=row.cells[c];
   if(cell.rect?.left<row.rect.left-1||cell.rect?.right>row.rect.right+1||cell.rect?.left<s.list.left-1||cell.rect?.right>s.list.right+1||cell.key!==expected[c]||!rect(cell.rect)||!near(cell.rect.left,x)||!near(cell.rect.right,x+s.tracks[c])||!near(cell.rect.top,row.rect.top)||cell.rect.bottom>row.rect.bottom+1||!cell.text.includes(s.expectedNames[cell.key]))return fail('cell key/name/geometry');
   maximum=Math.max(maximum,cell.rect.bottom);
   if(intersects(cell.rect,clip))visibleKeys.push(cell.key);
   x+=s.tracks[c]+s.columnGap;
  }
  if(!near(maximum,row.rect.bottom))return fail('row measured height');
 }
 if(!visibleKeys.length)return fail('no 2D-visible cells');
 if(first.rect.top>clip.top+s.gap+1||last.rect.bottom<clip.bottom-s.gap-1)return fail('viewport coverage gap');
 if(s.list.top>=s.host.top-1&&first.index!==0)return fail('wrong first row');
 if(s.list.bottom<=s.host.bottom+1&&last.index!==totalRows-1)return fail('wrong last row');
 return {ready:true,visibleKeys,visibleRows:rows.map(r=>r.index),coverage:{clip,firstTop:first.rect.top,lastBottom:last.rect.bottom,gap:s.gap},rows};
}
function collectPlaceViewport(expectedKeys,expectedNames) {
 const host=document.querySelector('[data-testid="view-scroll"]');
 const list=host?.querySelector('[data-place-count]');
 const box=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
 if(!host||!list)return {host:box(host),list:box(list),total:0,expectedKeys,expectedNames,columns:0,rows:[]};
 const renderer=list.querySelector('[data-place-columns]')??list.querySelector('[data-place-key]')?.parentElement;
 const firstRow=renderer?.querySelector('[data-index]');
 const style=getComputedStyle(firstRow??renderer??list);
 const tracks=list.dataset.placeVariant==='list'?[box(firstRow??renderer??list).right-box(firstRow??renderer??list).left]:style.gridTemplateColumns.split(' ').map(parseFloat).filter(n=>n>0);
 const columns=renderer?.hasAttribute('data-place-columns')?Number(renderer.getAttribute('data-place-columns')):list.dataset.placeVariant==='list'?1:tracks.length;
 if(columns===1&&!tracks.length)tracks.push(renderer?.clientWidth??0);
 const cells=row=>[...row.querySelectorAll('[data-place-key]')].map(cell=>({key:cell.getAttribute('data-place-key'),text:cell.textContent,rect:box(cell)}));
 const rows=firstRow?[...renderer.querySelectorAll('[data-index]')].map(row=>({index:Number(row.dataset.index),rect:box(row),cells:cells(row)})):renderer?[...renderer.querySelectorAll('[data-place-key]')].reduce((rows,cell,index)=>{const row=Math.floor(index/columns);(rows[row]??={index:row,rect:null,cells:[]}).cells.push({key:cell.dataset.placeKey,text:cell.textContent,rect:box(cell)});return rows;},[]).map(row=>({...row,rect:{left:box(renderer).left,right:box(renderer).right,top:Math.min(...row.cells.map(c=>c.rect.top)),bottom:Math.max(...row.cells.map(c=>c.rect.bottom))}})):[];
 const bounds=box(host);bounds.left+=host.clientLeft;bounds.top+=host.clientTop;bounds.right=bounds.left+host.clientWidth;bounds.bottom=bounds.top+host.clientHeight;
 return {variant:list.dataset.placeVariant,host:bounds,list:box(list),total:Number(list.dataset.placeCount),expectedKeys,expectedNames,columns,tracks,gap:firstRow?(list.dataset.placeVariant==='list'?0:parseFloat(getComputedStyle(list.querySelector('[aria-hidden]')??firstRow).rowGap)||parseFloat(style.columnGap)||0):parseFloat(style.rowGap)||0,columnGap:parseFloat(style.columnGap)||0,rows};
}
module.exports={validatePlaceViewport,collectPlaceViewport};
```

- [ ] **3. production browser로 native geometry를 검증한다.** source root에 일시적 `playwright.virtual.config.ts`를 아래로 만들고 task 종료 시 제거한다(커밋 제외). 원래 config와 E2E fixture setup/teardown을 그대로 사용한다. 기존 keyless SDK 테스트는 기존 config에서 실행하고, 여기서는 새 가상화 테스트만 실행한다.
```ts
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  webServer:{command:'yarn vite preview --host 127.0.0.1 --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:120_000},
});
```
```bash
VITE_MAP_ADAPTER=fake yarn build
CI=1 yarn playwright test --config=playwright.virtual.config.ts tests/e2e/views.spec.ts -g '500곳 가변 행'
```
추가 native CSS 비교를 Task2의 500곳 테스트에서 900px 변경 직전에 삽입한다. 마지막에 viewport를900으로 설정하는 기존 코드는 유지한다.
```ts
for(const width of [320,390,768,900,1280]){
  await page.setViewportSize({width,height:844});
  await host.evaluate(el=>{el.scrollTop=0;});
  await expect(page.locator('[data-place-key="n:1001"]')).toBeInViewport();
  await expect.poll(async()=>page.locator('[data-place-count="500"]').evaluate((list)=>{
    const cells=[...list.querySelectorAll<HTMLElement>('[data-place-key]')];
    if(cells.length<2)return false;
    const actual=cells.filter(cell=>Math.abs(cell.getBoundingClientRect().top-cells[0]!.getBoundingClientRect().top)<1).length;
    const reference=document.createElement('div');
    reference.style.cssText=`position:absolute;visibility:hidden;display:grid;width:${list.clientWidth}px;grid-template-columns:${innerWidth<768?'repeat(2,minmax(0,1fr))':'repeat(auto-fit,minmax(160px,280px))'};gap:10px;`;
    for(let i=0;i<Math.ceil(list.clientWidth/160)+1;i++)reference.appendChild(document.createElement('span'));
    document.body.appendChild(reference);
    const expected=getComputedStyle(reference).gridTemplateColumns.split(' ').filter(value=>parseFloat(value)>0).length;
    reference.remove();return actual===expected;
  })).toBe(true);
}
```
두 장소 이하로 필터한 static grid에서도 기존 CSS auto-fit이 collapse되는지는 기존 검색 textbox를 사용해 단일 결과로 검사한다. 500곳 테스트 마지막의 marker 재선택 완료 후 아래를 추가한다.
```ts
await page.getByRole('button',{name:'장소',exact:true}).click();
await page.getByRole('textbox',{name:'검색',exact:true}).fill('가상 장소 500');
await expect(page.locator('[data-place-count="1"]')).toBeVisible();
await expect(page.locator('[data-place-key]')).toHaveCount(1);
await page.getByRole('textbox',{name:'검색',exact:true}).fill('없을_검색어');
await expect(page.getByText('조건에 맞는 장소가 없어요')).toBeVisible();
await expect(page.locator('[data-place-key]')).toHaveCount(0);
```
이 비교의10px는 현재 MUI 기본 spacing8 ×1.25임을 확인한 값이다. theme spacing이 변경되면 reference의 gap은 실제 행 computedStyle columnGap을 읽어 사용하고 hard-coded 예상치를 늘리지 않는다.

- [ ] **4. 누수·빠른 스크롤·컨텐츠 무결성:** 기존 20회 순환 측정의 observer/listener 계수에 새 ResizeObserver와 scroll/mediaquery listeners를 포함하고 별도 측정 context에서만 계수한다. 비용 trace context에는 계수 patch를 주입하지 않는다. 다음 native observer 계수 init script를 해당 별도 context 생성 직후 사용한다. 이 코드는 관찰 대상별 active count를 측정하고 disconnect시 원복한다.
```js
await context.addInitScript(()=>{
  const Native=window.ResizeObserver;
  window.__resizeTargets=0;
  window.ResizeObserver=class extends Native {
    targets=new Set();
    observe(target,options){if(!this.targets.has(target)){this.targets.add(target);window.__resizeTargets++;}return super.observe(target,options);}
    unobserve(target){if(this.targets.delete(target))window.__resizeTargets--;return super.unobserve(target);}
    disconnect(){window.__resizeTargets-=this.targets.size;this.targets.clear();return super.disconnect();}
  };
});
```
초기 day 화면에서 count를 기록하고 `장소→지도→일정`20회 후 day 동일 settled state에서 원래 count인지 비교한다. source의 기존 `measure-subscriptions.cjs`가 사용하는 event 계수를 동일 별도 context에서 유지하고 scroll/resize/change도 포함한다. counts 증가를 허용하는 임의 tolerance를 넣지 않는다. marker500개와 지도 instanceId 동일, 선택 요청 후 detached RAF가 ack를 추가로 바꾸지 않는지 기능 테스트로 확인한다.

- [ ] **5. 지연 측정 실행:** document workspace에서 `node outputs/implementation/2026-10-05/task-11-measurements/measure-latency-virtual-hardened.cjs` 실행. 새 출력 디렉터리를 사용한다. Chromium 버전153.0.8010.12, viewport390×844, CPU4x, Node22.18.0/AppleM4 macOS26.1을 기존 metadata와 비교한다. 차이가 있으면 변경 환경에서의 결과라고 적고 원래 환경 재현까지 비교 PASS를 선언하지 않는다. fixture500/50, 워밍업5/표본30, 다섯 조작군을 확인한다. `analyze-trace.cjs`를 기존 방식으로 새 trace에 실행하되 원본 duration>100ms 조건을 유지한다. IO trace file은 실패 시에도 보존한다.

- [ ] **6. 예산/회귀:** 아래 명령을 실행하고 실제 종료코드와 요약을 남긴다.
```bash
yarn build:ci
yarn playwright test tests/e2e/views.spec.ts
git ls-files '*.ts' '*.tsx' '*.mjs' | xargs yarn eslint
node scripts/measure-ui-assets.mjs dist/assets
```
빌드후 fake production 빌드를 다시 만들고 측정한다(일반 build:ci가 dist를 덮어쓰기 때문). original baseline assets/current new assets/초기 network 비용, icon 없는 동일 source 빌드의 차이를 기존 measure-ui/reproduce-copies 절차로 다시 산출한다. 아이콘 제거 복사본을 검증 source로 사용하지 않는다.

- [ ] **7. 기계 판정 code:** workspace에서 다음 Python을 실행한다. 예산 파일 포맷은 기존 raw data의 실제 js/css gzipBytes를 사용하며 숫자를 보고서에 수동 복사하지 않는다. initial JS는 requests/files에서 `.js`만 합한다.
```python
import json
from pathlib import Path
base=Path('outputs/implementation/2026-10-05/task-11-measurements')
result=json.loads((base/'latency-virtual-hardened/interactions.json').read_text())
for group in result['measurements']:
    assert len(group['warmup'])==5 and len(group['samples'])==30
    values=sorted(row['duration'] for row in group['samples'])
    tasks={(task['startTime'],task['duration'],task['name']) for row in group['samples'] for task in row['longtasks'] if task['duration']>100}
    print(group['group'],{'p95':values[28],'over100':len(tasks),'pass':values[28]<=200 and len(tasks)<2})
old=json.loads((base/'baseline-assets.json').read_text())
new=json.loads((base/'hardened-assets.json').read_text())
def check(label,current,baseline,absolute,ratio=None):
    delta=current-baseline
    passed=delta<=absolute and (ratio is None or delta<=baseline*ratio)
    print(label,{'baseline':baseline,'current':current,'delta':delta,'pass':passed})
check('all-js',new['js']['gzipBytes'],old['js']['gzipBytes'],75*1024,.20)
check('css',new['css']['gzipBytes'],old['css']['gzipBytes'],10*1024)
initialOld=json.loads((base/'baseline-initial-assets.json').read_text())
initialNew=json.loads((base/'latency-virtual-hardened/initial-network.json').read_text())
for measurement in initialNew['measurements']:
    previous=next(row for row in initialOld['measurements'] if ('mode=itinerary' in row['url'])==(measurement['view']=='day'))
    baseline=sum(row['gzipBytes'] for row in previous['files'] if row['name'].endswith('.js'))
    current=sum(row['gzipBytes'] for row in measurement['files'] if row['name'].endswith('.js'))
    check('initial-js-'+measurement['view'],current,baseline,50*1024,.15)
noicons=json.loads((base/'hardened-noicons-assets.json').read_text())
check('icons',new['js']['gzipBytes'],noicons['js']['gzipBytes'],10*1024)
```
`hardened-assets.json` 생성 명령은 source root에서 `node scripts/measure-ui-assets.mjs dist/assets > '/Users/sch0718/Documents/ChatGPT/여행지도/outputs/implementation/2026-10-05/task-11-measurements/hardened-assets.json'`이다. 초기 baseline의 measurements/url/files 구조를 실제로 확인했다. map/places는 explore baseline, day는 itinerary baseline을 비교한다. 아래 명령은 입력 파일을 검토하기 위한 것이다.
```bash
python3 -m json.tool outputs/implementation/2026-10-05/task-11-measurements/baseline-initial-assets.json
python3 -m json.tool outputs/implementation/2026-10-05/task-11-measurements/budget-summary.json
```

- [ ] **8. 결과 문서/커밋 gate:** `latency-virtual-hardened/interactions.json`, trace-analysis, metadata, fixture, initial-network, assets, command logs를 보존하고 원래 FAIL 수치와 새 실측을 나란히 쓴다. 미달 조작은 FAIL로 유지하고 controller에게 병목 증거를 보고한다. 목표 완수/예산 인상으로 오기하지 않는다. 변경된 tracked 문서·테스트만 diff 검토 후 `test: verify virtual place rendering and performance budgets`로 커밋한다. untracked 운영 scratch 파일이나 대용량trace를 stage하지 않는다. source HEAD bundle/source patch/durable 결과 보존은 controller가 한다.

## 자체 검토 및 인수 기준

- 승인안의 host, card/list, 실제 가변 row, CSS 열 수, cache bounded/provider/content, 요청 pending/index/measure/ack, Fake marker500/lines/cleanup, 동일 measurement는 각각 Task1/2/3/4에 대응한다.
- 성능 PASS는 예상하지 않는다. 테스트 red/green과 실제 production 측정으로만 결정한다.
- 코드/함수/atom명은 이 문서의 정의와 일치해야 하며 clone/fixture 내부 문자열 교체는 assert로 원본 변경을 탐지한다.
- 측정 지연/용량/실제 SDK 제한은 구현 완료 뒤에만 값으로 채운다. 계획 자체는 결과 문서가 아니다.

### Task 2 추가 필수 회귀: 60↔61 경계

아래 테스트도 `tests/e2e/views.spec.ts`에 추가하고 production config의 `-g '500곳 가변 행|60과61 경계'`로 실행한다. 60은 product fast path 상한이며 모든 500곳 검증을 대체하지 않는다.
```ts
test('60과61 경계에서 필터 왕복·선택·복원 소유자가 일관된다',async({page})=>{
  const data=JSON.parse(await readFile(E2E_FIXTURE_FILE,'utf8'));
  const source=data.places['n:1001'];
  data.places=Object.fromEntries(Array.from({length:61},(_,i)=>[`n:${1001+i}`,{...source,sid:String(1001+i),name:`${i<60?'경계 포함':'경계 제외'} ${i+1}`} ]));
  data.folders[0].count=61;
  await page.route('**/data/e2etest000001.json',route=>route.fulfill({json:data}));
  await openTrip(page,`${TRIP_PATH}?view=places`);
  const host=page.getByTestId('view-scroll');
  await expect(page.locator('[data-place-count="61"]')).toBeVisible();
  expect(await page.locator('[data-place-key]').count()).toBeLessThan(61);
  await page.getByRole('textbox',{name:'검색',exact:true}).fill('경계 포함');
  await expect(page.locator('[data-place-count="60"]')).toBeVisible();
  await expect(page.locator('[data-place-key]')).toHaveCount(60);
  await host.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(page.locator('[data-place-key="n:1060"]')).toBeInViewport();
  const saved=await host.evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await page.getByRole('button',{name:'장소',exact:true}).click();
  await expect.poll(async()=>Math.abs(await host.evaluate(el=>el.scrollTop)-saved)).toBeLessThan(2);
  await page.getByRole('textbox',{name:'검색',exact:true}).fill('');
  await expect(page.locator('[data-place-count="61"]')).toBeVisible();
  await expect.poll(async()=>host.evaluate(el=>el.scrollTop)).toBe(0);
  await page.getByRole('button',{name:'지도',exact:true}).click();
  await page.getByTestId('marker-n:1061').click();await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1061"]')).toBeInViewport();
  await host.evaluate(el=>{el.scrollTop=0;});
  await page.getByTestId('marker-n:1061').click();await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1061"]')).toBeInViewport();
});
```

### Task 4 아이콘 비교 재현 코드

모든 구현 task 커밋 이후에 document workspace에서 실행한다. git archive는 새 임시 복사본에만 푼다. 원본 checkout/lock/dependency를 다시 바꾸지 않는다.
```python
from pathlib import Path
import io, re, subprocess, tarfile, tempfile
app=Path('/private/tmp/trip-map-design-main-20261004')
out=Path('/Users/sch0718/Documents/ChatGPT/여행지도/outputs/implementation/2026-10-05/task-11-measurements')
destination=Path(tempfile.mkdtemp(prefix='trip-map-virtual-noicons-',dir='/private/tmp'))
archive=subprocess.check_output(['git','archive','HEAD'],cwd=app)
with tarfile.open(fileobj=io.BytesIO(archive)) as packed:
    packed.extractall(destination,filter='data')
(destination/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
pattern=re.compile(r"import (\w+) from '~icons/mdi/[^']+';")
changed=0
for file in (destination/'src').rglob('*.tsx'):
    original=file.read_text()
    text,count=pattern.subn(r'const \1 = (_props: { width?: number; height?: number }) => null;',original)
    if count:file.write_text(text);changed+=count
assert changed>0
import os
env=dict(os.environ,VITE_MAP_ADAPTER='fake')
subprocess.run(['yarn','build'],cwd=destination,env=env,check=True)
assets=subprocess.check_output(['node',str(app/'scripts/measure-ui-assets.mjs'),str(destination/'dist/assets')])
(out/'hardened-noicons-assets.json').write_bytes(assets)
(out/'hardened-noicons-provenance.json').write_text(__import__('json').dumps({'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=app,text=True).strip(),'directory':str(destination),'replacedImports':changed},indent=2))
```

### 실행 전/후 반드시 확인할 세부 조건

- Task1은 context와 optional restore API를 정의하는 독립 deliverable이며, 기존 layout에서 restore를 끄는 연결은 Task2의 renderer 연결과 같은 커밋에 수행한다. 중간 커밋에서 스크롤 복원을 잃지 않는다.
- 모든 hook은 component의 조건부 return보다 앞에 있다. 정적/가상 분기는 별도 component이며 hook 수를 바꾸지 않는다.
- content만 바뀌면 공개 API에서 현재 행 index/행내 위치를 먼저 확보하고 `measure()`로 높이를 무효화한 뒤 해당 행을 pin·재측정하여 anchor를 복원한다. 최초 동일-content snapshot 복원 때는 `measure()`를 호출하지 않는다.
- header offset은 host 안의 panel 전체와 목록 probe에 대한 ResizeObserver로 갱신한다. resize와 media query listeners, RAF 모두 cleanup한다.
- 실제 request ack는 host 영역에서 대상 key의 DOM이 측정되고 보임을 확인한 뒤에만 수행한다. standalone 렌더는 실제 scroll host가 없으므로 기존 scrollIntoView 완료 다음 RAF를 경계로 삼는다.
- 소수 결과와 가상 경계를 바꾸어도 총 keys/검색 결과가 달라지지 않는다. 위치 정책은 signature 불일치→0(유효 범위), 동일→cache offset이다. content 불일치는 높이 snapshot만 무효화하고 행 anchor로 맥락을 복원한다. 활성 정적 목록은 content 업데이트로 scrollTop을 쓰지 않는다.

### 명시적 stage 범위

각 task의 모든 GREEN/review 완료 후 source root에서 해당 블록 하나만 실행한다. docs-only 계획 작성 중에는 실행하지 않는다.
```bash
git add package.json yarn.lock src/sections/views/use-view-scroll.ts src/sections/views/view-scroll-context.tsx src/sections/explore/view/virtual-place-state.ts tests/unit/sections/virtual-place-state.test.ts
git diff --cached --check
git diff --cached
git commit -m "feat: add virtual place scroll host and session cache"
```
```bash
git add src/sections/explore/view/VirtualPlaceRows.tsx src/sections/explore/view/PlacesPanel.tsx src/sections/explore/view/PlaceList.tsx src/layouts/ResponsiveTripLayout.tsx tests/unit/components/virtual-place-rows.test.tsx tests/unit/components/places-panel.test.tsx tests/e2e/views.spec.ts
git diff --cached --check
git diff --cached
git commit -m "feat: virtualize place rows with measured selection and scroll restoration"
```
```bash
git add src/components/map/FakeMapAdapter.ts tests/unit/components/fake-map-reuse.test.ts
git diff --cached --check
git diff --cached
git commit -m "perf: reuse fake map markers across independent layer updates"
```
Task4 문서의 실제 tracked 위치는 기존 결과 문서와 controller의 보존 위치를 따른다. 측정 raw data는 workspace artifact이며 source git에 임의로 대량 추가하지 않는다. Task4 추가 테스트를 Task2 전에 이미 포함하여 커밋했다면 중복 빈 커밋을 만들지 않는다.

### 계획 검증 기록 (작성 시점)

Python 코드 블록3개를 AST parse했으며 모두 문법 유효했다. 측정 harness 생성 코드를 파일 쓰기 없이 실행하여 원본에 대한 모든 정확 문자열 교체 assert를 통과했다. source HEAD는 e6b52fd1731ac9eda7307d56f3f35a15a305fb98 그대로이며 기존 untracked `.serena/`, `inspect-mobile.mjs`, `verify-concepts.mjs` 외 변경이 없다. 이 검증은 TypeScript 구현의 typecheck/실제 테스트를 대신하지 않는다. 각 task의 RED/GREEN과 production gate가 실행 결과를 결정한다.

### Task 2 추가 필수 회귀: 복원/활성 편집/요청 우선순위

**소유권:** 이 절의 helper와 테스트는 모두 `tests/e2e/views.spec.ts`에 추가하고 Task2에서 RED→GREEN→stage한다. Task4는 같은 테스트를 production build에서 다시 실행한다. 앱 코드에 테스트용 atom 노출이나 private React 조회를 추가하지 않는다. 다음 helper는 native host/fixture/DOM에만 접근한다.
```ts
async function useVirtualFixture(page:Page,count=500){
  const data=JSON.parse(await readFile(E2E_FIXTURE_FILE,'utf8'));
  const original=data.places['n:1001'];
  data.places=Object.fromEntries(Array.from({length:count},(_,index)=>[`n:${1001+index}`,{...original,sid:String(1001+index),name:`회귀 장소 ${String(index+1).padStart(3,'0')}`} ]));
  data.folders[0].count=count;
  await page.route('**/data/e2etest000001.json',route=>route.fulfill({json:data}));
}
async function firstVisiblePlace(page:Page){
  return page.getByTestId('view-scroll').evaluate(host=>{
    const bounds=host.getBoundingClientRect();
    const first=[...host.querySelectorAll<HTMLElement>('[data-place-key]')].find(node=>{
      const rect=node.getBoundingClientRect();return rect.bottom>bounds.top+1 && rect.top<bounds.bottom-1;
    });
    if(!first)throw new Error('visible place missing');
    return {key:first.dataset.placeKey!,top:first.getBoundingClientRect().top-bounds.top};
  });
}
async function nextTwoFrames(page:Page){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}

test('가상 복원 desktop 확정 열 이전에 임시 renderer가 cache를 덮어쓰지 않는다',async({page})=>{
  await page.setViewportSize({width:1600,height:900});
  await useVirtualFixture(page);await openTrip(page,`${TRIP_PATH}?view=places`);
  const host=page.getByTestId('view-scroll');
  const columns=Number(await page.locator('[data-place-columns]').getAttribute('data-place-columns'));
  expect(columns).toBeGreaterThan(2);
  await host.evaluate(node=>{node.scrollTop=node.scrollHeight*.55;});
  await nextTwoFrames(page);
  const before=await host.evaluate(node=>node.scrollTop),anchor=await firstVisiblePlace(page);
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await page.evaluate(()=>{
    const seen:number[]=[];
    const observer=new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(!(node instanceof Element))continue;
        const found=[...(node.matches('[data-place-columns]')?[node]:[]),...node.querySelectorAll('[data-place-columns]')];
        for(const row of found)seen.push(Number(row.getAttribute('data-place-columns')));
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
    Object.assign(window,{__virtualMountAudit:{seen,observer}});
  });
  await page.getByRole('button',{name:'장소',exact:true}).click();
  await expect.poll(async()=>Math.abs(await host.evaluate(node=>node.scrollTop)-before)).toBeLessThan(3);
  const after=await firstVisiblePlace(page);expect(after.key).toBe(anchor.key);expect(Math.abs(after.top-anchor.top)).toBeLessThan(3);
  const mounted=await page.evaluate(()=>{
    const audit=(window as unknown as {__virtualMountAudit:{seen:number[];observer:MutationObserver}}).__virtualMountAudit;
    audit.observer.disconnect();return audit.seen;
  });
  expect(mounted.length).toBeGreaterThan(0);expect(mounted.every(value=>value===columns)).toBe(true);
});

test('정적60 활성 메모 저장은 바닥 위치를 초기화하지 않고 왕복 cache도 최신이다',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await useVirtualFixture(page,60);await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('button',{name:'목록',exact:true}).click();
  const host=page.getByTestId('view-scroll');
  await host.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  const cell=page.locator('[data-place-key="n:1060"]');await expect(cell).toBeInViewport();
  const before=await host.evaluate(node=>node.scrollTop);
  await cell.getByRole('button',{name:'회귀 장소 060 상세',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'장소 상세'});
  await dialog.getByRole('button',{name:'메모 추가',exact:true}).click();
  await dialog.getByLabel('내 메모',{exact:true}).fill('저장 후에도 현재 목록 위치 유지');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();await submitNickname(page,'여행자');
  await expect(dialog.getByText('저장 후에도 현재 목록 위치 유지',{exact:true})).toBeVisible();
  expect(await host.evaluate(node=>node.scrollTop)).toBeCloseTo(before,0);
  await closeDetail(page);await expect(cell).toBeInViewport();
  expect(await host.evaluate(node=>node.scrollTop)).toBeCloseTo(before,0);
  await page.getByRole('button',{name:'일정',exact:true}).click();await page.getByRole('button',{name:'장소',exact:true}).click();
  await expect.poll(async()=>Math.abs(await host.evaluate(node=>node.scrollTop)-before)).toBeLessThan(2);
  await expect(cell).toContainText('저장 후에도 현재 목록 위치 유지');
});

test('가상500 활성 날짜 chip 추가는 높이를 재측정하며 현재 행 맥락과 새 cache를 유지한다',async({page})=>{
  await page.setViewportSize({width:390,height:844});await useVirtualFixture(page);await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('button',{name:'목록',exact:true}).click();
  const host=page.getByTestId('view-scroll');
  await host.evaluate(node=>{node.scrollTop=node.scrollHeight*.55;});await nextTwoFrames(page);
  const before=await firstVisiblePlace(page),cell=page.locator(`[data-place-key="${before.key}"]`);
  const height=(await cell.boundingBox())!.height;
  await cell.getByRole('button',{name:/일정에 추가$/}).click();
  await page.getByRole('button',{name:'Day 2 (11/15)',exact:true}).click();await submitNickname(page,'여행자');
  await expect(page.getByRole('dialog',{name:'일정에 추가'})).toBeHidden();
  await expect(cell).toContainText('Day 2');
  await expect.poll(async()=>(await cell.boundingBox())!.height).toBeGreaterThan(height);
  await expect.poll(async()=>(await firstVisiblePlace(page)).key).toBe(before.key);
  await expect.poll(async()=>Math.abs((await firstVisiblePlace(page)).top-before.top)).toBeLessThan(3);
  const saved=await host.evaluate(node=>node.scrollTop);
  await page.getByRole('button',{name:'일정',exact:true}).click();await page.getByRole('button',{name:'장소',exact:true}).click();
  await expect.poll(async()=>Math.abs(await host.evaluate(node=>node.scrollTop)-saved)).toBeLessThan(3);
  await expect(cell).toContainText('Day 2');expect((await cell.boundingBox())!.height).toBeGreaterThan(height);
});

test('가상500 opener가 화면 밖에서 unmount되면 상세 닫기 focus fallback을 유지한다',async({page})=>{
  await page.setViewportSize({width:390,height:844});await useVirtualFixture(page);await openTrip(page,`${TRIP_PATH}?view=places`);
  const opener=page.getByRole('button',{name:'회귀 장소 001 상세',exact:true});await opener.click();
  await expect(page.getByRole('dialog',{name:'장소 상세'})).toBeVisible();
  await page.getByTestId('view-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await expect(page.locator('[data-place-key="n:1001"]')).toHaveCount(0);
  await closeDetail(page);
  await expect(page.getByRole('navigation',{name:'보기 전환'}).getByRole('button',{name:'장소',exact:true})).toBeFocused();
});
```
새 요청 우선순위 test는 native500 map과 실제 날짜 추가 이벤트를 같은 JavaScript turn에 발생시킨다. DOM `.click()`은 테스트에서 공개 button을 누르는 용도이며 production에는 들어가지 않는다. 사용자 nickname은 먼저 등록하여 nested prompt가 순서를 바꾸지 않게 한다.
```ts
test('가상500 content anchor 복원보다 새 marker 요청이 우선하고 오래된 RAF가 되돌리지 않는다',async({page})=>{
  await page.setViewportSize({width:390,height:844});await useVirtualFixture(page);await openTrip(page,`${TRIP_PATH}?view=places`);
  await page.getByRole('button',{name:'회귀 장소 001 상세',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'장소 상세'});
  await detail.getByRole('button',{name:'메모 추가',exact:true}).click();await detail.getByLabel('내 메모',{exact:true}).fill('닉네임 등록');
  await detail.getByRole('button',{name:'저장',exact:true}).click();await submitNickname(page,'여행자');await closeDetail(page);
  await page.getByRole('button',{name:'지도',exact:true}).click();
  await page.getByTestId('marker-n:1300').click();await closeDetail(page);
  const middle=page.locator('[data-place-key="n:1300"]');await expect(middle).toBeInViewport();
  await middle.getByRole('button',{name:'회귀 장소 300 일정에 추가',exact:true}).click();
  await page.getByRole('button',{name:'Day 2 (11/15)',exact:true}).evaluate(button=>{
    (button as HTMLButtonElement).click();
    const marker=document.querySelector<HTMLButtonElement>('[data-testid="marker-n:1500"]');
    if(!marker)throw new Error('last marker missing');marker.click();
  });
  await expect(page.getByRole('dialog',{name:'장소 상세'})).toBeVisible();await closeDetail(page);
  await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  await nextTwoFrames(page);await expect(page.locator('[data-place-key="n:1500"]')).toBeInViewport();
  expect((await firstVisiblePlace(page)).key).not.toBe('n:1300');
});
```

Task2 RED 실행: 위 테스트를 코드 변경 전에 추가하고 `yarn playwright test tests/e2e/views.spec.ts --project=desktop -g '가상 복원|정적60 활성|가상500 활성|가상500 opener|가상500 content'`로 기존 전체 DOM·저장 위치·범위 부족 중 실제 실패를 기록한다. 기능 구현 후 같은 명령으로 GREEN을 확인한다. source에 테스트용 session state bridge를 만들지 않는다. Task4 production 재실행: `CI=1 yarn playwright test --config=playwright.virtual.config.ts tests/e2e/views.spec.ts -g '500곳 가변 행|60과61 경계|가상 복원|정적60 활성|가상500 활성|가상500 opener|가상500 content'`.

**Task2 복원/선택 소유권:** `request > ack` 동안 content-anchor effect는 즉시 state를 비우고, effect cleanup이 예약 RAF를 취소한다. index가 필터로 사라져 pending index가 null이어도 request seq 자체를 우선하므로 anchor가 재개되지 않는다. 선택 effect는 ready=false에서 대기하고, ready=true의 삭제/필터 제외는 ack, 재요청은 새 seq로 이동한다. key/signature 변경이나 unmount는 두 effect의 RAF cleanup을 실행한다. geometry가 pending인 동안에는 MeasuredPlaceRows가 없어서 캐시를 쓸 주체도 없다.

### Task 4 추가 필수 회귀: native observer와 scroll 이벤트 20회 cleanup

다음 테스트를 `tests/e2e/views.spec.ts`에 추가하고 별도 context인 이 테스트에서만 instrument한다. latency harness에는 아래 patch를 넣지 않는다. Task2에서 정의한 `useVirtualFixture`와 `nextTwoFrames`를 사용한다.
```ts
test('가상500 20회 왕복 후 observer와 scroll 구독 수가 복귀한다',async({page})=>{
  test.setTimeout(180_000);
  await page.addInitScript(()=>{
    const stats={targets:0,listeners:0};
    const Native=window.ResizeObserver;
    window.ResizeObserver=class extends Native {
      targets=new Set<Element>();
      observe(target:Element,options?:ResizeObserverOptions){
        if(!this.targets.has(target)){this.targets.add(target);stats.targets++;}
        super.observe(target,options);
      }
      unobserve(target:Element){if(this.targets.delete(target))stats.targets--;super.unobserve(target);}
      disconnect(){stats.targets-=this.targets.size;this.targets.clear();super.disconnect();}
    };
    const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
    const registrations=new WeakMap<EventTarget,Map<string,Set<EventListenerOrEventListenerObject>>>();
    const tracked=new Set(['scroll','scrollend','resize','change']);
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(listener && tracked.has(type)){
        const capture=typeof options==='boolean'?options:!!options?.capture;
        let target=registrations.get(this);if(!target){target=new Map();registrations.set(this,target);}
        const key=`${type}:${capture}`;let group=target.get(key);if(!group){group=new Set();target.set(key,group);}
        if(!group.has(listener)){group.add(listener);stats.listeners++;}
      }
      add.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener=function(type,listener,options){
      const capture=typeof options==='boolean'?options:!!options?.capture;
      if(listener && registrations.get(this)?.get(`${type}:${capture}`)?.delete(listener))stats.listeners--;
      remove.call(this,type,listener,options);
    };
    Object.assign(window,{__virtualLifecycle:stats});
  });
  await page.setViewportSize({width:390,height:844});await useVirtualFixture(page);await openTrip(page,`${TRIP_PATH}?view=map`);
  await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(500);
  await page.getByRole('button',{name:'일정',exact:true}).click();
  await nextTwoFrames(page);
  const snapshot=()=>page.evaluate(()=>({...((window as unknown as {__virtualLifecycle:{targets:number;listeners:number}}).__virtualLifecycle)}));
  const before=await snapshot();
  const mapId=await page.getByTestId('fake-map').getAttribute('data-instance-id');
  for(let cycle=0;cycle<20;cycle++){
    await page.getByRole('button',{name:'장소',exact:true}).click();await expect(page.locator('[data-place-count="500"]')).toBeVisible();
    await page.getByRole('button',{name:'지도',exact:true}).click();await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(500);
    await page.getByRole('button',{name:'일정',exact:true}).click();await expect(page.getByTestId('itinerary-panel')).toBeVisible();
  }
  await expect.poll(snapshot).toEqual(before);
  expect(await page.getByTestId('fake-map').getAttribute('data-instance-id')).toBe(mapId);
});
```
Task4 실행 명령에 `|가상500 20회`를 포함한다. counter snapshot은 동일 day/view/fixture 상태만 비교한다. scroll 방향·geometry 변경으로 활성이 필요한 동안의 observer 수를 누수로 오인하지 않는다. count를 맞추려고 listeners나 실제 marker를 생략하지 않는다.


## Task 4 실행 보완 기록 (2026-10-05)

역사적 Task2 실행 기록은 d2a4583 시점의 guard를 설명한다. 현재 위 실행 예제는 승인된 79c0bd0의 `VirtualPlaceRows.tsx`와 동기화했다. native scrollend는 설치된 virtualizer의 feature detection을 사용하며 미지원 환경은 기존 150ms fallback으로 정착한다. ResizeObserver 측정은 RAF로 처리한다. 연속 content 변경 중에는 최초 anchor를 유지하고, render된 행을 재측정한 뒤 offset와 총 높이가 두 frame 연속 안정된 경우에만 복원/선택 완료를 인정한다. 정적 대형 행은 host 시작점으로 보정한다. 복원 target은 `host.scrollHeight - host.clientHeight`의 실제 최대값으로 clamp하며, 범위를 벗어난 목표를 기다리는 RAF를 남기지 않는다. content 복원보다 새 선택 request가 우선하고 effect cleanup이 예약 RAF를 취소한다. 동일 content snapshot은 불필요한 `measure()` 없이 복원한다. 실물 모바일 momentum/유효 Naver SDK와 WebKit capture/paint는 별도 미확인 항목이다.

Task4 실제 실행 결과: full CI 654 PASS, native E2E56 PASS/3 skip, production 신규27 PASS, 최종 단일 CSS collapse target native/production 각각3 PASS. 동일5+30 CPU4x p95 43.0/57.8/107.0/76.7/139.4ms, 원본 >100ms LongTask0/0/0/0/2로 지도 조작군의 긴 작업 기준은 FAIL이다. 스크롤 >100ms3건도 기록했다. 다운로드 예산과20cycle cleanup은 PASS다. 실제 수치/조건/제한 및 보존 증거는 `docs/ui-performance.md`와 외부 Task4 report를 따른다.


## 승인된 Task5·6 및 Warning1 후속 검증

Task5 `9d08c10`은 visualViewport 높이를 snapshot마다 읽지 않고 resize 때 갱신한 snapshot을 재사용한다. Task6 `79c0bd0`는 provider/content/handler 계약을 유지하면서 PlaceContent·카드·chip를 memo하여 scroll offset 변화만으로 전체 retained content를 다시 렌더하지 않는다. viewport cache의 resize/cleanup과 retained renderer의 content/callback 변경 회귀 단위 테스트를 추가했으며 full CI는664개 테스트로 검증했다. canonical VirtualRows 예제는 해당 실제 source와 일치한다.

새 endpoint는 host/list의 실제2차원 교집합과 양수크기, data-index 연속row, expectedKeys의 각row slice, 실제column track/가로위치/가변행 높이/정확gap/viewport coverage를 검증한다. list는 CSS gridTemplateColumns 속성값을 쓰지 않고 display:block 행의 실제폭1track·gap0을 사용하며 grid는 실제track/probe gap을 읽는다. list 전체가 host 아래인 map peek만 유효geometry·count·marker500 확인하에 제외한다. Node 반례·nativeDOM 변형·실제품map peek/half/full과 동일 helper를 사용한다. 비용context에는 counter/Profiler patch가 없다. 원capture/완료다음RAF/5+30/CPU4x/LongTask 원duration/예산은 그대로이며 원가상화FAIL과 별도진단Profile을 새엄격실측으로 취급하지 않는다.

## Task4 강화 검증 최종 실행 기록

측정 제품 HEAD는 `79c0bd0692b4c7e54be89836bdc523be9c2ce8aa`다. 승인된 viewport snapshot 캐시와 retained content memo를 포함한다. Task4 후속 작업은 측정 helper와 문서만 변경했으며 제품 코드를 추가로 바꾸지 않았다. 원래 Task4 결과와 실패 trace는 아래 역사적 기록 및 별도 artifact에 보존했다.

독립 검토 Warning1의 반례(host 390×844, x=500..600인 카드)는 이전 완료 조건에서 잘못 통과했다. shared predicate는 양수 2D 교차, 정확한 row key slice·이름·순서·track 위치, 연속 행과 gap/overlap, viewport 위·아래 coverage 및 초기 row0을 검사한다. grid는 실제 2열/gap10, list는 실제 1열/gap0으로 수집한다. map peek의 목록이 host 아래인 정상 상태만 별도 제외한다. Node 반례 RED 1건을 확인한 뒤 18개 사례 GREEN, Chromium/WebKit DOM 12개 사례 및 실제 제품 grid/list/map peek·half·full 10개 사례를 확인했다. 예산·assertion·timeout은 완화하지 않았다.

Apple M4·macOS 26.1(25B78)·Node v22.18.0·Chromium 153.0.8010.12·390×844·CPU4x, production fake, 500곳/2일/하루50방문, 각 군 워밍업5+표본30이다. DOM capture 출발과 완료 후 다음 RAF를 유지했다. 비용 context에 구독 counter/Profiler를 넣지 않았다. sample과 겹친 LongTask의 원본 duration을 사용한다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 23.85 | 33.0 | 34.0 | 0 | PASS |
| 필터 | 27.55 | 40.3 | 42.2 | 0 | PASS |
| 장소→일정 | 81.55 | 112.4 | 167.3 | 3 | FAIL |
| 일정→장소 | 40.65 | 48.8 | 49.9 | 0 | PASS |
| 장소→지도 | 107.50 | 149.7 | 150.0 | 0 | PASS |

**전체 상호작용 예산은 FAIL**이다. p95≤200ms는 충족하지만 조작군별 >100ms 작업 2개 미만 조건을 장소→일정이 충족하지 못했다. day5/17/19 원본 duration은 101/160/104ms다. 해당 trace의 FunctionCall union은 92.010/152.704/95.976ms, Layout은 9.364/16.717/9.014ms, Paint는 2.085/2.891/2.594ms다. React microtask flush의 개별 FunctionCall은 89.411/145.748/90.471ms이고 Layout의 dirtyObjects713/total754가 관측됐다. phase는 겹칠 수 있다. 원 trace에는 실제 JS 함수 호출 스택/CPU Profile이 없어 특정 제품 함수나 날짜 Timeline 원인으로 확정하지 않는다. 15회 wheel(500px, 50ms 간격)의 원본 LongTask는 0건이다. 실물 touch 품질이나 FPS 판정은 아니다.

| **항목** | **기준 gzip B** | **최종 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298763 | 21890 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298763 | 21890 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD의 아이콘 제외→포함 | 297738 | 298763 | 1025 | PASS (10KiB 이내) |

초기 세 뷰마다 문서1·JS3·여행JSON1의 5요청, 외부 요청0, fake map instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive에서 정적 import10개만 제거한 별도 사본이다. CI는 `VITEST_MAX_WORKERS=2 yarn build:ci` 59파일/664테스트 PASS, tracked ESLint PASS, 전체 native56 PASS/3 조건부 skip, production 신규9×3=27 PASS다. 모바일 엔진은 실제 WebKit26.6, desktop/narrow는 Chromium이며 W1은 각각 PageUp/wheel이다. 기존 5폭 CSS 및 60↔61·바닥 축소·복원 검사를 유지했다.

별도 counter context의 20회 모두 before/after와 동일했다: RO2/targets4, 연결 event653/global8/tracked11, marker click500, mapId1. 증가 허용치를 두지 않았다.

측정 시작 UTC `2026-10-05T01:36:35.164Z`. 제품 tree SHA256 `3dae125916ab6c56dee7b2e3c037190fa6652e6a64f0e4a41c40b5e1859f963e`, 측정 dirty diff SHA256 `7e9266033b527088a54779825d152caaa89f5e3cd0cd16b32231a6be59991511`, helper SHA256 `2fb7011b5fa8bd9ba91adde9d43983947c0b3ad207bd840ae0e8e9d3829c9fb4`, harness SHA256 `6c30891e1b7960c1ec3efea7a701b10f27321a1147c8e4216e299c14944ded90`다. 측정 전·다섯 군 도중·후 제품 source와 metadata가 일치한다. 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-hardened/`, `hardened-lifecycle/`, `hardened-assets.json`, `hardened-noicons-assets.json`, `hardened-provenance-verification.json`, `virtual-command-logs/followup-*`가 원자료다. 전체 명령과 독립 검토 대응은 `virtual-task-4-followup-report.md`에 기록했다.

실물 iPhone/Android·유효 Naver SDK·WebKit 캡처/paint 제한은 미확인 상태를 유지한다.

## 승인된 Task7 공통 fresh day0 복원 생략

Task7 `17f7523`은 keyed ViewPanel에서 최초 day cache가 0이면 자연스러운 DOM0을 유지한다. lazy state로 권한을 고정해 사용자 scroll 기록이 바뀐 뒤 부모 재렌더가 복원 effect를 다시 실행하지 않는다. 양수 day cache는 복원하고 map/places의 기존 소유권, recording/cleanup 및 범용 useViewScroll 기본 restore=true/cached0 계약은 유지한다. Timeline/Dnd/geometry/domain/의존성은 변경하지 않았다. 실제 호출부는 다음과 같다.

```tsx
const store = useStore();
const [restoreScroll] = useState(() => view === 'day' && store.get(viewScrollAtom)[view] !== 0);
useViewScroll(scrollRef, view, restoreScroll);
```

Task8은 같은 shared hardened harness로 별도 output을 사용했다. 기존 원자료를 덮어쓰지 않으며 dispatchBase metadata만 환경변수로 지정한다.

```bash
MEASURE_OUT=latency-virtual-final MEASURE_BASE=17f75231fe42291f13c9d710df2df690adacc675 node outputs/implementation/2026-10-05/task-11-measurements/measure-latency-virtual-hardened.cjs
```

## Task8 공통 스크롤 수정 후 최종 검증

측정 제품 BASE/HEAD는 `17f75231fe42291f13c9d710df2df690adacc675`다. Task7은 새 일정 host의 캐시가 0일 때 불필요한 scrollTop setter를 생략하며, 양수 복원과 사용자 위치 기록·cleanup, 범용 훅의 기본 동작을 유지한다. Task8 제품 코드는 추가 변경하지 않았다.

승인된 shared hardened endpoint와 같은 production fake·500곳/2일/하루 50방문·DOM capture 출발·완료 다음 RAF·각 군 5워밍업+30표본·390×844·Chromium 153.0.8010.12·CPU4x를 유지한 완전한 한 번의 실행으로 판정했다. Apple M4/macOS26.1(25B78)/Node22.18.0 환경이며 비용 context에는 counter/Profiler를 넣지 않았다. 원 LongTask duration과 p95≤200ms·군별 >100ms 작업 2개 미만 예산을 유지했다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 27.95 | 37.7 | 43.8 | 0 | PASS |
| 필터 | 28.20 | 55.7 | 78.9 | 0 | PASS |
| 장소→일정 | 67.05 | 105.1 | 139.4 | 1 | PASS |
| 일정→장소 | 62.75 | 136.3 | 163.3 | 4 | FAIL |
| 장소→지도 | 120.05 | 147.8 | 152.9 | 0 | PASS |

**전체 상호작용 예산은 FAIL**이다. 모든 p95는 기준 안이고 장소→일정은 긴 작업 1건으로 기준 안이다. 일정→장소의 places6/7/8/9 원본 작업 start는 24531.8/25197.1/25821.1/26646.4ms, duration 121/103/151/124ms다. FunctionCall union 105.370/89.698/135.295/98.634ms, Layout 13.813/7.284/13.487/5.878ms, Paint 3.921/1.980/5.016/5.262ms다. 최대 개별 callback은 `index-_mqvaio7.js:9:136358` anonymous 95.167/85.499/126.722/90.100ms다. trace의 sample 구간에서 GC 이름의 duration X 이벤트는 관측되지 않았다. phase는 서로 겹칠 수 있으며 구체 제품 함수 원인을 확정하지 않는다. root의 별도 `latency-places-profile-final/`은 계측 overhead가 있는 진단 자료로 예산 판정에 포함하지 않는다.

스크롤 15회 wheel 500px/50ms 구간의 원본 LongTask는 1건(52ms),  >100ms 0건이다. 실물 touch/FPS 확인으로 해석하지 않는다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298815 | 21942 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298815 | 21942 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297789 | 298815 | 1026 | PASS (10KiB 이내) |

초기 세 뷰 각각 문서1·JS3·여행JSON1, 외부 요청0, fake instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive의 import10개만 제거한 사본이다. full CI 59파일/668테스트 PASS, tracked lint PASS, production 기존 가상화 9×3=27 PASS다. 20cycle 모두 RO2/targets4/events653/global8/tracked11/marker500/mapId1로 before/after와 정확히 같다. 전체 검증 뒤 fake build를 다시 복원했다.

native 첫 전체 실행은 **57 PASS/2 FAIL/3 조건부 skip, exit1**이었다. 기존 56개는 모두 PASS였고 새 일정 복원 사례의 default 3방문 fixture가 desktop/WebKit에서 스크롤하지 못했다. 새 사례만 50방문·49legs의 schema 검증된 데이터로 교정하고 WebKit 목록 내부 button focus→PageDown, Chromium wheel로 검증한 최종 focused 실행은 **3 PASS, exit0**다. 이것을 단일 전체 suite PASS로 합산하지 않는다. 50방문 교정 중 StopId/legs schema 실패와 Playwright의 기존 dayjs ESM import 오류, WebKit host div focus의 입력 실패도 별도 로그로 보존했다. assertion/timeout/제품/schema를 변경하지 않았다. 기존 W1 바닥 축소는 WebKit PageUp과 Chromium wheel을 유지했다.

측정 UTC `2026-10-05T02:05:30.268Z`, 제품 tree SHA256 `5ea84e127c177067a298f680140d00bf806448f4f8fae369107a9dbd3de7413b`, dirty diff SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`(빈 tracked diff), endpoint SHA256 `2fb7011b5fa8bd9ba91adde9d43983947c0b3ad207bd840ae0e8e9d3829c9fb4`, harness SHA256 `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`다. before/다섯 군 during/after 소스와 metadata 일치를 확인했다. 측정 이후 native test와 문서 변경은 원 측정 patch/hash와 구분한다. 원 Task4·강화 후속 FAIL 및 별도 진단 수치는 기존 역사적 기록에 남긴다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-final/`, `final-lifecycle/`, `final-assets.json`, `final-noicons-assets.json`, `final-provenance-verification.json`, `virtual-command-logs/final-*`다. 전체 명령/실패 이력은 `virtual-task-8-report.md`에 기록한다. 실제 mobile 엔진은 WebKit 26.6이며 실물 iPhone/Android·유효 Naver·WebKit capture/paint 제한은 계속 미확인이다.

## 승인된 Task9 pixel gap 및 고정 probe / 수평 endpoint 보강

Task9 `35cddd0`은 measured columnGap을 `${geometry.gap}px`로 적용해 MUI spacing 배수 변환을 제거했다. 초기 probe는 grid2/list1이고 mobile grid2 및 list1은 폭/160 탐색을 하지 않는다. desktop grid의 기존 auto-fit 탐색과 ResizeObserver/shared matchMedia change·cleanup은 유지한다. 동적 높이·cache·anchor·ack·adapter·Timeline·domain·의존성·예산은 변경하지 않았다. 위 VirtualPlaceRows 실행 예제는 이 실제 소스와 일치한다.

shared endpoint는 finite positive track/gap, grid 실제 columnGap≈측정gap, list1/gap0/columnGap0, track합+간격의 row/list 포함과 각카드 수평범위를 pixel epsilon1로 검사한다. 부분 세로행·desktop 잔여공간·map peek 제외는 유지한다. 위 helper 예제는 SHA256 `8b157e5ad649e81f5e94d50ec0b9ad0bbb210fc515b5405a09bb42da23205993`의 실제 코드다. Task9 독립 승인된 Node25/nativeDOM14/product24 focused는 Task10에서 불필요하게 반복하지 않았다.

Task8의 이전 gap10/columnGap80 snapshot은 당시 helper가 일부 잘린 카드를 허용했으므로 정상 grid 완료의 성능 인증으로 사용할 수 없다. 기존 p95와 W3 FAIL·원 trace는 역사적 자료로 보존하며 새 정상geometry strict 결과와 구분한다.

## Task10 실행 보완 기록

제품 BASE/측정 HEAD는 `35cddd0fb28af3053f15961e80826b5bff6d4528`다. Task9의 grid gap10px·모바일 2열/list 1열 및 모든 카드의 행/목록 가로 경계 검증을 적용했다. 제품 추가 변경 없이 한 번의 완전한 strict run을 보존했다. Task8의 실제 gap80px 결과는 역사적 FAIL이며 정상 grid 완료 인증으로 사용하지 않는다.

Apple M4/macOS26.1(25B78)/Node22.18.0/Chromium153.0.8010.12, production fake, 390×844, CPU4x, 500곳/2일/하루50방문, 각 군 5워밍업+30표본을 유지했다. DOM capture 출발→완료 다음 RAF, 원 LongTask duration, p95≤200ms·군별 >100ms 작업 2개 미만 예산을 유지했다. 비용 context와 counter/Profiler를 분리했으며 추가 strict 재실행은 하지 않았다. 비일정 140개 완료 snapshot 모두 실제 grid gap/columnGap10 또는 list0, 모든 카드 가로 경계, 연속 행·정확한 key/이름/순서·상하 coverage를 충족했다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 28.60 | 35.2 | 36.1 | 0 | PASS |
| 필터 | 32.05 | 41.5 | 43.9 | 0 | PASS |
| 장소→일정 | 78.25 | 135.0 | 141.0 | 4 | FAIL |
| 일정→장소 | 43.50 | 78.4 | 99.2 | 0 | PASS |
| 장소→지도 | 117.40 | 161.2 | 241.9 | 1 | PASS |

**전체 상호작용 예산은 FAIL**이다. 모든 p95는 PASS이고 장소→일정의 >100ms 작업 4건이 실패 조건이다. 지도 max241.9ms 자체는 승인된 예산 항목이 아니다. day15/16/21/24의 원 LongTask start는 17302.3/17731.2/19451.5/20530.2ms, duration122/106/115/101ms다. FunctionCall union123.949/106.450/108.447/98.712ms, Layout6.904/7.254/8.767/7.950ms, Paint2.241/2.037/2.847/2.738ms다. day16 MinorGC union23.064ms, 나머지는 해당 sample에서 GC duration X 이벤트가 관측되지 않았다. 최대 개별 anonymous callback `index-aUEFvew3.js:9:136358`은 114.816/97.861/105.709/94.724ms다. 겹치는 phase를 합산하지 않으며 날짜 Timeline이나 특정 제품 함수의 원인으로 단정하지 않는다. 스크롤 15회 wheel500px/50ms의 원 LongTask는 0건이다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 298843 | 21970 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 298843 | 21970 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297819 | 298843 | 1024 | PASS (10KiB 이내) |

초기 세 뷰 각각 문서1·JS3·여행JSON1, 외부 요청0, fake instance 장소/일정0·지도1이다. noicons는 같은 HEAD archive의 import10개만 제외한 사본이다. 별도 counter 20cycle 모두 before/after와 정확히 동일한 RO2/targets4/events653/global8/tracked11/marker500/mapId1이다. full CI 59파일/672테스트, tracked lint, 최종 fake build 복원은 exit0이다.

native 첫 전체는 **58 PASS/1 FAIL/3 skip, exit1**이며 새 일정 복원 WebKit 사례가 2RAF 중간 위치를 캡처했다. 별도 3회 진단에서 capture373→cleanup/restore572, capture294→cleanup/restore546을 확인했다. 마지막 기록과 실제 복원은 일치했다. 402px에서 약50ms 중간 정지 및 중간 scrollend도 관측되어 단일 scrollend를 종료로 쓰지 않았다. 승인된 새 사례의 캡처만 12연속 stable RAF로 교정했다. 제품·복원 오차2px·기존 assertion/timeout은 그대로다. 교정 후 focused3 PASS, **두 번째 전체 native59 PASS/3 skip, exit0**를 별도로 기록하며 첫 실패를 소급해 PASS로 바꾸지 않는다. Task8 focused3 PASS도 flake 부재를 보장한 결과가 아니다.

교정 후 production 신규10×3은 **29 PASS+1 FLAKY, exit0**다. mobile500 폭 변경 320→390에서 첫 n1001 조회가 원 timeout5000ms에 실패하고 retry가 통과했다. 저장 trace의 setter 직후 row0/offset0에서 다음 조회 시 offset38295·columns2·첫 row121/key n1243으로 바뀌고 renderer class가 변했다. 비동기 geometry remount/복원 순서는 후보이며 구체 호출 원인, 정확한 행 bounds 및 geometry 안정 후 실제 사용자 입력 안전성은 **Cannot verify**다. 추가 재실행/제품 수정/timeout·assertion 완화는 하지 않았다. 원 trace·screenshot·error·decoded snapshot을 보존했다.

측정 UTC `2026-10-05T04:23:40.716Z`, 제품 tree SHA256 `be976cf0ceebf149674cb5f2ba0e93e9116f4b69310d182e15f2ebcbe2c390ee`, 측정 tracked dirty diff는 빈 SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`다. source SHA256 `6d738bf56f85023ef072b974921c4cb8caa5e45b28298ab60f9da644691bfa22`, helper `8b157e5ad649e81f5e94d50ec0b9ad0bbb210fc515b5405a09bb42da23205993`, harness `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`를 고정했다. before/다섯 군 during/after HEAD/tree/dirty metadata가 일치한다. 측정 test SHA `845a2e521cd63b8f366a7544c2b832cf7bde944cbcd29537b711378e7a850e64`와 이후 test-only timing 교정을 구분한다. 제품 src diff는 BASE와 동일하다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-geometry-final/`, `geometry-final-provenance.json`, `geometry-final-lifecycle/`, `geometry-final-assets.json`, `geometry-final-noicons-*`, `geometry-day-diagnosis-summary.json`, `geometry-production-failure-snapshots.json`, `virtual-command-logs/geometry-*`다. 전체 명령·실패·진단 JSON 경로는 `virtual-task-10-report.md`에 기록했다. mobile은 실제 WebKit26.6, desktop/narrow는 Chromium이며 W1 PageUp/wheel을 유지했다. 실물 iPhone/Android touch·유효 Naver SDK·WebKit capture/paint는 미확인이다.


새 일정 복원 테스트의 2RAF 캡처만 진단 근거와 controller 승인에 따라 12연속 stable RAF로 변경했다. 나머지 테스트, 제품 코드와 예산은 유지한다. production 폭 변경 실패는 교정하지 않고 최종 검토에 넘긴다. Task9 helper focused 검증은 승인된 기존 증거를 사용하며 재실행하지 않았다.

## Task11 ownership 승인 및 Task12 실행 보완 기록

제품 BASE/측정 HEAD는 `f9f8fc202e51b3e17bf6b4bfe68146e52af511e5`다. Task11 Approved 소스는 같은 활성 host의 geometry remount에서 과거 compatible cache를 소비하지 않고 첫 measured 진입·새 host·진짜 view 왕복 복원을 구별한다. local ownership은 실제 commit에서만 기록하고 Provider cache에 DOM host를 넣지 않는다. Task12 제품·테스트 추가 변경은 없다. Timeline 범위 선택은 pending이며 수정하지 않았다.

같은 production fake·500곳/2일/하루50방문·390×844·Chromium153.0.8010.12·CPU4x·각 군5워밍업+30표본·DOM capture 출발→완료 다음RAF·원 LongTask duration으로 **한 완전 실행**을 판정했다. AppleM4/macOS26.1(25B78)/Node22.18.0 환경이다. 비용 context에는 Profiler/counter/다른 heavy 검사를 넣지 않았다. 최신 helper는 pixel gap·가로 bounds·정확 key/이름/순서·연속 행·상하 coverage를 강제한다. 비일정140 snapshot 모두 grid gap/columnGap10 또는 list0 및 모든 카드 가로 포함을 충족했다. 예산·fixture·assertion·timeout을 바꾸거나 선택적 재실행하지 않았다.

| **조작군** | **median ms** | **p95 ms** | **max ms** | **>100ms 수** | **판정** |
| :--- | ---: | ---: | ---: | ---: | :--- |
| 검색 | 45.95 | 60.4 | 63.1 | 0 | PASS |
| 필터 | 30.60 | 56.0 | 63.1 | 0 | PASS |
| 장소→일정 | 75.60 | 122.0 | 135.4 | 3 | FAIL |
| 일정→장소 | 36.50 | 49.5 | 54.5 | 0 | PASS |
| 장소→지도 | 107.25 | 135.5 | 139.5 | 0 | PASS |

**전체 성능 예산은 FAIL**이다. 모든 p95≤200ms는 PASS지만 장소→일정의 >100ms 원 LongTask3건은 군별2개 미만 기준을 충족하지 못한다. day16/26/31의 start는18217.2/21599.9/23334.2ms, 원 duration127/106/104ms다. 별도 `longtask-events.json`·`trace-analysis.json`에 원값과 sample별 phase union을 보존했다. 겹치는 phase를 합산하거나 원인을 Timeline/useSortable/특정 함수로 확정하지 않는다. 스크롤15회 wheel500px/50ms의 원 LongTask는0건이다. 이전 실행의 PASS 군을 조합해 현재 결과를 바꾸지 않는다.

| **항목** | **기준 gzip B** | **현재 gzip B** | **증가 B** | **판정** |
| :--- | ---: | ---: | ---: | :--- |
| 전체 JS | 276873 | 299000 | 22127 | PASS (20%·75KiB 이내) |
| 초기 JS, 세 뷰 각각 | 276873 | 299000 | 22127 | PASS (15%·50KiB 이내) |
| CSS | 0 | 0 | 0 | PASS (10KiB 이내) |
| 같은 HEAD 아이콘 제외→포함 | 297977 | 299000 | 1023 | PASS (10KiB 이내) |

세 뷰 초기 요청은 각각 문서1·JS3·여행JSON1, 외부0이며 fake map instance는 장소/일정0·지도1이다. noicons는 같은 HEAD archive에서 정적 import10개만 제외했다. 별도 counter20cycle 모두 before/after와 동일한 RO2/targets4/events653/global8/tracked11/marker500/mapId1이다. 전체 CI60파일678테스트·tracked lint·최종 fake build 복원은 exit0이다.

전체 native 첫 시작은 localhost5173 포트 경합으로 **test0실행/exit1**이었다. 해당 로그를 보존하고 listener 해제를 확인한 뒤 실제 전체를 실행했다. 실제 전체는 **68 first PASS/3 조건부 skip/0 FLAKY, exit0**다. production은 기존10+Task11신규3=13개×3문맥의 **39 first PASS/0 FAIL/0 FLAKY/0 skip, exit0**다. W6의 안정후/in-flight trusted 입력·390→320→390 과거cache 미복귀, desktop 정상 trailing 여백도 포함한다. 이미 승인된 Task11 focused33을 불필요하게 반복하지 않았다. helper 대기만으로 W6를 해결했다고 주장하지 않으며 승인된 source ownership 수정과 실제 회귀를 연결한다.

Task10의 정상geometry strict dayLong4 FAIL 및 production29PASS1FLAKY는 역사로 그대로 보존한다. 당시 폭 변경 원인 Cannot verify는 후속 whole-review에서 실제 W6 제품 결함으로 확인됐고 Task11 source fix/Task12 회귀를 별도로 추가했다. 과거 실패를 소급 PASS로 바꾸지 않는다. Task8 gap80 결과는 정상 grid 완료 인증에 사용하지 않는다. Task10 새 일정12stableRAF 캡처 교정·복원오차2·원 assertion/timeout은 유지한다.

측정 UTC `2026-10-05T10:12:57.130Z`, 제품 tree SHA256 `4278b5ce2b7213e179b89b2db94175b5e2462d1f1b12f012a8f9cae41d5e7506`, source SHA256 `8e77be5749ae82b0d761428c3757727d174c176324269ad6c584cb77315ca481`, test SHA256 `f253b793c89a0f17fe2d55e76dab8817f044bfc9e0e780722ec1f27a2b6feb7a`다. 측정 tracked dirty diff는 빈 SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`였다. helper `8b157e5ad649e81f5e94d50ec0b9ad0bbb210fc515b5405a09bb42da23205993`와 harness `73f1258cbdfbfa2497a38eccaa5ae7e372739b9e106819415d054777591de6d2`를 고정했다. before/다섯 군 during/after HEAD/tree/dirty 및 initial metadata가 일치한다. 이후 문서 dirty와 비용 당시 상태를 구별하며 제품·test는 BASE와 동일하다.

원자료는 문서 작업공간 `outputs/implementation/2026-10-05/task-11-measurements/`의 `latency-virtual-ownership-final/`, `ownership-final-provenance.json`, `ownership-final-native-started-artifacts/`, `ownership-final-production-artifacts/`, `ownership-final-lifecycle/`, `ownership-final-assets.json`, `ownership-final-noicons-*`, `virtual-command-logs/ownership-*`다. 전체 명령·exit·제한은 `virtual-task-12-report.md`에 남겼다. native mobile 실제 WebKit26.6, desktop/narrow Chromium이며 W1 PageUp/wheel·새 trusted 입력은 WebKit PageDown/Chromium wheel이다. 실물 iPhone/Android touch·유효 Naver SDK·WebKit capture/paint는 Cannot verify다. 영구clone/bundle 갱신과 전체 목표 최종 gate는 controller 후속이며 이 검증의 성능 FAIL을 전체 제품 승인으로 해석하지 않는다.

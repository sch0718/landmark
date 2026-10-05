import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog, DialogTitle, Menu, MenuItem, TextField } from '@mui/material';
import { TripLayout } from 'src/layouts/TripLayout';
import { VirtualPlaceRows } from 'src/sections/explore/view/VirtualPlaceRows';
import { ResponsiveTripLayout } from 'src/layouts/ResponsiveTripLayout';
import { sheetHeight, useLayoutKind, type LayoutKind } from 'src/layouts/layout-metrics';
import { detailFocusEnabled } from 'src/layouts/detail-focus';
import type { ViewMode } from 'src/stores/ui-store';
import { viewScrollAtom } from 'src/sections/views/store/view-session';
import { installMapResources } from './helpers/map-resources';

let resources: ReturnType<typeof installMapResources>;
beforeEach(() => {
  resources = installMapResources();
});
afterEach(() => {
  cleanup();
  resources.restore();
  vi.restoreAllMocks();
});
const padding = vi.fn();
const shared = {
  topBar: <div>상단</div>,
  panel: <button>목록 버튼</button>,
  unavailable: null,
  routeMapVisible: false,
  onMapPaddingChange: padding,
};
it('레이아웃과 뷰 변경에도 지도와 상세 host를 유지한다', () => {
  const mounted = vi.fn();
  function Sentinel() {
    useEffect(() => {
      mounted();
    }, []);
    return <div>지도 sentinel</div>;
  }
  const store = createStore();
  const wrap = (layout: LayoutKind, view: ViewMode) => (
    <Provider store={store}>
      <ResponsiveTripLayout
        {...shared}
        map={<Sentinel />}
        layout={layout}
        view={view}
        detail={{ open: true, content: <input aria-label="초안" />, onClose: vi.fn() }}
      />
    </Provider>
  );
  const { rerender } = render(wrap('compact', 'map'));
  const input = screen.getByLabelText('초안');
  rerender(wrap('split', 'day'));
  expect(input.closest('[data-detail-presentation]')).toHaveAttribute(
    'data-detail-presentation',
    'overlay',
  );
  rerender(wrap('wide', 'places'));
  expect(input.closest('[data-detail-presentation]')).toHaveAttribute(
    'data-detail-presentation',
    'docked',
  );
  expect(screen.getByLabelText('초안')).toBe(input);
  expect(mounted).toHaveBeenCalledTimes(1);
});
it('지도 실패 때 목록 상세 메뉴를 유지한다', () => {
  render(
    <Provider>
      <ResponsiveTripLayout
        {...shared}
        unavailable="지도 실패"
        map={<div>지도</div>}
        view="map"
        layout="compact"
        detail={{ open: true, content: <div>상세 내용</div>, onClose: vi.fn() }}
      />
    </Provider>,
  );
  expect(screen.getByTestId('trip-map-area')).toBeEmptyDOMElement();
  expect(screen.getByText('지도 실패')).toBeVisible();
  expect(screen.getByText('상세 내용')).toBeVisible();
  expect(screen.getByRole('navigation')).toBeVisible();
});
it('측정 body 높이로 시트를 제한하고 Space를 처리한다', async () => {
  render(
    <Provider>
      <ResponsiveTripLayout
        {...shared}
        map={<div />}
        view="map"
        layout="compact"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>,
  );
  resources.setSize(screen.getByTestId('trip-body'), 320, 400);
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '164px' }));
  const handle = screen.getByRole('button', { name: '시트 크기 조절' });
  handle.focus();
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  fireEvent(handle, event);
  expect(event.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '288px' }));
  expect(sheetHeight('full', 100)).toBe(52);
});
function FocusHarness({
  layout = 'compact',
  removeOpener = false,
  popup = 'none',
}: {
  layout?: LayoutKind;
  removeOpener?: boolean;
  popup?: 'none' | 'menu' | 'dialog';
}) {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState(false);
  return (
    <ResponsiveTripLayout
      {...shared}
      topBar={!removed && <button onClick={() => setOpen(true)}>상세 열기</button>}
      map={<div />}
      view="map"
      layout={layout}
      detail={{
        open,
        onClose: () => setOpen(false),
        content: (
          <div
            role="dialog"
            aria-label="장소 상세"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && detailFocusEnabled()) setOpen(false);
            }}
          >
            <input aria-label="초안" defaultValue="보존된 초안" />
            <button>첫 입력</button>
            {removeOpener && <button onClick={() => setRemoved(true)}>열기 버튼 제거</button>}
            {popup === 'menu' && (
              <>
                <button onClick={(event) => setAnchor(event.currentTarget)}>장소 메뉴</button>
                <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
                  <MenuItem>메뉴 하나</MenuItem>
                  <MenuItem>메뉴 둘</MenuItem>
                </Menu>
              </>
            )}
            {popup === 'dialog' && (
              <>
                <button onClick={() => setDialog(true)}>닉네임 입력</button>
                <Dialog
                  open={dialog}
                  onClose={() => setDialog(false)}
                  aria-labelledby="nickname-title"
                >
                  <DialogTitle id="nickname-title">닉네임</DialogTitle>
                  <TextField label="닉네임 값" />
                  <button onClick={() => setDialog(false)}>입력 닫기</button>
                </Dialog>
              </>
            )}
            <button onClick={() => setOpen(false)}>상세 닫기</button>
          </div>
        ),
      }}
    />
  );
}
const focusCase = (props: Parameters<typeof FocusHarness>[0] = {}) =>
  render(
    <Provider>
      <FocusHarness {...props} />
    </Provider>,
  );
it('modal 상세 Tab을 가두고 열기 버튼으로 복귀한다', async () => {
  focusCase();
  const opener = screen.getByRole('button', { name: '상세 열기' });
  await userEvent.click(opener);
  const first = screen.getByLabelText('초안');
  const last = screen.getByRole('button', { name: '상세 닫기' });
  first.focus();
  await userEvent.tab({ shift: true });
  expect(last).toHaveFocus();
  last.focus();
  await userEvent.tab();
  expect(first).toHaveFocus();
  await userEvent.click(last);
  await waitFor(() => expect(opener).toHaveFocus());
});
it('Escape 후 포커스를 복귀한다', async () => {
  focusCase();
  const opener = screen.getByRole('button', { name: '상세 열기' });
  await userEvent.click(opener);
  screen.getByLabelText('초안').focus();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(opener).toHaveFocus());
});
it('열기 버튼이 없으면 선택된 메뉴로 복귀한다', async () => {
  focusCase({ removeOpener: true });
  await userEvent.click(screen.getByText('상세 열기'));
  await userEvent.click(screen.getByText('열기 버튼 제거'));
  await userEvent.click(screen.getByText('상세 닫기'));
  await waitFor(() =>
    expect(
      within(screen.getByRole('navigation')).getByRole('button', { name: /^지도$/ }),
    ).toHaveFocus(),
  );
});
for (const popup of ['menu', 'dialog'] as const)
  it(`중첩 ${popup} Escape는 자식만 닫는다`, async () => {
    focusCase({ popup });
    await userEvent.click(screen.getByText('상세 열기'));
    const button = screen.getByText(popup === 'menu' ? '장소 메뉴' : '닉네임 입력');
    await userEvent.click(button);
    await screen.findByRole(
      popup === 'menu' ? 'menu' : 'dialog',
      popup === 'dialog' ? { name: '닉네임' } : {},
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole(
          popup === 'menu' ? 'menu' : 'dialog',
          popup === 'dialog' ? { name: '닉네임' } : {},
        ),
      ).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: '장소 상세' })).toBeVisible();
    await waitFor(() => expect(button).toHaveFocus());
  });
it('breakpoint 변경에 초안 focus와 selection을 유지하고 dock에서는 Tab이 나간다', async () => {
  const store = createStore();
  const { rerender } = render(
    <Provider store={store}>
      <FocusHarness />
    </Provider>,
  );
  await userEvent.click(screen.getByText('상세 열기'));
  const input = screen.getByLabelText('초안') as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 3);
  rerender(
    <Provider store={store}>
      <FocusHarness layout="wide" />
    </Provider>,
  );
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(3);
  rerender(
    <Provider store={store}>
      <FocusHarness layout="compact" />
    </Provider>,
  );
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(3);
  rerender(
    <Provider store={store}>
      <FocusHarness layout="wide" />
    </Provider>,
  );
  screen.getByText('상세 닫기').focus();
  await userEvent.tab();
  expect(input).not.toHaveFocus();
  rerender(
    <Provider store={store}>
      <FocusHarness layout="compact" />
    </Provider>,
  );
  expect(input.value).toBe('보존된 초안');
});

it('뷰별로 하나의 scroll host를 교체하고 위치를 복원한다', () => {
  const store = createStore();
  const wrap = (view: ViewMode) => (
    <Provider store={store}>
      <ResponsiveTripLayout
        {...shared}
        map={<div />}
        panel={
          view === 'day' ? (
            shared.panel
          ) : (
            <VirtualPlaceRows
              keys={['one']}
              variant="list"
              content={shared}
              ready
              renderPlace={(key) => <div>{key}</div>}
            />
          )
        }
        view={view}
        layout="wide"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>
  );
  const { rerender } = render(wrap('map'));
  const original = screen.getByTestId('view-scroll');
  original.scrollTop = 125;
  fireEvent.scroll(original);
  rerender(wrap('day'));
  const day = screen.getByTestId('view-scroll');
  expect(day).not.toBe(original);
  expect(day.scrollTop).toBe(0);
  day.scrollTop = 42;
  fireEvent.scroll(day);
  rerender(wrap('map'));
  expect(screen.getByTestId('view-scroll').scrollTop).toBe(125);
  rerender(wrap('day'));
  expect(screen.getByTestId('view-scroll').scrollTop).toBe(42);
});
it('VisualViewport 키보드 높이 변경을 구독하고 정리한다', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = new EventTarget() as EventTarget & { height: number };
  viewport.height = 568;
  const remove = vi.spyOn(viewport, 'removeEventListener');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const { unmount } = render(
    <Provider>
      <ResponsiveTripLayout
        {...shared}
        map={<div />}
        view="places"
        layout="compact"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>,
  );
  expect(screen.getByTestId('trip-shell')).toHaveStyle({ height: '568px' });
  act(() => {
    viewport.height = 320;
    viewport.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByTestId('trip-shell')).toHaveStyle({ height: '320px' });
  expect(screen.queryByRole('button', { name: '시트 크기 조절' })).toBeNull();
  unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor);
  else Reflect.deleteProperty(window, 'visualViewport');
});
it.each([
  [767, 'compact'],
  [768, 'split'],
  [1439, 'split'],
  [1440, 'wide'],
] as const)('%i px breakpoint는 %s layout이다', (width, expected) => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn((query) => ({
    matches: width >= Number(query.match(/\d+/)?.[0]),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  function Probe() {
    return <div data-testid="kind">{useLayoutKind()}</div>;
  }
  render(<Probe />);
  expect(screen.getByTestId('kind')).toHaveTextContent(expected);
  window.matchMedia = original;
});
it('배경 클릭은 상세 닫기를 호출한다', async () => {
  focusCase();
  await userEvent.click(screen.getByText('상세 열기'));
  await userEvent.click(document.querySelector('.MuiBackdrop-root')!);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '장소 상세' })).toBeNull());
});

it('시트 drag/cancel과 목록 보기 버튼을 처리한다', async () => {
  render(
    <Provider>
      <ResponsiveTripLayout
        {...shared}
        map={<div />}
        view="map"
        layout="compact"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>,
  );
  act(() => resources.setSize(screen.getByTestId('trip-body'), 320, 500));
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '164px' }));
  const handle = screen.getByRole('button', { name: '시트 크기 조절' });
  Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: vi.fn() });
  const pointer = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, { clientY: { value: y }, pointerId: { value: 1 } });
    fireEvent(handle, event);
  };
  pointer('pointerdown', 200);
  pointer('pointerup', 100);
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '288px' }));
  pointer('pointerdown', 100);
  pointer('pointercancel', 100);
  pointer('pointerup', 200);
  expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '288px' });
  pointer('pointerdown', 100);
  pointer('pointerup', 200);
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '164px' }));
  await userEvent.click(screen.getByRole('button', { name: '목록 보기' }));
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '440px' }));
  await userEvent.click(screen.getByRole('button', { name: '접기' }));
  await waitFor(() => expect(screen.getByTestId('view-panel')).toHaveStyle({ height: '164px' }));
});
it('compact 일정은 경로 지도 토글만으로 map host를 유지하며 표시한다', () => {
  const store = createStore();
  const wrap = (routeMapVisible: boolean) => (
    <Provider store={store}>
      <ResponsiveTripLayout
        {...shared}
        map={<div>경로 지도</div>}
        routeMapVisible={routeMapVisible}
        view="day"
        layout="compact"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>
  );
  const { rerender } = render(wrap(false));
  const host = screen.getByTestId('trip-map-area');
  expect(host).not.toBeVisible();
  expect(screen.queryByRole('button', { name: '시트 크기 조절' })).toBeNull();
  rerender(wrap(true));
  expect(screen.getByTestId('trip-map-area')).toBe(host);
  expect(host).toBeVisible();
});

it.each([false, true])(
  '새 일정 host는 초기 0을 쓰지 않고 최신 위치를 기록한다 (StrictMode=%s)',
  (strict) => {
    const store = createStore();
    const setter = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    const wrap = (view: ViewMode, layout: LayoutKind = 'compact') => {
      const content = (
        <Provider store={store}>
          <ResponsiveTripLayout
            {...shared}
            map={<div />}
            view={view}
            layout={layout}
            detail={{ open: false, content: null, onClose: vi.fn() }}
          />
        </Provider>
      );
      return strict ? <StrictMode>{content}</StrictMode> : content;
    };
    const host = render(wrap('day'));
    const day = screen.getByTestId('view-scroll');
    const dayWrites = () =>
      setter.mock.calls.filter((_, index) => setter.mock.contexts[index] === day);
    expect(day.scrollTop).toBe(0);
    expect(dayWrites()).toHaveLength(0);

    day.scrollTop = 70;
    fireEvent.scroll(day);
    expect(store.get(viewScrollAtom).day).toBe(70);
    setter.mockClear();
    host.rerender(wrap('day', 'wide'));
    expect(screen.getByTestId('view-scroll')).toBe(day);
    expect(day.scrollTop).toBe(70);
    expect(dayWrites()).toHaveLength(0);

    day.scrollTop = 95;
    host.rerender(wrap('places'));
    expect(store.get(viewScrollAtom).day).toBe(95);
    day.scrollTop = 130;
    fireEvent.scroll(day);
    expect(store.get(viewScrollAtom).day).toBe(95);
    host.rerender(wrap('day'));
    expect(screen.getByTestId('view-scroll')).not.toBe(day);
    expect(screen.getByTestId('view-scroll').scrollTop).toBe(95);
  },
);

it('새 일정 host는 Provider의 양수 캐시를 복원하고 다른 Provider와 분리한다', () => {
  const store = createStore();
  store.set(viewScrollAtom, { map: 180, day: 145, places: 500 });
  const wrap = (currentStore: ReturnType<typeof createStore>) => (
    <StrictMode>
      <Provider store={currentStore}>
        <ResponsiveTripLayout
          {...shared}
          map={<div />}
          view="day"
          layout="compact"
          detail={{ open: false, content: null, onClose: vi.fn() }}
        />
      </Provider>
    </StrictMode>
  );
  const first = render(wrap(store));
  expect(within(first.container).getByTestId('view-scroll').scrollTop).toBe(145);
  const otherStore = createStore();
  const other = render(wrap(otherStore));
  expect(within(other.container).getByTestId('view-scroll').scrollTop).toBe(0);
  other.unmount();
  expect(store.get(viewScrollAtom)).toEqual({ map: 180, day: 145, places: 500 });
});

it('공개 TripLayout은 responsive 셸을 직접 노출한다', () => {
  expect(TripLayout).toBe(ResponsiveTripLayout);
});

it('시트 단순 tap은 click 전까지 위치를 유지하고 drag 후 click을 무시한다', async () => {
  render(
    <Provider>
      <ResponsiveTripLayout
        {...shared}
        map={<div />}
        view="map"
        layout="compact"
        detail={{ open: false, content: null, onClose: vi.fn() }}
      />
    </Provider>,
  );
  resources.setSize(screen.getByTestId('trip-body'), 320, 432);
  const panel = screen.getByTestId('view-panel');
  await waitFor(() => expect(panel).toHaveStyle({ height: '164px' }));
  const handle = screen.getByRole('button', { name: '시트 크기 조절' });
  handle.setPointerCapture = vi.fn();
  const pointer = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, { clientY: { value: y }, pointerId: { value: 1 } });
    fireEvent(handle, event);
  };
  pointer('pointerdown', 200);
  pointer('pointerup', 200);
  expect(panel).toHaveStyle({ height: '164px' });
  fireEvent.click(handle);
  await waitFor(() => expect(panel).toHaveStyle({ height: `${sheetHeight('half', 432)}px` }));
  pointer('pointerdown', 200);
  pointer('pointerup', 100);
  expect(panel).toHaveStyle({ height: `${sheetHeight('full', 432)}px` });
  fireEvent.click(handle);
  expect(panel).toHaveStyle({ height: `${sheetHeight('full', 432)}px` });
  pointer('pointerdown', 100);
  pointer('pointerup', 200);
  expect(panel).toHaveStyle({ height: `${sheetHeight('half', 432)}px` });
  fireEvent.click(handle);
  expect(panel).toHaveStyle({ height: `${sheetHeight('half', 432)}px` });
});

it('작은 화면 half에 첫 목록 행을 담고 가용 높이 상한을 지킨다', () => {
  expect(sheetHeight('half', 432)).toBeGreaterThanOrEqual(288);
  expect(sheetHeight('half', 100)).toBe(52);
});

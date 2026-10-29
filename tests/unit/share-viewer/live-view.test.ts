import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLiveViewer, LIVE_TEXT } from 'src/share-viewer/live-view';
import { buildLiveDoc } from '../../fixtures/live-trip';
vi.mock('src/share-viewer/map-frame', () => ({
  connectMapFrame: () => ({ focus() {}, filter() {}, draw() {} }),
  shareMapUrl: () => '',
  toMapPlaces: () => [],
}));
vi.mock('src/share-viewer/encode', () => ({ importLink: async () => ({ kind: 'unsupported' }) }));
let root: HTMLElement;
let handle: { stop(): void } | undefined;
const live = { id: 'abcdefghij', token: 'v'.repeat(43) };
const response = (rev = 1) =>
  Response.json({ rev, updatedAt: '2026-11-01', expiresAt: '2026-12-01', doc: buildLiveDoc() });
beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  handle?.stop();
  handle = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('갱신 일정 보기', () => {
  it('제목·Day·띠를 그리고 갱신 때 고른 Day 2를 유지한다', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response(2));
    handle = await startLiveViewer(root, live, { fetch: f });
    expect(root.querySelector('h1')).toHaveTextContent('시험 여행');
    expect(root.querySelector('[role=status]')).toHaveTextContent('보낸 사람이');
    root.querySelectorAll<HTMLButtonElement>('[role=tab]')[1]!.click();
    await vi.advanceTimersByTimeAsync(10000);
    expect(root.querySelector('[aria-selected=true]')).toHaveTextContent('Day 2');
    expect(root.querySelector('[role=status]')).toHaveTextContent('일정이 바뀌었어요');
  });
  it('철회되면 일정과 저장 단추를 남기고 멈춘다', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(new Response(null, { status: 401 }));
    handle = await startLiveViewer(root, live, { fetch: f });
    await vi.advanceTimersByTimeAsync(10000);
    expect(root).toHaveTextContent(LIVE_TEXT.revoked);
    expect(root).toHaveTextContent(LIVE_TEXT.keepHint);
    expect(root.querySelector('h1')).toBeTruthy();
    expect(root).toHaveTextContent('파일로 저장');
    await vi.advanceTimersByTimeAsync(60000);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('처음부터 끝났으면 문구만 보인다', async () => {
    handle = await startLiveViewer(root, live, {
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 410 })),
    });
    expect(root).toHaveTextContent(LIVE_TEXT.ended);
    expect(root.querySelector('h1')).toBeNull();
  });
  it('처음 실패 뒤 다시 시도할 수 있다', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Error('끊김'))
      .mockResolvedValue(response());
    handle = await startLiveViewer(root, live, { fetch: f });
    expect(root).toHaveTextContent(LIVE_TEXT.firstFailed);
    root.querySelector<HTMLButtonElement>('button')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('h1')).toHaveTextContent('시험 여행');
  });
  it('현재 공개본을 HTML 틀에 넣은 Blob으로 저장한다', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(new Response('<script>__TRIPMAP_DATA__</script>'));
    let blob: Blob | undefined;
    vi.stubGlobal(
      'Blob',
      class {
        text: string;
        constructor(parts: string[]) {
          this.text = parts.join('');
        }
      },
    );
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn((value: Blob) => {
          blob = value;
          return 'blob:시험';
        }),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    handle = await startLiveViewer(root, live, { fetch: f });
    root.querySelector<HTMLButtonElement>('.live-bar button')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenLastCalledWith('/share-viewer.html');
    expect(String((blob as unknown as { text: string }).text)).toContain(
      JSON.stringify(buildLiveDoc().share),
    );
  });
});

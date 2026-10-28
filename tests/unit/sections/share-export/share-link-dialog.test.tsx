import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Result } from 'effect';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareDoc } from 'src/schema/share';
import { ShareFileDialog, type ShareFileOptions } from 'src/sections/share-export/ShareFileDialog';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { readShareHash } from 'src/domain/share/read-share';
import { renderLibrary, sampleLibrary } from '../library/fixtures';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', async (original) => ({
  ...(await original<typeof import('sonner')>()),
  toast: toastMock,
}));
vi.mock('src/theme/fonts', () => ({ loadDisplayFont: vi.fn(() => Promise.resolve()) }));

const doc: ShareDoc = {
  format: 'tripmap-share',
  version: 1,
  title: '시험',
  createdAt: '2026-10-22T00:00:00.000Z',
  labels: [],
  places: [
    {
      id: 'p1',
      name: '서울 ☕ <카페>',
      address: '서울',
      lng: 127,
      lat: 37,
      labelIds: [],
      memo: '메모',
    },
  ],
};
const makeDoc = (opts: ShareFileOptions): ShareDoc => ({
  ...doc,
  title: opts.title,
  places: doc.places.map(({ memo, ...p }) => (opts.includeMemo ? { ...p, memo } : p)),
});
const make = () => Result.succeed({ html: '', fileName: '시험.html', count: 1 });
const props = {
  open: true,
  onClose: vi.fn(),
  heading: '링크 시험',
  summary: '시험',
  defaultTitle: '시험',
  kakaoDescription: '장소 1곳 · 랜드마크',
  kakaoButtonTitle: '지도에서 보기',
  emptyMessage: null,
  make,
  linkDoc: makeDoc,
};

async function setup(linkDoc = makeDoc) {
  await renderLibrary(sampleLibrary(), { path: '/trips' });
  const view = render(<ShareFileDialog {...props} linkDoc={linkDoc} />, { wrapper: MemoryRouter });
  const d = within(screen.getByRole('dialog', { name: '링크 시험' }));
  return { ...view, d, copy: () => d.getByRole('button', { name: '링크 복사' }) };
}

afterEach(() => {
  setAppRuntimeForTest(null);
  toastMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const key of ['clipboard', 'share', 'canShare']) Reflect.deleteProperty(navigator, key);
  localStorage.clear();
});

describe('공유 창 링크 버튼', () => {
  it('공유 도움말로 이동할 때 원래 창을 닫는다', async () => {
    const { d } = await setup();
    const help = d.getByRole('link', { name: '도움말' });
    expect(help).toHaveAttribute('href', '/help/share');
    await userEvent.click(help);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    props.onClose.mockClear();
  });

  it('복사 성공을 알리고 제목·메모를 담은 앱 주소 링크를 복사한다', async () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.test/');
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { d, copy } = await setup();
    await waitFor(() => expect(copy()).toBeEnabled());
    await user.click(copy());
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0]![0] as string;
    expect(url).toMatch(/^https:\/\/app.test\/view#d=/);
    expect(await readShareHash(new URL(url).hash.slice(3))).toEqual({ ok: true, doc });
    expect(toastMock).toHaveBeenCalledWith('링크를 복사했어요');
    const title = d.getByRole('textbox', { name: '제목' });
    await user.clear(title);
    await user.type(title, '바뀐 제목');
    await user.click(d.getByRole('checkbox', { name: '메모 포함' }));
    await waitFor(() => expect(copy()).toBeEnabled());
    await user.click(copy());
    const changed = await readShareHash(
      new URL(writeText.mock.calls[1]![0] as string).hash.slice(3),
    );
    expect(changed.ok && changed.doc.title).toBe('바뀐 제목');
    expect(changed.ok && changed.doc.places[0]!.memo).toBeUndefined();
  });

  it('복사가 거부되면 창 안에 실패를 알린다', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('거부')) },
    });
    const { d, copy } = await setup();
    await waitFor(() => expect(copy()).toBeEnabled());
    await user.click(copy());
    expect(await d.findByRole('alert')).toHaveTextContent(
      '링크를 복사하지 못했어요. 다시 시도해 주세요',
    );
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('공유 API가 없으면 링크 공유를 숨기고 메모 체크에 따라 안내를 바꾼다', async () => {
    const user = userEvent.setup();
    const { d } = await setup();
    expect(d.queryByRole('button', { name: '링크 공유' })).toBeNull();
    expect(d.getByText('링크를 받은 사람은 누구나 메모를 볼 수 있어요')).toBeVisible();
    await user.click(d.getByRole('checkbox', { name: '메모 포함' }));
    expect(d.queryByText('링크를 받은 사람은 누구나 메모를 볼 수 있어요')).toBeNull();
  });

  it('링크 공유는 미리 만든 URL과 제목으로 호출한다(파일 공유 불가여도 표시)', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    const { d } = await setup();
    const button = d.getByRole('button', { name: '링크 공유' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(share).toHaveBeenCalledWith({ title: '시험', url: expect.stringContaining('/view#d=') });
  });

  it('압축 기능이 없으면 링크 버튼·메모 안내를 숨긴다', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const { d } = await setup();
    expect(d.queryByRole('button', { name: '링크 복사' })).toBeNull();
    expect(d.queryByRole('button', { name: '링크 공유' })).toBeNull();
    expect(d.queryByText('링크를 받은 사람은 누구나 메모를 볼 수 있어요')).toBeNull();
  });

  it('너무 크면 링크 버튼을 끄고 파일 전송을 안내한다', async () => {
    let seed = 7;
    const memo = Array.from({ length: 50_000 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed.toString(36);
    }).join('');
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() });
    const { d, copy } = await setup(() => ({ ...doc, places: [{ ...doc.places[0]!, memo }] }));
    await d.findByText('링크가 너무 길어요. 파일로 보내 주세요');
    expect(copy()).toBeDisabled();
    expect(d.getByRole('button', { name: '링크 공유' })).toBeDisabled();
    expect(d.getByRole('button', { name: '파일 저장' })).toBeEnabled();
  });

  it('복사가 늦게 끝나도 닫힌 창의 성공 토스트를 띄우지 않는다', async () => {
    let done!: () => void;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((r) => {
            done = r;
          }),
      },
    });
    const { copy, rerender } = await setup();
    await waitFor(() => expect(copy()).toBeEnabled());
    fireEvent.click(copy());
    rerender(<ShareFileDialog {...props} open={false} />);
    await act(async () => done());
    expect(toastMock).not.toHaveBeenCalled();
  });
});

it.each(['실패', '취소'])('링크 공유 %s를 구분해 안내한다', async (kind) => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: vi
      .fn()
      .mockRejectedValue(
        new DOMException(kind, kind === '취소' ? 'AbortError' : 'NotAllowedError'),
      ),
  });
  const { d } = await setup();
  const button = d.getByRole('button', { name: '링크 공유' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  if (kind === '취소') expect(d.queryByRole('alert')).toBeNull();
  else
    expect(await d.findByRole('alert')).toHaveTextContent(
      '링크를 공유하지 못했어요. 링크 복사를 이용해 주세요',
    );
  expect(button).toBeEnabled();
});

describe('카카오톡 공유', () => {
  function kakao() {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'e2e-kakao-key');
    let ready = false;
    const sdk = {
      init: vi.fn(() => {
        ready = true;
      }),
      isInitialized: () => ready,
      Share: { sendDefault: vi.fn() },
    };
    vi.stubGlobal('Kakao', sdk);
    return sdk;
  }
  it('키가 없으면 단추를 그리지 않는다', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', '');
    const { d } = await setup();
    expect(d.queryByRole('button', { name: '카카오톡' })).toBeNull();
  });
  it('미리 초기화한 SDK에 제목과 앱 이미지·보기 링크를 동기로 보낸다', async () => {
    const sdk = kakao();
    vi.stubEnv('VITE_APP_URL', 'https://app.test');
    const { d } = await setup();
    const button = d.getByRole('button', { name: '카카오톡' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith({
      objectType: 'feed',
      content: {
        title: '시험',
        description: '장소 1곳 · 랜드마크',
        imageUrl: 'https://app.test/icon-512.png',
        imageWidth: 512,
        imageHeight: 512,
        link: {
          webUrl: expect.stringContaining('https://app.test/view#d='),
          mobileWebUrl: expect.stringContaining('https://app.test/view#d='),
        },
      },
      buttonTitle: '지도에서 보기',
    });
    sdk.Share.sendDefault.mockImplementation(() => {
      throw new Error('SDK 오류');
    });
    fireEvent.click(button);
    expect(d.getByRole('alert')).toHaveTextContent(
      '카카오톡으로 보내지 못했어요. 링크 복사를 이용해 주세요',
    );
  });
  function longDoc() {
    let seed = 7;
    const memo = Array.from({ length: 1200 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed.toString(36);
    }).join('');
    return () => ({ ...doc, places: [{ ...doc.places[0]!, memo }] });
  }
  function shareServer(...responses: Array<Response | Error>) {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      const next = responses.shift() ?? new Error('응답 없음');
      if (next instanceof Error) throw next;
      return next;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  const createdResponse = () =>
    Response.json(
      { id: 'AAAAAAAAAAAAAAAA', expiresAt: '2026-11-27T00:00:00.000Z', created: true },
      { status: 201 },
    );

  it('한도(400자)를 넘는 링크는 누를 때 짧은 링크를 만들고 다음 클릭에서 보낸다', async () => {
    const sdk = kakao();
    vi.stubEnv('VITE_APP_URL', 'https://app.test');
    const fetchMock = shareServer(createdResponse());
    const { d, copy } = await setup(longDoc());
    expect(
      await d.findByText(
        /^카카오톡으로 보내면 짧은 링크를 위해 암호화한 사본을 Landmark 서버에 .+까지 보관해요\. 링크를 받은 사람은 누구나 볼 수 있어요$/,
      ),
    ).toBeVisible();
    const button = d.getByRole('button', { name: '카카오톡' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    const send = await d.findByRole('button', { name: '카카오톡으로 보내기' });
    expect(
      d.getByText(
        '짧은 링크를 만들었어요(11월 27일까지). 설정 › 보낸 짧은 링크에서 지울 수 있어요',
      ),
    ).toBeVisible();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/share');
    const sent = JSON.parse(init!.body as string) as Record<string, string>;
    expect(sent).toMatchObject({ kind: 'places', turnstile: 'dev' });
    expect(sent.body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(localStorage.getItem('tripmap:share-links:v1')!)).toEqual([
      expect.objectContaining({
        id: 'AAAAAAAAAAAAAAAA',
        deleteToken: sent.deleteToken,
        title: '시험',
        kind: 'places',
        expiresAt: '2026-11-27T00:00:00.000Z',
      }),
    ]);
    fireEvent.click(send);
    const feed = sdk.Share.sendDefault.mock.calls[0]![0] as {
      content: { link: { webUrl: string } };
    };
    // 앱 주소(`VITE_APP_URL`)가 아니라 사본을 올린 지금 출처로 만든다.
    expect(
      feed.content.link.webUrl.startsWith(`${window.location.origin}/s/AAAAAAAAAAAAAAAA#k=`),
    ).toBe(true);
    expect(feed.content.link.webUrl).toMatch(/#k=[A-Za-z0-9_-]{22}$/);
    expect(feed.content.link.webUrl.length).toBeLessThanOrEqual(400);
    expect(copy()).toBeEnabled();
  });

  it('만들기가 실패하면 안내하고, 다시 누르면 같은 본문·삭제 토큰으로 보낸다', async () => {
    kakao();
    const fetchMock = shareServer(new TypeError('끊김'), createdResponse());
    const { d } = await setup(longDoc());
    const button = d.getByRole('button', { name: '카카오톡' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await d.findByRole('alert')).toHaveTextContent(
      '인터넷 연결을 확인해 주세요. 링크 복사를 이용해 주세요',
    );
    fireEvent.click(d.getByRole('button', { name: '카카오톡' }));
    await d.findByRole('button', { name: '카카오톡으로 보내기' });
    expect(d.queryByRole('alert')).toBeNull();
    const bodies = fetchMock.mock.calls.map(([, init]) => init!.body);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('짧은 링크가 꺼져 있으면 지금처럼 카카오톡만 끄고 안내한다', async () => {
    const sdk = kakao();
    shareServer(
      Response.json(
        { reason: 'off', error: { code: 'UNAVAILABLE', message: '꺼짐' } },
        { status: 503 },
      ),
    );
    const { d, copy } = await setup(longDoc());
    const button = d.getByRole('button', { name: '카카오톡' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(
      await d.findByText('링크가 길어 카카오톡으로 보낼 수 없어요. 링크 복사를 이용해 주세요'),
    ).toBeVisible();
    expect(d.getByRole('button', { name: '카카오톡' })).toBeDisabled();
    expect(d.queryByRole('alert')).toBeNull();
    expect(copy()).toBeEnabled();
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
  });

  it('제목을 바꾸면 만든 짧은 링크를 쓰지 않고 새로 만든다', async () => {
    kakao();
    shareServer(createdResponse(), createdResponse());
    const { d } = await setup(longDoc());
    const button = d.getByRole('button', { name: '카카오톡' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await d.findByRole('button', { name: '카카오톡으로 보내기' });
    fireEvent.change(d.getByRole('textbox', { name: '제목' }), { target: { value: '새 제목' } });
    expect(await d.findByRole('button', { name: '카카오톡' })).toBeVisible();
  });
  it('SDK를 받기 전에는 이름을 유지하고 실패하면 안내한다', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'e2e-kakao-key');
    const { d, copy } = await setup();
    const button = d.getByRole('button', { name: '카카오톡' });
    expect(button).toBeDisabled();
    await waitFor(() => expect(document.querySelector('script[src*="kakaocdn"]')).not.toBeNull());
    fireEvent.error(document.querySelector('script[src*="kakaocdn"]')!);
    expect(await d.findByRole('status')).toHaveTextContent(
      '카카오톡을 불러오지 못했어요. 링크 복사를 이용해 주세요',
    );
    await waitFor(() => expect(copy()).toBeEnabled());
    expect(button).toBeDisabled();
  });
});

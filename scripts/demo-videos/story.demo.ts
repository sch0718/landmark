import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  addButton,
  mockRoutes,
  mockSearch,
  rowsOf,
  seedStorage,
  SEED_PLACE_COUNT,
  timeline,
} from '../../tests/e2e/fixtures';
import { createMeetServer, installMeetServer } from '../../tests/e2e/meet-server';
import { installShareServer } from '../../tests/e2e/share-server';
import { installFinger, longPress, pause, scroll, tap, type } from './human';
import { SCENES } from './story.mjs';

type VoiceLine = { text: string; file: string; dur: number };
type VoiceScene = { id: string; title: string; lines: VoiceLine[] };
type TimedLine = VoiceLine & { startMs: number; endMs: number };
type TimedScene = { id: string; title: string; startMs: number; endMs: number; lines: TimedLine[] };
type At = (index: number) => Promise<void>;
const OUT = path.resolve(process.env.DEMO_OUT || '.cache/demo-video');

async function narration(): Promise<VoiceScene[]> {
  const data = JSON.parse(await readFile(path.join(OUT, 'voice/durations.json'), 'utf8')) as {
    scenes: VoiceScene[];
  };
  // 대본을 고친 뒤 옛 음성으로 녹화하는 실수만 막는다.
  const same =
    data.scenes.length === SCENES.length &&
    data.scenes.every(
      (scene, i) =>
        scene.id === SCENES[i]!.id &&
        scene.lines.map((line) => line.text).join('\n') === SCENES[i]!.lines.join('\n'),
    );
  if (!same)
    throw new Error('voice/durations.json이 story.mjs와 다릅니다. voice.mjs를 먼저 돌리세요');
  return data.scenes;
}

function selectedScenes(): Set<string> {
  const ids = process.env.DEMO_SCENES?.split(',').map((id) => id.trim());
  if (!ids) return new Set(SCENES.map((scene) => scene.id));
  if (ids.some((id) => !SCENES.some((scene) => scene.id === id)))
    throw new Error('DEMO_SCENES must be a comma-separated subset of 1,2,3,4,5,6,7,8,9');
  const selected = new Set(ids);
  return selected;
}

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: '하단 메뉴' }).getByRole('link', { name, exact: true });
const detail = (page: Page) => page.getByRole('region', { name: '장소 상세' });
const place = (page: Page, name: string) =>
  page.getByRole('list', { name: '장소 목록' }).getByRole('button', { name: new RegExp(name) });

/** Scene actions deliberately use only the human gesture helpers. Setup is below. */
function actions(page: Page): Record<string, (at: At) => Promise<void>> {
  return {
    // Source: LibraryPage/BottomTabs; e2e: library.spec.ts mobile library landing.
    '1': async (at) => {
      await at(0);
      await expect(rowsOf(page)).toHaveCount(SEED_PLACE_COUNT);
      await at(1);
      await scroll(page, 180);
      await scroll(page, -180);
    },
    // Source: AddSheet, LinkInput, LabelPickerDialog; e2e: place-adding.spec.ts.
    '2': async (at) => {
      await at(0);
      await tap(page, page.getByRole('button', { name: '장소 추가', exact: true }).first());
      await tap(
        page,
        page
          .getByRole('dialog', { name: '장소 추가' })
          .getByRole('button', { name: /링크 붙여넣기/ }),
      );
      await type(page, page.getByRole('textbox', { name: '링크' }), 'https://naver.me/Fk73Vab5');
      await tap(page, page.getByRole('button', { name: '확인', exact: true }));
      await at(1);
      await expect(page.getByRole('heading', { name: '콤포트' })).toBeVisible();
      await tap(page, page.getByRole('button', { name: '라벨 바꾸기' }));
      const picker = page.getByRole('dialog', { name: '라벨 바꾸기' });
      await at(2);
      await tap(page, picker.getByRole('checkbox', { name: /^카페/ }));
      await expect(picker.getByRole('checkbox', { name: /^카페/ })).toBeChecked();
      await tap(page, picker.getByRole('button', { name: '완료' }));
      await tap(page, page.getByRole('button', { name: '추가', exact: true }));
      await expect(detail(page).getByRole('button', { name: '이름 수정' })).toContainText('콤포트');
      await at(3);
      await tap(page, detail(page).getByRole('button', { name: '닫기' }));
      await tap(page, nav(page, '보관함'));
      await expect(rowsOf(page)).toHaveCount(SEED_PLACE_COUNT + 1);
    },
    // Source: FilterBar, LabelChips, RegionChips; e2e: large-library/library specs.
    '3': async (at) => {
      await at(0);
      const cafe = page.getByRole('group', { name: '라벨' }).getByRole('button', { name: /^카페/ });
      await tap(page, cafe);
      await expect(cafe).toHaveAttribute('aria-pressed', 'true');
      await at(1);
      const regions = page.getByRole('group', { name: '지역' });
      await tap(page, regions.getByRole('button', { name: /^강원 \d/ }));
      await tap(page, regions.getByRole('button', { name: /^강릉/ }));
      await at(2);
      const search = page.getByRole('searchbox', { name: '장소 검색' });
      await type(page, search, '안목');
      await expect(place(page, '안목해변 커피거리')).toBeVisible();
      await at(3);
      await scroll(page, 160);
      await scroll(page, -160);
      await type(page, search, '');
      await tap(page, cafe);
      await tap(page, regions.getByRole('button', { name: /^강릉/ }));
      await expect(cafe).toHaveAttribute('aria-pressed', 'false');
      await expect(regions.getByRole('button', { pressed: true })).toHaveCount(0);
      await expect(search).toHaveValue('');
      await expect(rowsOf(page)).toHaveCount(SEED_PLACE_COUNT + 1);
    },
    // Source: PlaceDetail, MemoEditor, EditableText, VisitEditor; e2e: library/visited-review.
    '4': async (at) => {
      await at(0);
      await tap(page, place(page, '안목해변 커피거리'));
      await expect(detail(page).getByRole('button', { name: '이름 수정' })).toContainText(
        '안목해변 커피거리',
      );
      await at(1);
      await type(
        page,
        detail(page).getByRole('textbox', { name: '메모' }),
        '바다가 보이는 자리에 앉기',
      );
      await expect(detail(page).getByRole('status').filter({ hasText: '저장됨' })).toBeVisible();
      await at(2);
      await tap(page, detail(page).getByRole('button', { name: '다녀왔어요', exact: true }));
      await tap(page, detail(page).getByRole('button', { name: '한 줄 평 수정' }));
      await type(
        page,
        detail(page).getByRole('textbox', { name: '한 줄 평' }),
        '바다와 커피가 잘 어울리는 곳',
      );
      // Tapping the memo blurs and saves the one-line editor, as EditableText specifies.
      await tap(page, detail(page).getByRole('textbox', { name: '메모' }));
      await expect(detail(page).getByRole('button', { name: '한 줄 평 수정' })).toContainText(
        '바다와 커피',
      );
      await at(3);
      await tap(page, detail(page).getByRole('button', { name: '닫기' }));
    },
    // Source: LibraryMap/MapView, PlaceSheet; e2e: library/nearby specs.
    '5': async (at) => {
      await at(0);
      await tap(page, nav(page, '지도'));
      await at(1);
      // Search first so the real Naver adapter displays a single marker rather than a national cluster.
      await tap(page, nav(page, '보관함'));
      await type(page, page.getByRole('searchbox', { name: '장소 검색' }), '경포대');
      await tap(page, nav(page, '지도'));
      await tap(page, page.getByRole('button', { name: '경포대', exact: true }));
      await expect(detail(page).getByRole('button', { name: '이름 수정' })).toContainText('경포대');
      await tap(page, detail(page).getByRole('button', { name: '닫기' }));
      await at(2);
      await tap(page, page.getByRole('button', { name: '내 위치 보기' }));
      await expect(
        page.getByRole('status').filter({ hasText: '내 위치를 지도에 표시했어요' }),
      ).toHaveText('내 위치를 지도에 표시했어요');
      await at(3);
      await tap(page, nav(page, '보관함'));
      await type(page, page.getByRole('searchbox', { name: '장소 검색' }), '');
      await expect(rowsOf(page)).toHaveCount(SEED_PLACE_COUNT + 1);
    },
    // Source: TripsPage/TripFormDialog/LibraryPickerDialog/CandidatePanel; e2e: trip-planning/trip-today.
    '6': async (at) => {
      await at(0);
      await tap(page, nav(page, '여행'));
      await tap(page, page.getByRole('button', { name: '새 여행', exact: true }));
      const form = page.getByRole('dialog', { name: '새 여행' });
      await type(page, form.getByRole('textbox', { name: '여행 이름' }), '강릉 주말 여행');
      // 날짜는 기본값(오늘 시작)을 쓴다. 헤드리스 Chromium의 날짜 칸은 키 입력을 안정적으로 받지 않는다.
      await expect(form.getByLabel('시작일')).not.toHaveValue('');
      await pause(900);
      await tap(page, form.getByRole('button', { name: '만들기', exact: true }));
      await expect(page).toHaveURL(/\/trips\/[^/]+$/);
      await at(1);
      await tap(page, page.getByRole('button', { name: '보관함에서 더하기', exact: true }));
      const picker = page.getByRole('dialog', { name: '보관함에서 더하기' });
      for (const name of ['초당순두부 본점', '경포대']) {
        await tap(page, picker.getByRole('checkbox', { name: new RegExp(name) }));
      }
      await tap(page, picker.getByRole('button', { name: '2곳 넣기', exact: true }));
      await at(2);
      await tap(page, addButton(page, '초당순두부 본점'));
      await tap(page, addButton(page, '경포대'));
      await tap(page, timeline(page).getByRole('tab', { name: 'Day 1', exact: true }));
      await at(3);
      const leg = timeline(page).getByRole('listitem', {
        name: '초당순두부 본점 → 경포대',
        exact: true,
      });
      await expect(leg.getByText(/\d+(분|초) · [\d.]+k?m/)).toBeVisible();
      await at(4);
    },
    // Source: MeetingsPage/MeetingFormDialog/OriginPicker/MeetingResults; e2e: meetings/meetings-online.
    '7': async (at) => {
      await at(0);
      await tap(page, nav(page, '약속'));
      await tap(page, page.getByRole('button', { name: '새 약속', exact: true }));
      const form = page.getByRole('dialog', { name: '새 약속', exact: true });
      await type(page, form.getByRole('textbox', { name: '약속 이름' }), '강릉에서 만나요');
      await tap(page, form.getByRole('button', { name: '만들기', exact: true }));
      await at(1);
      await tap(page, page.getByRole('button', { name: '참석자 추가', exact: true }));
      const participant = page.getByRole('dialog', { name: '참석자 추가' });
      await type(page, participant.getByRole('textbox', { name: '참석자 이름' }), '여행 친구');
      await tap(page, participant.getByRole('button', { name: '추가', exact: true }));
      for (const [name, origin] of [
        ['나', '경포대'],
        ['여행 친구', '초당순두부 본점'],
      ] as const) {
        await tap(page, page.getByRole('button', { name: `${name} 출발지 고르기`, exact: true }));
        const picker = page.getByRole('dialog', { name: '출발지 고르기' });
        await tap(page, picker.getByRole('tab', { name: '보관함에서', exact: true }));
        await type(page, picker.getByRole('searchbox', { name: '보관함 장소 검색' }), origin);
        await tap(page, picker.getByRole('button', { name: new RegExp(`^${origin}`) }));
      }
      await at(2);
      await tap(page, page.getByRole('button', { name: '중간 지점 찾기', exact: true }));
      await expect(page.getByRole('region', { name: '번화가 역 순위' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: /^조회 중/ })).toHaveCount(0);
      // 순위 목록이 화면 아래에 걸려 있어 끌어 올려 보여 준다.
      await scroll(page, 360);
      await at(3);
    },
    // Source: PlaceRow/use-place-gestures/BulkBar/ExportDialog; e2e: library/share-link/share-export.
    '8': async (at) => {
      await at(0);
      await tap(page, nav(page, '보관함'));
      const first = rowsOf(page).nth(0).getByRole('button');
      const second = rowsOf(page).nth(1).getByRole('button');
      await longPress(page, first);
      await expect(first).toHaveAttribute('aria-pressed', 'true');
      await at(1);
      await tap(page, second);
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('2곳 선택', { exact: true })).toBeVisible();
      await tap(page, page.getByRole('button', { name: '내보내기', exact: true }).last());
      const dialog = page.getByRole('dialog', { name: '내보내기' });
      await expect(dialog).toContainText('2곳');
      await at(2);
      await tap(page, dialog.getByRole('button', { name: '링크 복사', exact: true }));
      await expect(page.getByText('링크를 복사했어요', { exact: true })).toBeVisible();
      await at(3);
      await tap(page, dialog.getByRole('button', { name: '닫기', exact: true }));
      await tap(page, page.getByRole('button', { name: '선택 해제', exact: true }));
    },
    // Source: ThemePicker/BackupSection; e2e: themes/backup-restore specs.
    '9': async (at) => {
      await at(0);
      await tap(page, nav(page, '설정'));
      await tap(
        page,
        page
          .getByRole('radiogroup', { name: '테마', exact: true })
          .getByRole('radio', { name: '수첩', exact: true }),
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
      await at(1);
      const downloaded = page.waitForEvent('download');
      await tap(page, page.getByRole('button', { name: '백업 파일 받기', exact: true }));
      const download = await downloaded;
      expect(await download.failure()).toBeNull();
      await download.saveAs(path.join(OUT, download.suggestedFilename()));
      await expect(page.getByText('백업 파일을 만들었어요', { exact: true })).toBeVisible();
      await at(2);
      await scroll(page, -650);
      await at(3);
    },
  };
}

test('강릉 여행을 준비하는 아홉 장면', async ({ context }) => {
  await mkdir(OUT, { recursive: true });
  await rm(path.join(OUT, 'timeline.json'), { force: true });
  const voices = await narration();
  const selected = selectedScenes();
  const last = Math.max(...[...selected].map(Number));
  // Do not request the page fixture: its early page/video would obscure the origin.
  const pageCreatedAt = performance.now();
  const page = await context.newPage();
  const video = page.video();
  if (!video) {
    await page.close();
    throw new Error('Demo recording requires Playwright video mode on');
  }
  const meetServer = createMeetServer();
  let closeShare: (() => void) | undefined;
  const scenes: TimedScene[] = [];
  let offsetMs = 0;
  let origin = 0;
  try {
    closeShare = await installShareServer(context);
    await installMeetServer(context, meetServer);
    await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write']);
    await context.setGeolocation({ latitude: 37.7551, longitude: 128.9003, accuracy: 30 });
    await seedStorage(page, { prefs: { theme: 'pastel', mode: 'light', libraryView: 'list' } });
    await installFinger(page);
    await mockRoutes(page);
    await mockSearch(page);
    // Minimal copy of the spec-local /api/place fixture mock; all exported mocks are imported.
    const placeReply = await readFile(
      path.resolve('tests/fixtures/links/api/place-naver.json'),
      'utf8',
    );
    await page.route('**/api/place?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: placeReply,
      }),
    );
    await page.goto('/');
    await expect(rowsOf(page)).toHaveCount(SEED_PLACE_COUNT);
    await expect(nav(page, '보관함')).toBeVisible();
    const libraryReadyAt = performance.now();
    const sceneActions = actions(page);
    for (const voice of voices) {
      if (Number(voice.id) > last) break;
      if (!selected.has(voice.id)) {
        // Reconstruct prerequisite UI through the same gestures without narration waits.
        await sceneActions[voice.id]!(async () => {});
        continue;
      }
      if (scenes.length === 0) {
        origin = selected.has('1') ? libraryReadyAt : performance.now();
        offsetMs = origin - pageCreatedAt;
      }
      // setTimeout이 1ms 미만 일찍 깨어날 수 있어 앞 장면 끝보다 앞서지 않게 한다.
      const startMs = Math.max(performance.now() - origin, scenes.at(-1)?.endMs ?? 0);
      let nextLineMs = startMs + 500;
      const lines = voice.lines.map((line): TimedLine => {
        const timed = { ...line, startMs: nextLineMs, endMs: nextLineMs + line.dur * 1000 };
        nextLineMs = timed.endMs + 350;
        return timed;
      });
      const at: At = async (index) => {
        const line = lines[index];
        if (!line) throw new Error(`Missing line cue ${index} in scene ${voice.id}`);
        // 동작이 늦어 문장 시각을 넘겼으면 이 문장부터 뒤를 미뤄 음성이 화면을 앞지르지 않게 한다.
        const late = performance.now() - origin - line.startMs;
        if (late > 0) {
          for (const later of lines.slice(index)) {
            later.startMs += late;
            later.endMs += late;
          }
        }
        await pause(origin + line.startMs - performance.now());
      };
      await sceneActions[voice.id]!(at);
      const endMs = Math.max(performance.now() - origin, lines.at(-1)!.endMs) + 800;
      await pause(origin + endMs - performance.now());
      scenes.push({ id: voice.id, title: voice.title, startMs, endMs, lines });
    }
  } finally {
    try {
      await page.close();
      await video.saveAs(path.join(OUT, 'recording.webm'));
    } finally {
      closeShare?.();
      meetServer.close();
    }
  }
  await writeFile(
    path.join(OUT, 'timeline.json'),
    JSON.stringify(
      {
        video: 'recording.webm',
        offsetMs,
        durationMs: scenes.at(-1)!.endMs,
        scenes,
      },
      null,
      2,
    ),
  );
});

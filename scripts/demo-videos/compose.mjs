/* global process, console, document */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';
import { SCENES } from './story.mjs';

const out = path.resolve(process.env.DEMO_OUT || '.cache/demo-video');
const voiceDir = path.join(out, 'voice');
const pngDir = path.join(out, 'overlays');
const timeline = JSON.parse(await readFile(path.join(out, 'timeline.json'), 'utf8'));
const seconds = (ms) => (ms / 1000).toFixed(3);
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
// 대본을 고친 뒤 옛 녹화를 합성하는 실수만 막는다.
const same =
  Array.isArray(timeline.scenes) &&
  timeline.scenes.every(
    (scene) =>
      scene.lines.map((line) => line.text).join('\n') ===
      SCENES.find((item) => item.id === scene.id)?.lines.join('\n'),
  );
if (!same) throw new Error('timeline.json이 story.mjs와 다릅니다. 먼저 데모를 다시 녹화하세요');
const video = path.resolve(out, timeline.video);
const lines = timeline.scenes.flatMap((scene) => scene.lines);
const duration = seconds(timeline.durationMs);
await mkdir(pngDir, { recursive: true });

// 무음 바탕을 두어 첫 문장 전과 동작이 더 긴 장면 뒤에도 정확한 전체 길이를 유지한다.
const audioArgs = [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  `anullsrc=r=48000:cl=mono:d=${duration}`,
];
for (const line of lines) audioArgs.push('-i', path.resolve(voiceDir, line.file));
const audioFilters = lines.map(
  (line, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(line.startMs)}:all=1[a${i}]`,
);
audioFilters.push(
  `[0:a]${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length + 1}:normalize=0:duration=longest,atrim=duration=${duration}[audio]`,
);
const audioFilter = path.join(out, 'audio.filter');
await writeFile(audioFilter, audioFilters.join(';\n'));
run('ffmpeg', [
  ...audioArgs,
  '-/filter_complex',
  audioFilter,
  '-map',
  '[audio]',
  '-ar',
  '48000',
  '-ac',
  '1',
  '-c:a',
  'pcm_s16le',
  path.join(out, 'audio.wav'),
]);

// 외부 폰트/CDN 없이 로컬 Pretendard를 임베드한다.
const fontFile = fileURLToPath(
  new URL(
    '../../node_modules/pretendard/dist/web/static/woff2/Pretendard-Regular.woff2',
    import.meta.url,
  ),
);
const font = (await readFile(fontFile)).toString('base64');
const browser = await chromium.launch({ headless: true });
const overlays = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1040, height: 680 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<style>
    @font-face{font-family:Demo;src:url(data:font/woff2;base64,${font})}
    *{box-sizing:border-box}html,body{margin:0;background:transparent;font-family:Demo,sans-serif}
    main{width:1040px;padding:32px 40px;color:#332d39;word-break:keep-all;overflow-wrap:anywhere}
    .eyebrow{font-size:25px;letter-spacing:2px;color:#776283;margin-bottom:26px}
    #text{font-size:49px;line-height:1.7;white-space:pre-wrap}
    main.title #text{font-size:56px;line-height:1.4;font-weight:bold}
  </style><main><div class="eyebrow"></div><div id="text"></div></main>`);
  await page.evaluate(() => document.fonts.ready);
  const render = async (text, eyebrow, kind, name) => {
    await page.evaluate(
      ({ text, eyebrow, kind }) => {
        document.querySelector('main').className = kind;
        document.querySelector('.eyebrow').textContent = eyebrow;
        document.querySelector('#text').textContent = text;
      },
      { text, eyebrow, kind },
    );
    const height = kind === 'title' ? 260 : 680;
    const overflow = await page.evaluate(() => document.querySelector('main').scrollHeight);
    if (overflow > height) throw new Error(`자막 영역을 넘었습니다: ${name}`);
    const file = path.join(pngDir, `${name}.png`);
    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: { x: 0, y: 0, width: 1040, height },
    });
    return file;
  };
  for (const scene of timeline.scenes) {
    overlays.push({
      file: await render(
        scene.title,
        'LANDMARK · 나만의 장소와 여행',
        'title',
        `title-${scene.id}`,
      ),
      startMs: scene.startMs,
      endMs: scene.endMs,
      y: 65,
    });
    for (const [i, line] of scene.lines.entries()) {
      overlays.push({
        file: await render(line.text, '', 'caption', `caption-${scene.id}-${i + 1}`),
        startMs: line.startMs,
        endMs: line.endMs,
        y: 350,
      });
    }
  }
} finally {
  await browser.close();
}

const videoArgs = [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  `color=c=0xf5efe7:s=1920x1080:r=30:d=${duration}`,
  '-ss',
  seconds(timeline.offsetMs),
  '-i',
  video,
];
for (const overlay of overlays) videoArgs.push('-i', overlay.file);
const videoFilters = [
  '[1:v]setpts=PTS-STARTPTS,scale=-2:980:flags=lanczos,setsar=1[phone]',
  '[0:v][phone]overlay=156:50:eof_action=repeat[v0]',
];
overlays.forEach((overlay, i) => {
  videoFilters.push(
    `[v${i}][${i + 2}:v]overlay=770:${overlay.y}:enable='gte(t,${seconds(overlay.startMs)})*lt(t,${seconds(overlay.endMs)})':eof_action=repeat[v${i + 1}]`,
  );
});
const videoFilter = path.join(out, 'video.filter');
await writeFile(videoFilter, videoFilters.join(';\n'));
run('ffmpeg', [
  ...videoArgs,
  '-filter_complex_threads',
  '1',
  '-/filter_complex',
  videoFilter,
  '-map',
  `[v${overlays.length}]`,
  '-an',
  '-t',
  duration,
  '-r',
  '30',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '19',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  path.join(out, 'seg.mp4'),
]);

const ttsPath = (
  process.env.NARRATED_VIDEO_TTS || '~/.claude/skills/narrated-video/scripts/tts.mjs'
).replace(/^~(?=\/)/, os.homedir());
const finish = path.join(path.dirname(path.resolve(ttsPath)), 'finish.sh');
// 기본 축소본도 반드시 생성한다. 외부 PHONE=0 설정을 이 데모에는 적용하지 않는다.
execFileSync(
  'sh',
  [finish, path.join(out, 'final.mp4'), path.join(out, 'audio.wav'), path.join(out, 'seg.mp4')],
  { stdio: 'inherit', env: { ...process.env, PHONE: '1' } },
);
const stamp = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const clean = (text) => text.replace(/[<>]/g, '');
await writeFile(
  path.join(out, 'title.txt'),
  clean('랜드마크로 준비하는 강릉 여행 | 장소 저장부터 일정과 공유까지') + '\n',
);
await writeFile(
  path.join(out, 'desc.txt'),
  clean(
    [
      '장소를 모으고 여행으로 연결하는 랜드마크 사용 이야기입니다.',
      '앱: https://landmark.sch0718.dev',
      '장소·경로·약속·공유 응답은 데모용 예시이며 내 위치는 강릉 고정 좌표입니다.',
      '음성: Edge TTS ko-KR-SunHiNeural',
      '',
      ...timeline.scenes.map((scene) => `${stamp(scene.startMs)} ${scene.title}`),
    ].join('\n'),
  ) + '\n',
);
console.log(`합성 결과: ${path.join(out, 'final.mp4')}`);

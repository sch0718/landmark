/* global process */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENES } from './story.mjs';

const out = path.resolve(process.env.DEMO_OUT || '.cache/demo-video');
const voiceDir = path.join(out, 'voice');
const ttsPath = (
  process.env.NARRATED_VIDEO_TTS || '~/.claude/skills/narrated-video/scripts/tts.mjs'
).replace(/^~(?=\/)/, os.homedir());
const { speak } = await import(pathToFileURL(path.resolve(ttsPath)).href);
const voice = { provider: 'edge', id: 'ko-KR-SunHiNeural', rate: '+5%' };

await mkdir(voiceDir, { recursive: true });
const scenes = [];
for (const scene of SCENES) {
  const lines = [];
  for (const text of scene.lines) {
    if (!/^[^.?!]+\.$/.test(text)) throw new Error(`한 문장씩 작성하세요: ${text}`);
    const { file, dur } = await speak(voice, text, voiceDir, 'narr');
    if (!Number.isFinite(dur) || dur <= 0) throw new Error(`음성 길이 오류: ${file}`);
    lines.push({ text, file: path.relative(voiceDir, path.resolve(file)), dur });
  }
  scenes.push({ id: scene.id, title: scene.title, lines });
}
// 도중에 TTS가 실패하면 이전에 완성된 시간표를 덮지 않는다.
const target = path.join(voiceDir, 'durations.json');
await writeFile(`${target}.tmp`, JSON.stringify({ scenes }, null, 2) + '\n');
await rename(`${target}.tmp`, target);

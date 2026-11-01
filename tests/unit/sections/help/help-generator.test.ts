import { readFileSync } from 'node:fs';
import { textWidth } from '@sch0718/motion-kit';
import { describe, expect, it } from 'vitest';
import { HELP_PAGES } from 'src/sections/help/help-content';
// @ts-expect-error 생성기는 별도 타입 선언이 없는 자바스크립트 모듈이에요.
import { PAGES } from '../../../../scripts/motion/help-pages.mjs';

type Page = {
  id: string;
  title: string;
  lead: readonly string[];
  steps: readonly { title: string; sub: string }[];
  tips: readonly string[];
};
const generated = PAGES as Page[];
const plain = (s: string) => s.replace(/`([^`]+)`/g, '‘$1’');

describe('도움말 생성기와 산출물 대조', () => {
  it('설정의 다섯 번째 단계와 로그인 문구가 그림 틀 안에 들어간다', () => {
    for (const mode of ['light', 'dark']) {
      const svg = new DOMParser().parseFromString(
        readFileSync(`public/help/img/settings-${mode}.svg`, 'utf8'),
        'image/svg+xml',
      );
      const highlight = svg.querySelector('rect.sc.s4')!;
      expect(
        Number(highlight.getAttribute('y')) + Number(highlight.getAttribute('height')),
      ).toBeLessThan(520);
      const scene = svg.querySelector('g[clip-path] > g.sc.s4')!;
      for (const provider of ['Google', '카카오', '네이버'])
        expect(scene.textContent).toContain(`${provider}로 로그인`);
      for (const text of scene.querySelectorAll('text')) {
        const size = Number(text.getAttribute('font-size'));
        const width = textWidth(text.textContent ?? '', size);
        const x = Number(text.getAttribute('x'));
        const anchor = text.getAttribute('text-anchor');
        const left = x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
        expect(left).toBeGreaterThanOrEqual(612);
        expect(left + width, text.textContent ?? '').toBeLessThanOrEqual(888);
        expect(Number(text.getAttribute('y'))).toBeLessThan(424);
      }
    }
  });
  it('모든 페이지의 문구와 순서가 앱 도움말과 같다', () => {
    expect(
      generated.map(({ id, title, lead, steps, tips }) => ({
        id,
        title,
        lead,
        steps: steps.map(({ title, sub }) => ({ title, sub })),
        tips,
      })),
    ).toEqual(HELP_PAGES);
  });

  it.each(HELP_PAGES)('$id 문서의 제목·설명·단계·팁이 앱 도움말과 같다', (page) => {
    const doc = readFileSync(`docs/help/${page.id}.md`, 'utf8');
    expect(doc.split('\n')[0]).toBe(`# ${page.title}`);
    expect(doc).toContain(`\n${page.lead.join(' ')}\n`);
    const steps = doc
      .split('## 이렇게 써요\n')[1]!
      .split('## 알아 두면 좋아요')[0]!
      .split('\n')
      .filter((s) => /^\d+\. /.test(s));
    const tips = doc
      .split('## 알아 두면 좋아요\n')[1]!
      .split('\n---')[0]!
      .split('\n')
      .filter((s) => s.startsWith('- '));
    expect(steps).toEqual(page.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.sub}`));
    expect(tips).toEqual(page.tips.map((tip) => `- ${tip}`));
  });

  it.each(HELP_PAGES)('$id 그림의 설명에 모든 단계가 들어 있다', (page) => {
    for (const mode of ['light', 'dark']) {
      const svg = readFileSync(`public/help/img/${page.id}-${mode}.svg`, 'utf8');
      const desc = new DOMParser()
        .parseFromString(svg, 'image/svg+xml')
        .querySelector('desc')!.textContent;
      for (const step of page.steps) expect(desc).toContain(plain(step.title));
    }
  });

  it('동기화 안내는 서버 백업 팁 앞에 둔다', () => {
    const page = generated.find((p) => p.id === 'settings')!;
    const tip =
      '동기화는 본인이 켠 기기끼리만 해요. 서버에는 암호화하지 않고 저장하며, 연결을 해제해도 기기 보관함은 남아요.';
    expect(page.tips).toContain(tip);
    expect(page.tips.indexOf(tip)).toBe(page.tips.findIndex((s) => s.includes('`서버 백업`')) - 1);
  });
});

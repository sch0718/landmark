import { describe, expect, it } from 'vitest';
import { fitMeetingText } from 'src/domain/meeting/limits';

describe('fitMeetingText', () => {
  it.each([60, 120])('%i 한도에는 말줄임표의 UTF-16 길이도 포함한다', (max) => {
    const fitted = fitMeetingText('가'.repeat(max + 1), max);
    expect(fitted).toBe('가'.repeat(max - 1) + '…');
    expect(fitted.length).toBe(max);
  });

  it.each(['😀', '👨‍👩‍👧‍👦', '👍🏽', '🇰🇷', 'e\u0301', '가'])(
    '%s 그래핌은 들어갈 때는 통째로 남기고 넘치면 통째로 뺀다',
    (grapheme) => {
      for (const max of [60, 120]) {
        const fits = '가'.repeat(max - 1 - grapheme.length);
        expect(fitMeetingText(fits + grapheme + '가나다', max)).toBe(fits + grapheme + '…');
        const overflows = '가'.repeat(max - 2);
        expect(fitMeetingText(overflows + grapheme + '가나다', max)).toBe(overflows + '…');
      }
    },
  );

  it.each(['', '   ', '  집  ', '가'.repeat(60), '가'.repeat(58) + '😀'])(
    'trim한 값 %j이 한도 안이면 말줄임표를 붙이지 않는다',
    (text) => expect(fitMeetingText(text, 60)).toBe(text.trim()),
  );

  it('그래핌 하나도 들어가지 않는 작은 한도에서도 상한을 지킨다', () => {
    expect(fitMeetingText('😀가', 1)).toBe('…');
    expect(fitMeetingText('😀가', 0)).toBe('');
  });
});

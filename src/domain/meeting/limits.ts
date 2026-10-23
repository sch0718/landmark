const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

/** 그래핌을 보존하며 말줄임표까지 스키마의 UTF-16 길이 한도 안에 넣는다. */
export function fitMeetingText(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) return value;
  if (max < 1) return '';
  let fitted = '';
  for (const { segment } of segmenter.segment(value)) {
    if (fitted.length + segment.length + 1 > max) break;
    fitted += segment;
  }
  return fitted + '…';
}

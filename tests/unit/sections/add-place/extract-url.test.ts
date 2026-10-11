import { describe, expect, it } from 'vitest';
import { extractUrl } from 'src/sections/add-place/extract-url';

describe('extractUrl', () => {
  it('네이버 앱 공유 문구에서 링크만 뽑는다', () => {
    expect(extractUrl('[네이버 지도]\n콤포트\nhttps://naver.me/Fk73Vab5')).toBe(
      'https://naver.me/Fk73Vab5',
    );
  });

  it('링크 끝에 붙은 괄호·마침표를 뗀다', () => {
    expect(extractUrl('(https://kko.to/MWuG8x8eN4).')).toBe('https://kko.to/MWuG8x8eN4');
    expect(extractUrl('여기요: https://maps.app.goo.gl/SsZWtW1xgZVgijxK6, 가 보세요!')).toBe(
      'https://maps.app.goo.gl/SsZWtW1xgZVgijxK6',
    );
  });

  it('링크 안의 짝이 맞는 괄호는 남긴다', () => {
    expect(extractUrl('https://example.com/a_(b)')).toBe('https://example.com/a_(b)');
  });

  it('여러 개면 첫 링크, http도 받는다', () => {
    expect(extractUrl('http://naver.me/a https://naver.me/b')).toBe('http://naver.me/a');
  });

  it('링크가 없으면 null', () => {
    expect(extractUrl('')).toBeNull();
    expect(extractUrl('   ')).toBeNull();
    expect(extractUrl('콤포트 naver.me/Fk73Vab5')).toBeNull();
    expect(extractUrl('ftp://naver.me/x')).toBeNull();
    expect(extractUrl('https://')).toBeNull();
  });
});

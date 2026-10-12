import { describe, expect, it } from 'vitest';
import { decodePlusCode } from 'src/server/plus-code';

describe('decodePlusCode', () => {
  it('11자리 전역 코드의 셀 중심을 돌려준다(부산 이재모피자 본점)', () => {
    const point = decodePlusCode('8Q7F422J+R6X');
    expect(point).not.toBeNull();
    expect(point!.lat).toBeCloseTo(35.1021125, 9);
    expect(point!.lng).toBeCloseTo(129.030609375, 9);
  });

  it('10자리 전역 코드의 셀 중심을 돌려준다', () => {
    const point = decodePlusCode('8FVC9G8F+6X');
    expect(point).not.toBeNull();
    expect(point!.lat).toBeCloseTo(47.3655625, 9);
    expect(point!.lng).toBeCloseTo(8.5249375, 9);
  });

  it('8자리 코드는 0.0025도 셀의 중심을 돌려준다', () => {
    const point = decodePlusCode('8FVC9G8F+');
    expect(point).not.toBeNull();
    expect(point!.lat).toBeCloseTo(47.36625, 9);
    expect(point!.lng).toBeCloseTo(8.52375, 9);
  });

  it('소문자도 받는다', () => {
    expect(decodePlusCode('8fvc9g8f+6x')).toEqual(decodePlusCode('8FVC9G8F+6X'));
  });

  it('짧은 코드는 null', () => {
    expect(decodePlusCode('9G8F+6X')).toBeNull();
  });

  it('잘못된 문자·모양은 null', () => {
    expect(decodePlusCode('8FVC9G8A+6X')).toBeNull(); // A는 알파벳에 없다
    expect(decodePlusCode('8FVC9G8F6X')).toBeNull(); // '+' 없음
    expect(decodePlusCode('8FVC9G8F+6')).toBeNull(); // '+' 뒤 한 자리
    expect(decodePlusCode('8FVC9G+8F6X')).toBeNull(); // '+' 위치
    expect(decodePlusCode('8FVC9G8F+6X+')).toBeNull();
    expect(decodePlusCode('')).toBeNull();
  });

  it('범위를 벗어나는 첫 글자는 null', () => {
    expect(decodePlusCode('X2222222+22')).toBeNull(); // 위도 범위 밖
  });
});

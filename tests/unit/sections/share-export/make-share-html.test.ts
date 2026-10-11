import { describe, expect, it } from 'vitest';
import { Result } from 'effect';
import { SHARE_DATA_PLACEHOLDER } from 'src/domain/share/inject';
import { renderShareHtml } from 'src/sections/share-export/make-share-html';
import { ShareDocInvalid } from 'src/services/errors';
import { sampleLibrary } from '../library/fixtures';

const TEMPLATE = `<html><script type="application/json" id="tripmap-share">${SHARE_DATA_PLACEHOLDER}</script></html>`;
const id = (n: number) => `place${String(n).padStart(5, '0')}`;
const opts = { title: '정자역 카페', includeMemo: true, now: new Date(2026, 9, 11, 12) };

// 틀을 받지 못하는 경우는 tests/unit/services/share-template.test.ts가 다룬다.
describe('renderShareHtml', () => {
  it('injects the data block and names the file, synchronously from a template string', () => {
    const result = Result.getOrThrow(
      renderShareHtml(TEMPLATE, sampleLibrary(), [id(1), id(2)], opts),
    );
    expect(result.fileName).toBe('정자역-카페-20261011.html');
    expect(result.count).toBe(2);
    expect(result.html).not.toContain(SHARE_DATA_PLACEHOLDER);
    const m = /<script type="application\/json" id="tripmap-share">(.*)<\/script>/s.exec(
      result.html,
    );
    const doc = JSON.parse(m![1]!) as { format: string; title: string; places: unknown[] };
    expect(doc.format).toBe('tripmap-share');
    expect(doc.title).toBe('정자역 카페');
    expect(doc.places).toHaveLength(2);
  });

  it('succeeds with zero places (count 0)', () => {
    const result = Result.getOrThrow(renderShareHtml(TEMPLATE, sampleLibrary(), [], opts));
    expect(result.count).toBe(0);
    expect(result.html).toContain('"places":[]');
  });

  it('drops unknown ids from the count', () => {
    const result = Result.getOrThrow(
      renderShareHtml(TEMPLATE, sampleLibrary(), [id(1), 'zzzzzzzzzz'], opts),
    );
    expect(result.count).toBe(1);
  });

  it('returns ShareDocInvalid as a failure when the doc breaks the schema', () => {
    // createdAt 형식이 맞지 않는 now는 만들 수 없으므로, 잘못된 좌표를 가진 장소로 검증 실패를 만든다.
    const lib = sampleLibrary();
    const broken = {
      ...lib,
      places: { ...lib.places, [id(1)]: { ...lib.places[id(1)]!, lng: 999 } },
    };
    const result = renderShareHtml(TEMPLATE, broken, [id(1)], opts);
    if (!Result.isFailure(result)) throw new Error('검증 실패를 기대했어요');
    const err = result.failure;
    expect(err).toBeInstanceOf(ShareDocInvalid);
    expect(err.message).not.toBe('');
    expect(err.userMessage).toBe(
      '내보내기 파일을 만들지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요',
    );
  });
});

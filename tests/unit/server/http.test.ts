// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  STATUS,
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  type ApiErrorCode,
} from 'src/server/http';

describe('isAllowedOrigin', () => {
  it.each([
    'https://landmark-c5f.pages.dev',
    'https://feat-place-adding.landmark-c5f.pages.dev',
    'https://1a2b3c4d.landmark-c5f.pages.dev',
    'http://localhost:5173',
    'http://localhost:8788',
  ])('%s 허용', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each([
    ['서브도메인 두 단계', 'https://a.b.landmark-c5f.pages.dev'],
    ['접미사 위장', 'https://landmark-c5f.pages.dev.evil.com'],
    ['앞에 붙인 이름', 'https://evillandmark-c5f.pages.dev'],
    ['http 배포 주소', 'http://landmark-c5f.pages.dev'],
    ['http 미리보기 주소', 'http://x.landmark-c5f.pages.dev'],
    ['포트 붙은 배포 주소', 'https://landmark-c5f.pages.dev:8443'],
    ['다른 localhost 포트', 'http://localhost:3000'],
    ['https localhost', 'https://localhost:5173'],
    ['경로가 붙은 값', 'https://landmark-c5f.pages.dev/'],
    ['사용자 정보', 'https://landmark-c5f.pages.dev@evil.com'],
    ['문자열 null', 'null'],
    ['빈 값', ''],
  ])('%s 거부 (%s)', (_label, origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });

  it('null 거부', () => {
    expect(isAllowedOrigin(null)).toBe(false);
  });
});

describe('STATUS', () => {
  it('오류 코드별 HTTP 상태', () => {
    expect(STATUS).toEqual({
      UNSUPPORTED_LINK: 400,
      NOT_FOUND: 404,
      FORBIDDEN_ORIGIN: 403,
      TOO_MANY_PLACES: 413,
      UPSTREAM_ERROR: 502,
      TIMEOUT: 504,
      BAD_REQUEST: 400,
      NO_ROUTE: 404,
    });
  });
});

describe('jsonResponse', () => {
  it('JSON 본문과 Content-Type', async () => {
    const res = jsonResponse({ a: 1 }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('기본 상태는 200', () => {
    expect(jsonResponse([]).status).toBe(200);
  });
});

describe('errorResponse', () => {
  it.each(Object.entries(STATUS) as [ApiErrorCode, number][])(
    '%s → %d, 본문 { error: { code, message } }',
    async (code, status) => {
      const res = errorResponse(new ApiError(code, '메시지'));
      expect(res.status).toBe(status);
      expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(await res.json()).toEqual({ error: { code, message: '메시지' } });
    },
  );

  it.each(['NOT_FOUND', 'UPSTREAM_ERROR', 'TIMEOUT'] as const)(
    '%s 오류 응답은 Cache-Control: private, no-store',
    (code) => {
      expect(errorResponse(new ApiError(code, '메시지')).headers.get('Cache-Control')).toBe(
        'private, no-store',
      );
    },
  );

  it('ApiError가 아닌 오류 응답도 Cache-Control: private, no-store', () => {
    expect(errorResponse(new Error('x')).headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('no-location이면 reason·placeName을 담는다', async () => {
    const res = errorResponse(
      new ApiError('NOT_FOUND', '위치 없음', {
        reason: 'no-location',
        placeName: '이재모피자 본점',
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: '위치 없음',
        reason: 'no-location',
        placeName: '이재모피자 본점',
      },
    });
  });

  it('ApiError가 아니면 UPSTREAM_ERROR(502)이고 원래 메시지를 내보내지 않는다', async () => {
    const res = errorResponse(new Error('https://secret.example/?q=1 실패'));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UPSTREAM_ERROR');
    expect(body.error.message).not.toContain('secret');
  });

  it('Error가 아닌 값도 UPSTREAM_ERROR', async () => {
    const res = errorResponse('boom');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM_ERROR');
  });
});

describe('ApiError', () => {
  it('Error이고 code·detail을 가진다', () => {
    const e = new ApiError('TIMEOUT', '시간 초과');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('TIMEOUT');
    expect(e.message).toBe('시간 초과');
    expect(e.detail).toBeUndefined();
  });
});

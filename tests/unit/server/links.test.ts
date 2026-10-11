import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS, classifyLink, isAllowedUrl } from 'src/server/links';

const GOOGLE_PLACE =
  'https://www.google.com/maps/place/%EC%9D%B4%EC%9E%AC%EB%AA%A8%ED%94%BC%EC%9E%90+%EB%B3%B8%EC%A0%90/data=!4m2!3m1!1s0x1520f8eed52456f1:0x129df2a4704f8520!4m7!3m6!1s0x1520f8eed52456f1:0x129df2a4704f8520!8m2!20s8Q7F422J+R6X?entry=tts';

describe('classifyLink', () => {
  describe('이동 링크', () => {
    it.each([
      'https://naver.me/Fk73Vab5',
      'https://kko.to/MWuG8x8eN4',
      'https://maps.app.goo.gl/SsZWtW1xgZVgijxK6',
      'https://goo.gl/maps/abc123',
    ])('%s → redirect', (url) => {
      expect(classifyLink(url)).toEqual({ kind: 'redirect', url });
    });

    it('쿼리·해시는 바깥에 보내지 않도록 뗀다', () => {
      expect(classifyLink('https://naver.me/Fk73Vab5?utm=1#frag')).toEqual({
        kind: 'redirect',
        url: 'https://naver.me/Fk73Vab5',
      });
      expect(classifyLink('https://maps.app.goo.gl/Ss?g_st=ic#x')).toEqual({
        kind: 'redirect',
        url: 'https://maps.app.goo.gl/Ss',
      });
      expect(classifyLink('https://goo.gl/maps/abc123?x=1')).toEqual({
        kind: 'redirect',
        url: 'https://goo.gl/maps/abc123',
      });
    });

    it('goo.gl은 /maps/ 경로만 이동 링크다', () => {
      expect(classifyLink('https://goo.gl/other')).toEqual({ kind: 'unsupported' });
    });
  });

  describe('네이버 장소', () => {
    it('naver.me가 풀린 주소에서 ID를 얻는다', () => {
      expect(
        classifyLink('https://map.naver.com/p/entry/place/1958911015?placePath=%2Fhome'),
      ).toEqual({ kind: 'naver-place', sid: '1958911015' });
    });

    it('사용자가 붙여 넣는 웹 주소에서 ID를 얻는다', () => {
      expect(
        classifyLink(
          'https://map.naver.com/p/entry/place/1540168051?c=12.33,0,0,0,dh&placePath=/home?bookmarkId%3D123',
        ),
      ).toEqual({ kind: 'naver-place', sid: '1540168051' });
    });

    it('검색 결과 주소에서 ID를 얻는다', () => {
      expect(classifyLink('https://map.naver.com/p/search/콤포트/place/1540168051')).toEqual({
        kind: 'naver-place',
        sid: '1540168051',
      });
    });

    it.each([
      'https://m.place.naver.com/restaurant/12028621/home',
      'https://pcmap.place.naver.com/restaurant/12028621/home',
    ])('%s → 12028621', (url) => {
      expect(classifyLink(url)).toEqual({ kind: 'naver-place', sid: '12028621' });
    });

    it('ID가 숫자가 아니면 unsupported', () => {
      expect(classifyLink('https://map.naver.com/p/entry/place/abc')).toEqual({
        kind: 'unsupported',
      });
    });
  });

  describe('네이버 폴더', () => {
    it('공유 ID를 얻는다', () => {
      expect(
        classifyLink(
          'https://map.naver.com/p/favorite/sharedPlace/folder/fb65e7f93f8a4144a4ded594d604a7aa',
        ),
      ).toEqual({ kind: 'naver-folder', shareId: 'fb65e7f93f8a4144a4ded594d604a7aa' });
    });

    it('뒤에 쿼리가 붙어도 된다', () => {
      expect(
        classifyLink(
          'https://map.naver.com/p/favorite/sharedPlace/folder/fb65e7f93f8a4144a4ded594d604a7aa?c=15.00,0,0,0,dh',
        ),
      ).toEqual({ kind: 'naver-folder', shareId: 'fb65e7f93f8a4144a4ded594d604a7aa' });
    });
  });

  describe('카카오', () => {
    it.each([
      'https://applink.map.kakao.com/place?id=16990385',
      'https://place.map.kakao.com/16990385',
      'https://map.kakao.com/?itemId=16990385',
    ])('%s → 16990385', (url) => {
      expect(classifyLink(url)).toEqual({ kind: 'kakao-place', kakaoId: '16990385' });
    });

    it('ID가 숫자가 아니면 unsupported', () => {
      expect(classifyLink('https://place.map.kakao.com/abc')).toEqual({ kind: 'unsupported' });
      expect(classifyLink('https://applink.map.kakao.com/place?id=')).toEqual({
        kind: 'unsupported',
      });
    });
  });

  describe('구글', () => {
    it('이름의 퍼센트 인코딩과 +를 풀고, 장소 ID와 Plus Code를 뽑는다(좌표는 없음)', () => {
      expect(classifyLink(GOOGLE_PLACE)).toEqual({
        kind: 'google-place',
        name: '이재모피자 본점',
        googleId: '0x1520f8eed52456f1:0x129df2a4704f8520',
        lat: null,
        lng: null,
        plusCode: '8Q7F422J+R6X',
      });
    });

    it('대문자 장소 ID는 소문자로 바꾼다(스키마가 소문자만 받는다)', () => {
      const link = classifyLink(
        'https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0xABC123:0xDEF456!3d35.1!4d129.0',
      );
      expect(link).toMatchObject({ kind: 'google-place', googleId: '0xabc123:0xdef456' });
    });

    it('!3d!4d 좌표를 그대로 쓴다', () => {
      expect(
        classifyLink(
          'https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0xabc:0xdef!3d35.1!4d129.0',
        ),
      ).toEqual({
        kind: 'google-place',
        name: 'Cafe',
        googleId: '0xabc:0xdef',
        lat: 35.1,
        lng: 129.0,
        plusCode: null,
      });
    });

    it('@위도,경도만 있어도 좌표를 얻고, 장소 ID는 null이다', () => {
      expect(classifyLink('https://www.google.com/maps/place/Cafe/@35.1021,129.0306,17z')).toEqual({
        kind: 'google-place',
        name: 'Cafe',
        googleId: null,
        lat: 35.1021,
        lng: 129.0306,
        plusCode: null,
      });
    });

    it('!3d!4d가 @보다 우선한다', () => {
      const link = classifyLink(
        'https://www.google.com/maps/place/Cafe/@10.5,20.5,17z/data=!3d35.1!4d129.0',
      );
      expect(link).toMatchObject({ kind: 'google-place', lat: 35.1, lng: 129.0 });
    });

    it('음수 좌표도 읽는다', () => {
      expect(
        classifyLink('https://www.google.com/maps/place/Sydney/@-33.8688,151.2093,12z'),
      ).toMatchObject({ lat: -33.8688, lng: 151.2093 });
    });

    it('범위를 벗어난 좌표는 버린다', () => {
      expect(
        classifyLink('https://www.google.com/maps/place/Nowhere/@91.5,200.5,12z'),
      ).toMatchObject({ lat: null, lng: null });
    });

    it('퍼센트 인코딩된 Plus Code를 푼다', () => {
      expect(
        classifyLink('https://www.google.com/maps/place/A/data=!20s8Q7F422J%2BR6X'),
      ).toMatchObject({ plusCode: '8Q7F422J+R6X' });
    });

    it('maps.google.com 주소도 받는다', () => {
      expect(classifyLink('https://maps.google.com/maps/place/Cafe/@35.1,129.0,17z')).toMatchObject(
        {
          kind: 'google-place',
          name: 'Cafe',
        },
      );
    });

    it('/maps/place/가 아닌 www.google.com 주소는 unsupported', () => {
      expect(classifyLink('https://www.google.com/search?q=cafe')).toEqual({ kind: 'unsupported' });
    });

    it('깨진 퍼센트 인코딩이어도 던지지 않는다', () => {
      expect(classifyLink('https://www.google.com/maps/place/%E0%A4%A/@1,2,3z')).toMatchObject({
        kind: 'google-place',
      });
    });
  });

  describe('지원하지 않는 링크', () => {
    it.each([
      'https://evil.example.com/map.naver.com/p/entry/place/1',
      'https://map.naver.com.evil.com/p/entry/place/1958911015',
      'https://evil.com/?u=https://map.naver.com/p/entry/place/1',
      'https://user@evil.com/@map.naver.com/p/entry/place/1',
      'javascript:alert(1)',
      'ftp://naver.me/x',
      'not a url',
      '',
      '   ',
    ])('%j → unsupported', (raw) => {
      expect(classifyLink(raw)).toEqual({ kind: 'unsupported' });
    });

    it('http도 받는다', () => {
      expect(classifyLink('http://naver.me/Fk73Vab5')).toEqual({
        kind: 'redirect',
        url: 'http://naver.me/Fk73Vab5',
      });
    });

    it.each([
      'https://map.naver.com:8443/p/entry/place/1',
      'https://naver.me:444/x',
      'https://user:pw@naver.me/x',
      'https://user@naver.me/x',
      'https://map.naver.com@evil.com/p/entry/place/1',
    ])('포트·사용자 정보가 붙으면 %s → unsupported', (raw) => {
      expect(classifyLink(raw)).toEqual({ kind: 'unsupported' });
    });

    it('기본 포트는 URL이 지우므로 허용된다', () => {
      expect(classifyLink('http://naver.me:80/x')).toEqual({
        kind: 'redirect',
        url: 'http://naver.me/x',
      });
      expect(classifyLink('https://naver.me:443/x')).toEqual({
        kind: 'redirect',
        url: 'https://naver.me/x',
      });
    });

    it('대문자 스킴·호스트는 소문자로 바뀌어 허용된다', () => {
      expect(classifyLink('HTTPS://NAVER.ME/x')).toEqual({
        kind: 'redirect',
        url: 'https://naver.me/x',
      });
    });

    it.each([
      'https://maps.google.com/',
      'https://maps.google.com/maps',
      'https://www.google.com/maps/place/',
    ])('이름도 위치 단서도 없는 구글 주소 %s → unsupported', (raw) => {
      expect(classifyLink(raw)).toEqual({ kind: 'unsupported' });
    });

    it('앞뒤 공백은 무시한다', () => {
      expect(classifyLink('  https://naver.me/Fk73Vab5\n')).toEqual({
        kind: 'redirect',
        url: 'https://naver.me/Fk73Vab5',
      });
    });

    it('허용 호스트라도 처리 규칙이 없는 경로는 unsupported', () => {
      expect(classifyLink('https://map.naver.com/p/')).toEqual({ kind: 'unsupported' });
      expect(classifyLink('https://pages.map.naver.com/x')).toEqual({ kind: 'unsupported' });
    });
  });
});

describe('isAllowedUrl', () => {
  it.each([
    'https://naver.me/x',
    'http://map.naver.com/p/entry/place/1',
    'https://place-api.map.kakao.com/places/panel3/1',
    'https://pages.map.naver.com/save-pages/api/x',
    'HTTPS://NAVER.ME/x',
    'http://naver.me:80/x',
  ])('%s → 허용', (raw) => {
    expect(isAllowedUrl(new URL(raw))).toBe(true);
  });

  it.each([
    'ftp://naver.me/x',
    'javascript:alert(1)',
    'https://naver.me:8443/x',
    'https://user:pw@naver.me/x',
    'https://user@naver.me/x',
    'https://map.naver.com.evil.com/x',
    'https://evil.com/map.naver.com',
    'https://map.naver.com@evil.com/',
    'https://sub.naver.me/x',
  ])('%s → 거부', (raw) => {
    expect(isAllowedUrl(new URL(raw))).toBe(false);
  });
});

describe('ALLOWED_HOSTS', () => {
  it('스펙 §4.2 링크 호스트와 조회 API 호스트를 모두 담는다', () => {
    for (const host of [
      'naver.me',
      'map.naver.com',
      'm.place.naver.com',
      'pcmap.place.naver.com',
      'pages.map.naver.com',
      'kko.to',
      'place.map.kakao.com',
      'applink.map.kakao.com',
      'map.kakao.com',
      'place-api.map.kakao.com',
      'maps.app.goo.gl',
      'goo.gl',
      'www.google.com',
      'maps.google.com',
    ]) {
      expect(ALLOWED_HOSTS).toContain(host);
    }
  });

  it('접미사 일치가 가능한 점(.)으로 시작하는 항목이나 와일드카드가 없다', () => {
    for (const host of ALLOWED_HOSTS) {
      expect(host).not.toMatch(/^[.*]/);
    }
  });
});

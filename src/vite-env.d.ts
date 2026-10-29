/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

interface ImportMetaEnv {
  readonly VITE_AUTO_BACKUP_INTERVAL_MS?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_KAKAO_LOGIN_CLIENT_ID?: string;
  readonly VITE_NAVER_LOGIN_CLIENT_ID?: string;
  readonly VITE_SYNC_DEV_FAKE?: string;

  /** 카카오톡 공유에 쓰는 JavaScript 키. 비어 있으면 단추를 숨긴다. */
  readonly VITE_KAKAO_JS_KEY?: string;
  /** 약속 올리기 때 지연 로딩하는 Turnstile의 공개 사이트 키. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_NAVER_MAP_CLIENT_ID?: string;
  /** 'fake'면 DOM 전용 가짜 지도(테스트·E2E). */
  readonly VITE_MAP_ADAPTER?: string;
  /** 보기 화면 틀이 iframe으로 띄우는 지도 페이지 주소. 없으면 `https://sch0718.github.io/landmark/`. */
  readonly VITE_SHARE_MAP_URL?: string;
  /** 보기 화면의 `Landmark에 담기`가 여는 앱 주소. 없으면 `https://landmark.sch0718.dev`. */
  readonly VITE_APP_URL?: string;
}

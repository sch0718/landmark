/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

interface ImportMetaEnv {
  readonly VITE_NAVER_MAP_CLIENT_ID?: string;
  /** 'fake'면 DOM 전용 가짜 지도(테스트·E2E). */
  readonly VITE_MAP_ADAPTER?: string;
  /** 보기 화면 틀이 iframe으로 띄우는 지도 페이지 주소. 없으면 `https://sch0718.github.io/landmark/`. */
  readonly VITE_SHARE_MAP_URL?: string;
}

/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/react" />

interface ImportMetaEnv {
  readonly VITE_NAVER_MAP_CLIENT_ID?: string;
  /** 'fake'면 DOM 전용 가짜 지도(테스트·E2E). */
  readonly VITE_MAP_ADAPTER?: string;
}

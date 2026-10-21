# 링크 공유 구현 계획

목표: 합의된 링크 공유 스펙을 기존 파일 공유와 함께 제공한다. 이 워크트리에서 순서대로 구현하고 커밋하지 않는다.

- [x] `tests/unit/share-viewer/encode.test.ts`에 보기 링크 생성 시험을 먼저 추가하고 실패 확인 후 `encode.ts`에 `viewLink`를 구현한다. v1 원본, v2 경로선 우선·제거 재시도, 32,000자 경계와 압축 기능 없음을 확인한다.
- [x] `tests/unit/share-viewer/decode.test.ts`와 `main.test.ts`에 해시 왕복·형식·한도·오류·같은 탭 시험을 추가하고 실패 확인 후 `decode.ts`, `parse.ts`, `main.ts`, `render.ts`를 구현한다. 파일 모드는 유지한다.
- [x] `tests/unit/sections/share-export/share-link-dialog.test.tsx`에 버튼·클립보드·메모·크기·취소 시험을 먼저 쓴다. 두 공유 창이 `linkDoc`으로 원본 문서를 넘기고 별도 훅에서 링크를 미리 만든 뒤 `ShareFileDialog.tsx`에 연결한다.
- [x] `vite.viewer.config.ts`에서 `view.html`을 함께 생성하고 `vite.config.ts`에 개발 경로를 연결한다. `.gitignore`와 README를 갱신한다. E2E 지도 포트를 5180으로 옮긴다.
- [ ] 새 `tests/e2e/share-link.spec.ts`에 장소·일정 링크 전체 흐름을 추가한다. `E2E_PORT=5179 yarn test:e2e tests/e2e/share-export.spec.ts tests/e2e/share-import.spec.ts tests/e2e/trip-share.spec.ts tests/e2e/share-link.spec.ts`를 실행한다.
- [x] `yarn lint`, `yarn build:ci`를 실행해 전체 단위 시험·빌드·용량을 확인하고 변경 파일·제약을 검토한다.

## 확인 결과

- `yarn lint`: 통과, 오류 0개.
- `npm_config_script_shell=/tmp/share-check-shell yarn build:ci`: 통과. 샌드박스가 `tsx` CLI의 IPC 소켓을 막아 임시 셸에서 같은 검증 파일을 `node --import tsx`로 실행했다. 저장소의 스크립트는 바꾸지 않았다. 단위 시험 203개 파일·3,493개 통과, 실패 0개.
- 보기 화면 틀 39,282바이트(한도 51,200), 첫 JS gzip 317,308바이트(한도 327,680).
- 빌드 HTML을 jsdom에서 오프라인 실행: v1·v2 보기, 오류 3종, 파일 새 탭 유지 등 6개 통과, 실패 0개. 개발 경로 시험 8개는 전체 단위 시험에 포함된다.
- 지정 E2E 4개 파일 명령을 시도했으나 Vite가 `listen EPERM ::1:5179`로 시작하지 못해 시험 실행 0개. 서버를 열 수 있는 환경에서 같은 명령을 다시 실행해야 한다. 새 링크 E2E는 desktop·iphone·galaxy에 등록했다.
- 별도 코드 리뷰에서 발견한 해시만 바뀌는 이동 문제는 재현 시험 후 수정했다. 금지 파일 변경·새 의존성·U+2028/U+2029·git 커밋/푸시는 없다.

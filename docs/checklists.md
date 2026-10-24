# 체크리스트

배포 뒤 사람이 직접 확인할 항목입니다. 실물 기기 점검 기록은 [ui-device-checks.md](ui-device-checks.md), 개발 문서는 [development.md](development.md)에 있습니다.

## 수동 확인 (배포 후)

- [ ] 실제 네이버 지도 렌더링(라벨 색 마커·보관함 필터와 같은 표시·마커 선택 → 상세/목록 연동)
- [ ] iOS Safari: 보관함에 장소가 있는 상태에서 새로고침 → 라벨 붙이기 → 메모 입력 후 홈으로 나갔다 돌아와 저장 확인
- [ ] iOS Safari 사생활 보호 모드: 메모리 모드 배너가 뜨고 앱이 멈추지 않는지
- [ ] Android Chrome: 같은 흐름(하단 탭, 상세 시트, 일괄 선택 길게 누르기)
- [ ] 옛 여행 가져오기: `/t/<publicId>` 미리보기 → 긴 라벨 이름·긴 메모 결정 → 가져오기 → 보관함·지도에 반영
- [ ] 두 탭에서 각각 다른 장소의 메모를 고친 뒤 새로고침해 둘 다 남는지
- [ ] 다크 모드(세 테마)에서 다이얼로그·메뉴 표면색과 버튼 글자가 또렷한지

## 첫 배포 (작성자와 함께)

- [x] Cloudflare Pages에 repo 연결(`sch0718/landmark` `main` → `https://landmark-c5f.pages.dev`, 2026-10-12 확인)
- [ ] Pages 빌드 명령(`yarn build:ci`)·출력(`dist`)·`NODE_VERSION=24`·`VITE_NAVER_MAP_CLIENT_ID` 설정 확인
- [ ] NCP 콘솔 Web 서비스 URL에 `https://landmark.sch0718.dev`·`https://landmark-c5f.pages.dev`·`http://localhost:5173`·`http://localhost:8788` 등록
- [x] 커스텀 도메인 `landmark.sch0718.dev` 연결(Cloudflare Registrar, Pages Custom domains, 2026-10-18)
- [x] NCP Maps 애플리케이션에서 Reverse Geocoding 켜기(2026-10-12 확인)
- [ ] 배포 주소에서 링크 추가(`/api/place`)·폴더 가져오기(`/api/naver-folder`)·여행 구간 경로(`/api/route`) 동작 확인
- [ ] 실제 여행 yaml 작성 → `yarn collect` → 커밋·push → 배포 확인
- [ ] 위 수동 확인 체크리스트 수행
- [ ] NCP Maps 요금·무료 사용량을 확인해 이 README에 날짜와 함께 기록

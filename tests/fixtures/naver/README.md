# 네이버 녹화 fixture

녹화일: 2026-10-03. 테스트는 네트워크를 호출하지 않고 이 파일들만 사용한다. 모두 `python3 -m json.tool`로 정렬 출력했다.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
FID=fb65e7f93f8a4144a4ded594d604a7aa
B="https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/$FID/bookmarks"
R="https://pages.map.naver.com/save-pages/detail-list/$FID"
curl -s -A "$UA" -H "Referer: $R" "$B?start=0&limit=500"  # bookmarks-sokcho.json
curl -s -A "$UA" -H "Referer: $R" "$B?start=0&limit=20"   # bookmarks-page1.json
curl -s -A "$UA" -H "Referer: $R" "$B?start=20&limit=20"  # bookmarks-page2.json
curl -s -A "$UA" -H "Referer: https://map.naver.com/" \
  "https://map.naver.com/p/api/directions/car?start=128.8961,37.7519&goal=128.9184,37.7952"  # route-ok.json
```

- `Origin` 헤더는 보내지 않는다(보내면 403).
- 폴더 "속초, 고성, 양양 맛집"은 녹화 시점에 31곳이었다(CLAUDE.md의 15곳은 오래된 값). 그래서 페이지네이션 fixture는 limit=20으로 받았다(20 + 11).
- `route-ok.json`은 실시간 교통 기준이다: distance 6862, path 280점(계획서의 6689/282와 다름). 테스트는 녹화값을 쓴다.
- `route-error.json`은 손으로 만든 오류 응답이다.
- 녹화 뒤 사용자 식별 필드를 지웠다(2026-10-04): `folder.encryptedUserIdNo`, `folder.placeUserProfile`(닉네임·프로필 이미지 URL·placeUserId·리뷰 페이지 URL), `folder.userId`, `folder.userIdNo`. 테스트는 이 필드에 의존하지 않는다. 다시 녹화하면 같은 필드를 지운다.

## 장소 홈 영업시간 (`pcmap-home-*.html`)

녹화일: 2026-10-16. 테스트는 네트워크를 호출하지 않고 이 파일들만 사용한다. 장소 홈 HTML(약 380KB)에서 `"newBusinessHours":[…]` 배열과 그 앞뒤 모양(`__APOLLO_STATE__` 바깥 틀, 뒤따르는 `"]}[{"` 스크립트)만 남기고 줄였다. `__typename` 필드는 뺐다.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -s -A "$UA" -H "Accept-Language: ko-KR,ko;q=0.9" -H "Referer: https://map.naver.com/" \
  "https://pcmap.place.naver.com/restaurant/<sid>/home"
```

- `pcmap-home-11733192.html`: 단천면옥. 수요일 정기휴무·브레이크타임·라스트오더가 있는 요일별 7항목.
- `pcmap-home-11815720.html`: 88생선구이. `매일` 한 항목·브레이크타임·`freeText`.
- `/place/<sid>/home`으로 부르면 식당이면 302로 `/restaurant/<sid>/home`으로 간다. 박물관처럼 이동 없이 200을 주는 곳도 있다.
- 요청 간격을 두고 받는다(5초 이상). 잦으면 네이버가 빈 응답을 준다.
- 다시 녹화하면 값이 달라질 수 있다(영업시간 변경, 요일 순서는 조회한 날의 요일부터 시작). 테스트는 이 파일 값만 쓴다.

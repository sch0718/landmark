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

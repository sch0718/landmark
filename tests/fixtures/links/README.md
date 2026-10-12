# 링크 해석 녹화 fixture

녹화일: 2026-10-12. `tests/unit/server/resolve.test.ts`가 네트워크 대신 이 파일들을 쓴다. 공개 장소·공유 폴더만 받았다.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
# 네이버 장소: naver-place-1958911015.json, naver-place-1540168051.json, naver-place-missing.json(없는 ID 9999999999999)
curl -s -A "$UA" -H "Accept-Language: ko-KR,ko;q=0.9" -H "Referer: https://map.naver.com/" \
  "https://map.naver.com/p/api/place/summary/1958911015"
# 카카오 panel3: kakao-panel3-16990385.json(`summary`만 남김), kakao-panel3-missing.json(없는 ID 99999999999, HTTP 404)
curl -s -A "$UA" -H "pf: web" -H "Referer: https://place.map.kakao.com/" \
  "https://place-api.map.kakao.com/places/panel3/16990385"
# 공유 폴더 1쪽: naver-folder-page1.json, naver-folder-missing.json(없는 공유 ID, HTTP 400)
FID=fb65e7f93f8a4144a4ded594d604a7aa
curl -s -A "$UA" -H "Accept-Language: ko-KR,ko;q=0.9" \
  -H "Referer: https://pages.map.naver.com/save-pages/detail-list/$FID" \
  "https://pages.map.naver.com/save-pages/api/maps-bookmark/v3/shares/$FID/bookmarks?start=0&limit=500"
# 이동(redirects.json): 상태 코드와 Location 헤더만 적었다
curl -s -o /dev/null -D - -A "$UA" https://naver.me/Fk73Vab5
curl -s -o /dev/null -D - -A "$UA" https://naver.me/xjYaIYfe
curl -s -o /dev/null -D - -A "$UA" https://kko.to/MWuG8x8eN4
curl -s -o /dev/null -D - -A "landmark-link-resolver" https://maps.app.goo.gl/SsZWtW1xgZVgijxK6
```

- 카카오 panel3는 `User-Agent`가 없으면(curl 기본값) 406을 준다.
- 구글 짧은 링크는 브라우저 UA면 302 대신 HTML을 준다.
- 공유 폴더에서 사용자 식별 필드를 지웠다: `folder.encryptedUserIdNo`, `folder.placeUserProfile`, `folder.userId`, `folder.userIdNo`. 다시 녹화하면 같은 필드를 지운다.

import { encodeCompressedJson } from 'src/domain/codec';
import type { ShareDoc } from 'src/schema/share';

/** 시험용 공유 문서: 라벨 1개, 장소 2곳. */
export const SHARE_DOC: ShareDoc = {
  format: 'tripmap-share',
  version: 1,
  title: '강릉 여행',
  createdAt: '2026-10-11T03:04:05.678Z',
  labels: [{ id: 'l1', name: '맛집', color: 'red', order: 0 }],
  places: [
    {
      id: 'p1',
      name: '닭강정집',
      address: '강원 강릉시 1',
      lng: 128.9,
      lat: 37.75,
      labelIds: ['l1'],
    },
    { id: 'p2', name: '횟집', address: '강원 강릉시 2', lng: 128.91, lat: 37.76, labelIds: [] },
  ],
};

const TEMPLATE =
  '<!doctype html><html><head><script type="application/json" id="tripmap-share">__DATA__</script></head><body></body></html>';

/** 공유 파일(HTML)처럼 보이는 `File`. */
export function shareFile(doc: unknown = SHARE_DOC, name = 'share.html'): File {
  return new File([TEMPLATE.replace('__DATA__', JSON.stringify(doc))], name, {
    type: 'text/html',
  });
}

/** 데이터 블록이 없는 HTML 파일. */
export const plainHtmlFile = (): File =>
  new File(['<html><body>hi</body></html>'], 'plain.html', { type: 'text/html' });

/** 공유 링크의 해시 값(`#d=` 뒤). */
export const shareHashValue = (doc: ShareDoc = SHARE_DOC): Promise<string> =>
  encodeCompressedJson(doc);

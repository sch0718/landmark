// 본문 글꼴(Pretendard 가변, 한글 부분 집합). 모든 테마가 쓰므로 항상 불러온다.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';

let display: Promise<void> | undefined;

/** 수첩 테마의 제목 글꼴(고운바탕). 처음 부를 때 한 번만 내려받고, 실패하면 다음에 다시 시도한다. */
export function loadDisplayFont(): Promise<void> {
  display ??= Promise.all([
    import('@fontsource/gowun-batang/400.css'),
    import('@fontsource/gowun-batang/700.css'),
  ]).then(
    () => undefined,
    (error: unknown) => {
      display = undefined;
      throw error;
    },
  );
  return display;
}

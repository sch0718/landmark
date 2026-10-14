/**
 * 요소의 클래스에 걸린 일반 규칙(가상 클래스·자손 선택자 제외)에서 속성 값을 읽는다.
 * jsdom의 `getComputedStyle`은 `font: inherit` 같은 줄임 속성 때문에 글자 크기를 믿을 수 없다.
 * 같은 속성이 여러 번 나오면 마지막 값(실제로 이기는 값)을 돌려준다.
 */
export function ruleValue(element: Element, property: string): string | undefined {
  const classes = [...element.classList].map((name) => `.${name}`);
  let value: string | undefined;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!classes.includes(rule.selectorText)) continue;
      const found = rule.style.getPropertyValue(property);
      if (found !== '') value = found;
    }
  }
  return value;
}

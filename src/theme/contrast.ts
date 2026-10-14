type Rgba = { r: number; g: number; b: number; a: number };

/** `#RGB`·`#RRGGBB`·`#RRGGBBAA`·`rgb()`·`rgba()`를 0~255 채널과 0~1 알파로 읽는다. */
function parseColor(input: string): Rgba {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (full.length === 6 || full.length === 8) {
      return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
    value,
  );
  if (fn !== null) {
    const alpha = fn[4];
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a:
        alpha === undefined
          ? 1
          : alpha.endsWith('%')
            ? Number.parseFloat(alpha) / 100
            : Number(alpha),
    };
  }
  throw new Error(`색을 읽을 수 없습니다: ${input}`);
}

/** 반투명 색을 불투명 배경 위에 얹은 결과. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x 상대 휘도. */
function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 글자색 `fg`와 배경색 `bg`의 WCAG 대비(1~21). 반투명인 `fg`는 `bg` 위에 합성해서 계산한다.
 * 배경은 불투명으로 본다(알파가 있으면 흰색 위에 합성).
 */
export function contrastRatio(fg: string, bg: string): number {
  const back = composite(parseColor(bg), { r: 255, g: 255, b: 255, a: 1 });
  const front = composite(parseColor(fg), back);
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

import type { Locator, Page } from '@playwright/test';

const positions = new WeakMap<Page, { x: number; y: number }>();
const between = (min: number, max: number): number => min + Math.random() * (max - min);
export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Cosmetic pointer only; never intercepts the app's gestures. */
export async function installFinger(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mount = () => {
      if (document.getElementById('demo-finger')) return;
      const style = document.createElement('style');
      style.textContent = `
        #demo-finger { position:fixed; left:0; top:0; width:44px; height:44px;
          margin:-22px; border-radius:50%; background:rgba(255,168,102,.38);
          border:2px solid rgba(255,255,255,.85); box-sizing:border-box;
          pointer-events:none; z-index:2147483647; opacity:0;
          transition:scale 90ms ease; box-shadow:0 1px 7px #0003; }
        .demo-ripple { position:fixed; width:44px; height:44px; margin:-22px;
          border:2px solid rgba(255,166,89,.8); border-radius:50%; box-sizing:border-box;
          pointer-events:none; z-index:2147483646; animation:demo-ripple 650ms ease-out forwards; }
        @keyframes demo-ripple { from { transform:scale(.7); opacity:.9; }
          to { transform:scale(2.1); opacity:0; } }
      `;
      const finger = document.createElement('div');
      finger.id = 'demo-finger';
      finger.setAttribute('aria-hidden', 'true');
      document.head.append(style);
      document.body.append(finger);
      const move = (event: PointerEvent) => {
        finger.style.left = `${event.clientX}px`;
        finger.style.top = `${event.clientY}px`;
        finger.style.opacity = '1';
      };
      document.addEventListener('pointermove', move, { passive: true });
      document.addEventListener(
        'pointerdown',
        (event) => {
          move(event);
          finger.style.scale = '.78';
          const ripple = document.createElement('div');
          ripple.className = 'demo-ripple';
          ripple.setAttribute('aria-hidden', 'true');
          ripple.style.left = `${event.clientX}px`;
          ripple.style.top = `${event.clientY}px`;
          document.body.append(ripple);
          ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        },
        { passive: true },
      );
      document.addEventListener(
        'pointerup',
        () => {
          finger.style.scale = '1';
        },
        { passive: true },
      );
      document.addEventListener(
        'pointercancel',
        () => {
          finger.style.scale = '1';
        },
        { passive: true },
      );
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  });
}

async function approach(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.evaluate((element) =>
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }),
  );
  let previous = await locator.boundingBox();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await pause(100);
    const current = await locator.boundingBox();
    if (
      attempt >= 4 &&
      current &&
      previous &&
      Math.abs(current.x - previous.x) < 0.5 &&
      Math.abs(current.y - previous.y) < 0.5
    )
      break;
    previous = current;
  }
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot point at an element without a bounding box');
  const from = positions.get(page) ?? { x: 35, y: 80 };
  const to = {
    x: box.x + box.width / 2 + between(-Math.min(3, box.width / 8), Math.min(3, box.width / 8)),
    y: box.y + box.height / 2 + between(-Math.min(3, box.height / 8), Math.min(3, box.height / 8)),
  };
  const bend = between(-35, 35);
  const duration = between(400, 700);
  const steps = 24;
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const eased = 1 - (1 - t) ** 3;
    await page.mouse.move(
      from.x + (to.x - from.x) * eased + Math.sin(Math.PI * eased) * bend,
      from.y + (to.y - from.y) * eased - (Math.sin(Math.PI * eased) * bend) / 2,
    );
    await pause(duration / steps);
  }
  positions.set(page, to);
  await pause(150);
}

export async function tap(page: Page, locator: Locator): Promise<void> {
  await approach(page, locator);
  await page.mouse.down();
  await pause(between(80, 120));
  await page.mouse.up();
}

export async function longPress(page: Page, locator: Locator): Promise<void> {
  await approach(page, locator);
  await page.mouse.down();
  await pause(800);
  await page.mouse.up();
}

/** Replaces existing text through normal keyboard events, then types at reading speed. */
export async function type(page: Page, locator: Locator, text: string): Promise<void> {
  await tap(page, locator);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  for (const character of text) {
    // insertText preserves Korean characters; each call emits a real input event.
    await page.keyboard.insertText(character);
    await pause(between(90, 200) + (/\s|[,.!?。]/u.test(character) ? 100 : 0));
  }
}

/** Put the pointer over scrollable content, then ease the wheel to a stop. */
export async function scroll(page: Page, dy: number): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const position = { x: viewport.width * 0.55, y: viewport.height * 0.58 };
  await page.mouse.move(position.x, position.y, { steps: 12 });
  positions.set(page, position);
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  for (const weight of weights) {
    await page.mouse.wheel(0, (dy * weight) / 36);
    await pause(55);
  }
  await pause(180);
}

import { expect, it } from 'vitest';
import { HUBS } from 'src/domain/meeting/hubs';

it('150곳의 역은 id가 유일하고 한국 안에 있다', () => {
  expect(HUBS).toHaveLength(150);
  expect(new Set(HUBS.map((h) => h.id)).size).toBe(150);
  for (const h of HUBS) {
    expect(h.name.trim().length).toBeGreaterThan(0);
    expect(h.lng).toBeGreaterThanOrEqual(124);
    expect(h.lng).toBeLessThanOrEqual(132);
    expect(h.lat).toBeGreaterThanOrEqual(33);
    expect(h.lat).toBeLessThanOrEqual(39);
  }
});

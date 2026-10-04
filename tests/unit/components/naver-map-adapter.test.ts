import { afterEach, describe, expect, it, vi } from 'vitest';
import { NaverMapAdapter } from 'src/components/map/NaverMapAdapter';

let release!: () => void;
vi.mock('src/components/map/load-naver-sdk', () => ({
  loadNaverSdk: vi.fn(() => new Promise<void>((r) => (release = r))),
}));

afterEach(() => {
  delete (window as { naver?: unknown }).naver;
});

describe('NaverMapAdapter', () => {
  it('SDK 로드 중 destroy되면 Map을 만들지 않는다', async () => {
    const MapCtor = vi.fn();
    (window as unknown as { naver: unknown }).naver = { maps: { Map: MapCtor, LatLng: vi.fn() } };
    const adapter = new NaverMapAdapter('id');
    const mounted = adapter.mount(document.createElement('div'));
    adapter.destroy();
    release();
    await mounted;
    expect(MapCtor).not.toHaveBeenCalled();
  });
});

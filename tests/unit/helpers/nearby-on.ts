import { act, waitFor } from '@testing-library/react';
import type { createStore } from 'jotai';
import { expect } from 'vitest';
import { Geolocation } from 'src/services/geolocation';
import { locateAtom, myLocationAtom, nearbyAtom } from 'src/stores/my-location';
import { fakeGeolocation, type FakeCoords } from './fake-geolocation';

/** 보관함 시험 장소(`makePlace`)와 같은 자리. 반경 3km 안에 장소가 남는다. */
export const NEARBY_BASE: FakeCoords = { longitude: 128.95, latitude: 37.77, accuracy: 30 };

/** 가짜 위치 API와 그것을 쓰는 `renderApp({ geolocation })`용 레이어. */
export function nearbyHarness() {
  const fake = fakeGeolocation();
  return { fake, geolocation: Geolocation.layerWith({ api: fake.api, secure: true }) };
}

/**
 * 화면의 `가까운 순` 선택과 같은 상태로 만든다: 위치를 한 번 찾아 답하고 근처 모드를 켠다(반경 3km).
 * 다른 흐름이 근처 모드를 끄는지 보는 시험의 사전 조건이다.
 */
export async function turnNearbyOn(
  store: ReturnType<typeof createStore>,
  fake: ReturnType<typeof fakeGeolocation>,
): Promise<void> {
  act(() => {
    void store.set(locateAtom);
    store.set(nearbyAtom, { on: true, radiusM: 3000 });
  });
  await waitFor(() => expect(fake.requests).toHaveLength(1));
  await act(async () => fake.succeed(0, NEARBY_BASE));
  await waitFor(() => expect(store.get(myLocationAtom).fix).not.toBeNull());
}

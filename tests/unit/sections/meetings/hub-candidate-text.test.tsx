import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { setAppRuntimeForTest } from 'src/lib/effect/runtime';
import { LibrarySchema, emptyLibrary } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { libraryAtom } from 'src/stores/library-state';
import { buildMeeting } from '../../../fixtures/builders';
import { renderLibrary } from '../library/fixtures';

vi.mock('src/domain/meeting/hubs', () => ({
  HUBS: [{ id: 'hub001', name: '역'.repeat(61), region: '서울', lng: 127, lat: 37.5 }],
}));
afterEach(() => {
  setAppRuntimeForTest(null);
  vi.unstubAllGlobals();
});

it('역의 긴 이름도 줄여서 후보로 저장한다', async () => {
  const base = buildMeeting();
  const meeting = buildMeeting({
    mode: { ...base.mode, value: 'straight' },
    candidates: { ...base.candidates, value: [] },
    participants: {
      ...base.participants,
      value: [
        { id: 'person01', name: '나', origin: { name: '집', lng: 127, lat: 37.5 } },
        { id: 'person02', name: '친구', origin: { name: '회사', lng: 127.1, lat: 37.6 } },
      ],
    },
  });
  const { store } = await renderLibrary(
    { ...emptyLibrary(), meetings: { [meeting.id]: meeting } },
    { path: `/meetings/${meeting.id}`, ids: ['choice02'] },
  );
  fireEvent.click(await screen.findByRole('button', { name: '중간 지점 찾기' }));
  fireEvent.click(await screen.findByRole('button', { name: /후보에 담기$/ }));
  await waitFor(() => {
    const library = store.get(libraryAtom);
    expect(library.meetings![meeting.id]!.candidates.value).toMatchObject([
      { kind: 'hub', name: '역'.repeat(59) + '…', hubId: 'hub001' },
    ]);
    expect(safeParse(LibrarySchema, library).success).toBe(true);
  });
});

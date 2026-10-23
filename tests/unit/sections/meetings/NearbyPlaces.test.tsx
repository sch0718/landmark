import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { addCandidate } from 'src/domain/meeting/ops';
import { emptyLibrary, LibrarySchema } from 'src/schema/library';
import { safeParse } from 'src/schema/parse';
import { NearbyPlaces } from 'src/sections/meetings/NearbyPlaces';
import { buildMeeting } from '../../../fixtures/builders';
import { makePlace } from '../library/fixtures';

it.each([
  ['가'.repeat(61), '나'.repeat(121), '가'.repeat(59) + '…', '나'.repeat(119) + '…'],
  [
    '가'.repeat(58) + '😀뒤',
    '나'.repeat(118) + 'e\u0301뒤',
    '가'.repeat(58) + '…',
    '나'.repeat(118) + '…',
  ],
  [
    '  ' + '가'.repeat(60) + '  ',
    '  ' + '나'.repeat(120) + '  ',
    '가'.repeat(60),
    '나'.repeat(120),
  ],
])(
  '근처 장소 이름 %s와 주소를 한도에 맞춰 후보로 저장한다',
  (name, address, fittedName, fittedAddress) => {
    const meeting = buildMeeting();
    const place = makePlace(1, { name, address });
    const library = {
      ...emptyLibrary(),
      places: { [place.id]: place },
      meetings: { [meeting.id]: meeting },
    };
    const onAdd = vi.fn();
    render(
      <NearbyPlaces
        hub={{ id: 'hub001', name: '역', region: '강릉', lng: place.lng, lat: place.lat }}
        library={library}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /후보에 담기/ }));
    expect(onAdd).toHaveBeenCalledOnce();
    const result = addCandidate(library, meeting.id, onAdd.mock.calls[0]![0], {
      now: meeting.createdAt,
      newId: () => 'choice02',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(safeParse(LibrarySchema, result.lib).success).toBe(true);
    const stored = result.lib.meetings![meeting.id]!.candidates.value.at(-1)!;
    expect(stored).toMatchObject({ name: fittedName, address: fittedAddress, placeId: place.id });
    expect(stored.name.length).toBeLessThanOrEqual(60);
    expect(stored.address!.length).toBeLessThanOrEqual(120);
    expect(place.name.value).toBe(name);
    expect(place.address).toBe(address);
  },
);

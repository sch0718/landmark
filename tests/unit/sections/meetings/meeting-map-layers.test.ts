import { describe, expect, it } from 'vitest';
import { meetingMapLayers } from 'src/sections/meetings/meeting-map-layers';
import { buildMeeting } from '../../../fixtures/builders';

const f = <T>(value: T) => ({ value, updatedAt: '2026-10-23T00:00:00.000Z' });
describe('약속 지도 레이어', () => {
  it('출발지가 있는 참석자만 첫 글자로 표시하고 이름을 텍스트로 보존한다', () => {
    const meeting = buildMeeting({
      participants: f([
        { id: 'person01', name: '민지', origin: { name: '<img>', lng: 127, lat: 37.5 } },
        { id: 'person02', name: '영희', origin: null },
      ]),
    });
    const { markers, polylines } = meetingMapLayers(meeting, []);
    expect(markers.find((m) => m.id === 'origin:person01')).toMatchObject({
      label: '민',
      lng: 127,
      lat: 37.5,
      clusterable: false,
    });
    expect(markers.some((m) => m.id === 'origin:person02')).toBe(false);
    expect(polylines).toEqual([]);
  });
  it('역은 순위 번호를 보이고 후보를 강조한다', () => {
    const { markers } = meetingMapLayers(buildMeeting(), [
      { id: 'seoul', name: '서울역', region: '서울', lng: 126.97, lat: 37.55 },
    ]);
    expect(markers.find((m) => m.id === 'hub:seoul')).toMatchObject({
      label: '1 서울역',
      clusterable: false,
    });
    expect(markers.find((m) => m.id === 'candidate:choice01')).toMatchObject({
      label: '강남역',
      selected: true,
    });
  });
  it('확정 후보는 확정 이름표와 별도 색으로 표시한다', () => {
    const normal = meetingMapLayers(buildMeeting(), []).markers[0]!;
    const final = meetingMapLayers(buildMeeting({ decided: f('choice01') }), []).markers[0]!;
    expect(final.label).toBe('확정 · 강남역');
    expect(final.color).not.toBe(normal.color);
  });
});

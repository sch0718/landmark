import type { MapMarker, MapPolyline } from 'src/components/map/MapAdapter';
import type { Hub } from 'src/domain/meeting/hubs';
import type { Meeting } from 'src/schema/meeting';

/** 약속 출발지·순위·후보·확정 핀. 이름은 어댑터의 textContent로 그린다. */
export function meetingMapLayers(
  meeting: Meeting,
  hubs: readonly Hub[] = [],
): { markers: MapMarker[]; polylines: MapPolyline[] } {
  const markers: MapMarker[] = [];
  for (const participant of meeting.participants.value) {
    if (participant.origin === null) continue;
    markers.push({
      id: `origin:${participant.id}`,
      lng: participant.origin.lng,
      lat: participant.origin.lat,
      label: Array.from(participant.name)[0] ?? '',
      color: '#455a64',
      clusterable: false,
    });
  }
  hubs.forEach((hub, i) =>
    markers.push({
      id: `hub:${hub.id}`,
      lng: hub.lng,
      lat: hub.lat,
      label: `${i + 1} ${hub.name}`,
      color: '#536dfe',
      clusterable: false,
    }),
  );
  for (const candidate of meeting.candidates.value) {
    const decided = meeting.decided.value === candidate.id;
    markers.push({
      id: `candidate:${candidate.id}`,
      lng: candidate.lng,
      lat: candidate.lat,
      label: decided ? `확정 · ${candidate.name}` : candidate.name,
      color: decided ? '#19733b' : '#b64800',
      selected: true,
      clusterable: false,
    });
  }
  return { markers, polylines: [] };
}

import type { MapMarker } from 'src/components/map/MapAdapter';
import { existingShareIds } from 'src/domain/library/import-share';
import type { Library } from 'src/schema/library';
import type { Recommendation } from 'src/services/recommend/api';
import type { Tokens } from 'src/theme/tokens';
export function recommendMarkers(
  recs: Recommendation[],
  library: Library,
  tokens: Tokens,
): { markers: MapMarker[]; byId: Map<string, { rec: Recommendation; placeId: string }> } {
  const markers: MapMarker[] = [];
  const byId = new Map<string, { rec: Recommendation; placeId: string }>();
  const seen = new Set<string>();
  for (const rec of recs) {
    const existing = existingShareIds(library, rec.doc);
    for (const place of rec.doc.places) {
      const key = JSON.stringify([place.name, place.lng.toFixed(5), place.lat.toFixed(5)]);
      if (existing.has(place.id) || seen.has(key)) continue;
      seen.add(key);
      const id = `rec:${rec.id}:${place.id}`;
      markers.push({
        id,
        lng: place.lng,
        lat: place.lat,
        label: `☆ ${place.name}`,
        color: tokens.bg.surface,
        textColor: tokens.text.secondary,
        borderColor: tokens.accent.main,
        dimmed: true,
        clusterable: false,
        fit: false,
      });
      byId.set(id, { rec, placeId: place.id });
    }
  }
  return { markers, byId };
}

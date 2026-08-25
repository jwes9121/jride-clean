import type { ErrandRoutePoint } from "@/lib/errand/confirmedRoute";

type ProposedSubstitute = {
  sequence: number;
  placeName?: string | null;
  locationLabel: string;
  lat: number;
  lng: number;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function point(
  key: string,
  label: string,
  latValue: unknown,
  lngValue: unknown
): ErrandRoutePoint | null {
  const lat = num(latValue);
  const lng = num(lngValue);
  if (lat == null || lng == null || !text(label)) return null;
  return { key, label: text(label), lat, lng };
}

export function buildErrandBillingRoutePoints(
  bundle: any,
  proposedSubstitute?: ProposedSubstitute | null
): ErrandRoutePoint[] | null {
  const booking = bundle?.booking || {};
  const job = bundle?.job || {};
  const stops = Array.isArray(bundle?.stops) ? [...bundle.stops] : [];
  stops.sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0));

  const stage0 = point(
    "stage0",
    text(booking?.from_label) || "Stage 0",
    booking?.pickup_lat,
    booking?.pickup_lng
  );
  if (!stage0) return null;

  const output: ErrandRoutePoint[] = [stage0];

  for (const stop of stops) {
    const sequence = Number(stop?.sequence || 0);
    if (!Number.isFinite(sequence) || sequence < 1) return null;

    if (proposedSubstitute && sequence === proposedSubstitute.sequence) {
      const original = point(
        `stop-${sequence}-original`,
        text(stop?.location_label) || `Stop ${sequence}`,
        stop?.lat,
        stop?.lng
      );
      const substitute = point(
        `stop-${sequence}`,
        proposedSubstitute.locationLabel,
        proposedSubstitute.lat,
        proposedSubstitute.lng
      );
      if (!original || !substitute) return null;
      output.push(original, substitute);
      continue;
    }

    if (Boolean(stop?.is_substitute)) {
      const original = point(
        `stop-${sequence}-original`,
        text(stop?.original_location_label) || `Original Stop ${sequence}`,
        stop?.original_lat,
        stop?.original_lng
      );
      const substitute = point(
        `stop-${sequence}`,
        text(stop?.location_label) || `Substitute Stop ${sequence}`,
        stop?.lat,
        stop?.lng
      );
      if (!original || !substitute) return null;
      output.push(original, substitute);
      continue;
    }

    const normal = point(
      `stop-${sequence}`,
      text(stop?.location_label) || `Stop ${sequence}`,
      stop?.lat,
      stop?.lng
    );
    if (!normal) return null;
    output.push(normal);
  }

  const finalPoint = point(
    "final",
    text(job?.final_label) || text(booking?.to_label) || "Final destination",
    job?.final_lat,
    job?.final_lng
  );
  if (!finalPoint) return null;
  output.push(finalPoint);

  return output;
}

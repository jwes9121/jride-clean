export type TownName = "Lagawe" | "Kiangan" | "Banaue" | "Lamut" | "Hingyon";

/**
 * Official town colors (hex) - synced with your getZoneMeta Tailwind classes:
 *
 * Lagawe  -> emerald
 * Kiangan -> sky
 * Banaue  -> indigo
 * Lamut   -> amber
 * Hingyon -> rose
 */
export const TOWN_COLORS_HEX: Record<TownName, string> = {
  Lagawe: "#10B981",  // emerald-500
  Kiangan: "#0EA5E9", // sky-500
  Banaue: "#6366F1",  // indigo-500
  Lamut: "#F59E0B",   // amber-500
  Hingyon: "#F43F5E", // rose-500
};

/**
 * Given a town string (from booking zone, pickup / dropoff address, or driver profile),
 * return the correct official hex color for the map marker.
 */
export function getTownColorFromString(source?: string | null): string {
  if (!source) {
    // default fallback (plain blue)
    return "#3B82F6";
  }

  const s = source.toLowerCase();

  if (s.includes("lagawe")) return TOWN_COLORS_HEX.Lagawe;
  if (s.includes("kiangan")) return TOWN_COLORS_HEX.Kiangan;
  if (s.includes("banaue")) return TOWN_COLORS_HEX.Banaue;
  if (s.includes("lamut")) return TOWN_COLORS_HEX.Lamut;
  if (s.includes("hingyon")) return TOWN_COLORS_HEX.Hingyon;

  // unknown town - still give a sane default
  return "#3B82F6";
}

/**
 * Small helper for driver pins - pass whatever you know about the driver:
 *  - driverTown (e.g. "Lagawe")
 *  - bookingZone (e.g. "JRide Banaue Zone 1")
 *  - pickupAddress / dropoffAddress
 *
 * The first non-empty wins.
 */
export function getDriverTownColor(opts: {
  driverTown?: string | null;
  bookingZone?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
}): string {
  const { driverTown, bookingZone, pickupAddress, dropoffAddress } = opts;

  if (driverTown) return getTownColorFromString(driverTown);
  if (bookingZone) return getTownColorFromString(bookingZone);
  if (pickupAddress) return getTownColorFromString(pickupAddress);
  if (dropoffAddress) return getTownColorFromString(dropoffAddress);

  return "#3B82F6";
}

export const AGRIMARKET_ACTIVE_TOWNS = [
  "Lagawe",
  "Hingyon",
  "Banaue",
  "Lamut",
] as const;

export type AgrimarketActiveTown = (typeof AGRIMARKET_ACTIVE_TOWNS)[number];

export const FARMER_TOWN_CENTERS: Record<AgrimarketActiveTown, [number, number]> = {
  Lagawe: [121.1023, 16.7996],
  Hingyon: [121.1136, 16.8331],
  Banaue: [121.0614, 16.9136],
  Lamut: [121.2244, 16.6497],
};

const ACTIVE_TOWN_SET = new Set<string>(AGRIMARKET_ACTIVE_TOWNS);

export function isAgrimarketActiveTown(value: string): value is AgrimarketActiveTown {
  return ACTIVE_TOWN_SET.has(value);
}

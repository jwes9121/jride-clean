export const AGRIMARKET_ACTIVE_TOWNS = [
  "Lagawe",
  "Hingyon",
  "Banaue",
  "Lamut",
] as const;

export type AgrimarketActiveTown = (typeof AGRIMARKET_ACTIVE_TOWNS)[number];

export const FARMER_TOWN_CENTERS: Record<string, [number, number]> = {
  Lagawe: [121.1023, 16.7996],
  Hingyon: [121.1136, 16.8331],
  Banaue: [121.0614, 16.9136],
  Lamut: [121.2244, 16.6497],
};

// Philippine Statistics Authority / PSGC barangay names for the four
// AgriMarket launch municipalities. Keep spelling aligned with PSGC.
export const AGRIMARKET_BARANGAYS: Record<AgrimarketActiveTown, readonly string[]> = {
  Lagawe: [
    "Abinuan", "Banga", "Boliwong", "Burnay", "Buyabuyan", "Caba", "Cudog",
    "Dulao", "Jucbong", "Luta", "Montabiong", "Olilicon", "Poblacion South",
    "Ponghal", "Pullaan", "Tungngod", "Tupaya", "Poblacion East",
    "Poblacion North", "Poblacion West",
  ],
  Hingyon: [
    "Anao", "Bangtinon", "Bitu", "Cababuyan", "Mompolia", "Namulditan",
    "O-ong", "Piwong", "Poblacion", "Ubuag", "Umalbong", "Northern Cababuyan",
  ],
  Banaue: [
    "Amganad", "Anaba", "Bangaan", "Batad", "Bocos", "Banao", "Cambulo",
    "Ducligan", "Gohang", "Kinakin", "Poblacion", "Poitan", "San Fernando",
    "Balawis", "Ohaj", "Tam-an", "View Point", "Pula",
  ],
  Lamut: [
    "Ambasa", "Hapid", "Lawig", "Lucban", "Mabatobato", "Magulon", "Nayon",
    "Panopdopan", "Payawan", "Pieza", "Poblacion East", "Pugol", "Salamague",
    "Bimpal", "Holowon", "Poblacion West", "Sanafe", "Umilag",
  ],
};

const ACTIVE_TOWN_SET = new Set<string>(AGRIMARKET_ACTIVE_TOWNS);
const BARANGAY_BY_TOWN = new Map<string, Map<string, string>>(
  AGRIMARKET_ACTIVE_TOWNS.map((town) => [
    town,
    new Map(AGRIMARKET_BARANGAYS[town].map((barangay) => [barangay.toLowerCase(), barangay])),
  ])
);

export function isAgrimarketActiveTown(value: string): value is AgrimarketActiveTown {
  return ACTIVE_TOWN_SET.has(value);
}

export function agrimarketBarangays(town: string): readonly string[] {
  return isAgrimarketActiveTown(town) ? AGRIMARKET_BARANGAYS[town] : [];
}

export function canonicalAgrimarketBarangay(town: string, value: string): string | null {
  const normalized = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized || !isAgrimarketActiveTown(town)) return null;
  return BARANGAY_BY_TOWN.get(town)?.get(normalized) || null;
}

export function isAgrimarketBarangay(town: string, value: string): boolean {
  return canonicalAgrimarketBarangay(town, value) !== null;
}

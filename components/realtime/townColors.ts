export const TOWN_COLORS: Record<string, string> = {
  Lagawe: "#7B1E2D",
  Kiangan: "#2E7D32",
  Banaue: "#1565C0",
  Lamut: "#6A1B9A",
  Hingyon: "#FF8F00",
};
export function townColor(town?: string | null) {
  if (!town) return "#424242";
  return TOWN_COLORS[town] ?? "#424242";
}

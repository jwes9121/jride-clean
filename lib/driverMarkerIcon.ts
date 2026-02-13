/**
 * JRide official town colors for driver ring.
 */
export const TOWN_COLORS: Record<string, string> = {
  lagawe: "#800000",   // maroon
  kiangan: "#7CB342",  // light green
  lamut: "#1565C0",    // blue
  hingyon: "#F9A825",  // yellow
  banaue: "#6A1B9A",   // purple
  default: "#374151",
};

export function getTownColor(town?: string | null): string {
  if (!town) return TOWN_COLORS.default;
  const key = town.toLowerCase().trim();
  return TOWN_COLORS[key] ?? TOWN_COLORS.default;
}

/**
 * Driver marker:
 *  - circular badge with town-colored ring
 *  - inside: EXACT PNG icon you provided (public/icons/jride-trike.png)
 */
export function createDriverMarkerElement(town?: string | null): HTMLElement {
  const color = getTownColor(town);

  const container = document.createElement("div");
  container.style.width = "40px";
  container.style.height = "40px";
  container.style.borderRadius = "9999px";
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.justifyContent = "center";
  container.style.border = `3px solid ${color}`;
  container.style.backgroundColor = "rgba(255,255,255,0.96)";
  container.style.boxShadow = "0 4px 6px rgba(0,0,0,0.45)";
  container.style.boxSizing = "border-box";
  container.style.cursor = "pointer";

  // Use your exact PNG icon
  const img = document.createElement("img");
  img.src = "/icons/jride-trike.png"; // <-- THIS IS YOUR PNG
  img.alt = "JRide tricycle driver";
  img.style.width = "30px";
  img.style.height = "30px";
  img.style.display = "block";
  img.style.objectFit = "contain";

  container.appendChild(img);

  return container;
}

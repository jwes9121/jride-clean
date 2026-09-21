// Mirrors the existing agrimarket_cargo_family_v1 policy. Do not broaden this
// list without updating and verifying the database order-item guard as well.
const CARGO_FAMILIES: Record<string, string> = {
  standard_produce: "produce", fragile_produce: "produce", bulk_sack: "bulk_sack",
  crate: "crate", live_fish: "live_fish", live_poultry: "live_poultry",
  live_livestock: "live_livestock", fresh_meat: "fresh_meat",
  chilled_meat: "chilled_meat", frozen_meat: "frozen_meat", other_agri: "other_agri",
};

export type CartProduct = {
  name: string; cargo_class: string; availability_mode: string;
  harvest_start_at?: string | null; harvest_end_at?: string | null;
};

export function cargoFamily(value: string): string | null {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CARGO_FAMILIES, key) ? CARGO_FAMILIES[key] : null;
}

export function cargoConflict(products: { name: string; cargo_class: string }[]): string | null {
  const first = products[0];
  if (!first) return null;
  for (const product of products) {
    if (!cargoFamily(product.cargo_class)) return `The delivery requirements for ${product.name} are unavailable. Choose another item or contact JRide.`;
    if (cargoFamily(product.cargo_class) !== cargoFamily(first.cargo_class)) {
      return `${first.name} and ${product.name} require separate orders under the current delivery rules, even from the same store. Keep one delivery group in your cart; each separate order has its own delivery quote.`;
    }
  }
  return null;
}

export function cartConflict(products: CartProduct[]): string | null {
  const first = products[0];
  if (!first) return null;
  if (products.some(product => product.availability_mode !== first.availability_mode)) {
    return "Ready-to-order items and scheduled reservations require separate orders. Choose items from the same schedule group.";
  }
  if (first.availability_mode === "scheduled_harvest" && products.some(product =>
    product.harvest_start_at !== first.harvest_start_at ||
    (product.harvest_end_at || product.harvest_start_at) !== (first.harvest_end_at || first.harvest_start_at))) {
    return "These items have different preparation dates. Choose items from the same schedule group.";
  }
  return cargoConflict(products);
}

export function deliveryGroupKey(product: CartProduct): string {
  return JSON.stringify([cargoFamily(product.cargo_class) || product.cargo_class, product.availability_mode,
    product.availability_mode === "scheduled_harvest" ? product.harvest_start_at : null,
    product.availability_mode === "scheduled_harvest" ? product.harvest_end_at || product.harvest_start_at : null]);
}

export function cargoGroupLabel(cargoClass: string): string {
  const labels: Record<string, string> = {
    produce: "Produce and fragile produce", bulk_sack: "Sacks", crate: "Crates",
    live_fish: "Live fish", live_poultry: "Live poultry", live_livestock: "Live livestock",
    fresh_meat: "Fresh meat", chilled_meat: "Chilled meat", frozen_meat: "Frozen meat", other_agri: "Other agricultural goods",
  };
  return labels[cargoFamily(cargoClass) || ""] || "Delivery requirements unavailable";
}

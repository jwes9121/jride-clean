export type MeatCut = { name: string; price_per_kg: number; available_kg: number };
export type ButcheringPayload = {
  species: string; breed: string | null; description: string | null;
  butcher_start_at: string; butcher_end_at: string | null; order_cutoff_at: string;
  condition: "fresh" | "chilled"; vehicle_requirement: "either" | "motorcycle" | "tricycle";
  default_prep_minutes: number; is_active: boolean; cuts: MeatCut[];
};
const clean = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const date = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const offsetMinutes = match[2] === "Z" ? 0 : (match[3] === "+" ? 1 : -1) * (Number(match[4]) * 60 + Number(match[5]));
  if (new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 19) !== match[1]) return null;
  return new Date(ms).toISOString();
};
function decimal(value: unknown, maximum: number): number | null {
  if (!(typeof value === "number" || typeof value === "string") || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
  const n = Number(value); return Number.isFinite(n) && n > 0 && n <= maximum ? n : null;
}

export function normalizeButchering(input: any): ButcheringPayload {
  const species = clean(input?.species), breed = clean(input?.breed), description = clean(input?.description);
  if (species.length < 2 || species.length > 60 || breed.length > 80 || description.length > 2000) throw new Error("Enter the animal type and keep the description under 2,000 characters.");
  const start = date(input.butcher_start_at), end = input.butcher_end_at ? date(input.butcher_end_at) : null, cutoff = date(input.order_cutoff_at);
  if (!start || !cutoff || (input.butcher_end_at && !end)) throw new Error("Enter the butchering date and reservation cutoff in Philippine time.");
  if (Date.parse(cutoff) >= Date.parse(start) || (end && Date.parse(end) < Date.parse(start))) throw new Error("Reservations must close before butchering starts. The end time cannot be earlier than the start.");
  if (!["fresh", "chilled"].includes(input.condition) || !["either", "motorcycle", "tricycle"].includes(input.vehicle_requirement)) throw new Error("Choose the meat condition and delivery vehicle.");
  const prep = Number(input.default_prep_minutes);
  if (!/^[0-9]+$/.test(String(input.default_prep_minutes)) || !Number.isInteger(prep) || prep < 0 || prep > 1440 || typeof input.is_active !== "boolean") throw new Error("Check the preparation time and listing status.");
  if (!Array.isArray(input.cuts) || !input.cuts.length || input.cuts.length > 30) throw new Error("Add between 1 and 30 meat cuts.");
  const names = new Set<string>();
  const cuts = input.cuts.map((cut: any): MeatCut => {
    const name = clean(cut?.name), price = decimal(cut?.price_per_kg, 999999.99), quantity = decimal(cut?.available_kg, 100000);
    if (name.length < 2 || name.length > 80 || names.has(name.toLocaleLowerCase("en"))) throw new Error("Give each cut a different name between 2 and 80 characters.");
    if (price == null || quantity == null) throw new Error("Each cut needs a positive price per kilo and available kilos, with up to two decimal places.");
    names.add(name.toLocaleLowerCase("en")); return { name, price_per_kg: price, available_kg: quantity };
  });
  return { species, breed: breed || null, description: description || null, butcher_start_at: start, butcher_end_at: end, order_cutoff_at: cutoff, condition: input.condition, vehicle_requirement: input.vehicle_requirement, default_prep_minutes: prep, is_active: input.is_active, cuts };
}

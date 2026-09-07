export type ScheduledItem = { product_group?: string | null };

// Keep the existing scheduled_harvest wire contract and readiness gates.
// The product snapshots distinguish meat preparation from crop harvesting.
export function scheduledActivity(items: ScheduledItem[]): "butchering" | "harvest" | "preparation" {
  if (items.length && items.every(item => item.product_group === "meat")) return "butchering";
  return items.some(item => item.product_group === "meat") ? "preparation" : "harvest";
}

export function scheduledTitle(items: ScheduledItem[]): string {
  const activity = scheduledActivity(items);
  return activity === "butchering" ? "Scheduled butchering" : activity === "preparation" ? "Scheduled preparation" : "Scheduled harvest";
}

export function manilaDateTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime())) return null;
  // Reject normalized impossible dates such as February 30.
  if (new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16) !== value) return null;
  return date.toISOString();
}

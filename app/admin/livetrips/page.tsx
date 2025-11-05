import LiveDriverMap from "@/components/maps/LiveDriverMap";

async function loadInitial() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/driver_locations`, { cache: "no-store" });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

export const revalidate = 0;

export default async function LiveTripsPage() {
  const initial = await loadInitial();
  return (
    <main className="p-4 md:p-6">
      <h1 className="text-2xl font-semibold mb-4">Live Driver Map</h1>
      <LiveDriverMap initial={initial} />
    </main>
  );
}

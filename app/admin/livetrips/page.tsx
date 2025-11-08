import dynamic from "next/dynamic";

const LiveDriverMap = dynamic(
  () => import("@/components/maps/LiveDriverMap"),
  { ssr: false }
);

export default function AdminLiveTripsPage() {
  return (
    <main className="p-4 md:p-6 space-y-4">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Live Trips & Drivers</h1>
          <p className="text-sm text-gray-500">
            Real-time JRidah locations with status colors and auto-expiry.
          </p>
        </div>
      </header>

      <section className="bg-white rounded-2xl shadow-sm p-3 md:p-4">
        <h2 className="text-sm font-medium mb-2">
          Live Driver Map
        </h2>
        <LiveDriverMap />
      </section>

      <section className="bg-white rounded-2xl shadow-sm p-3 md:p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Active Trips</h2>
          <span className="text-[10px] text-gray-400">
            (Hook this to your rides/bookings query)
          </span>
        </div>
        <div className="border border-dashed border-gray-200 rounded-xl p-4 text-xs text-gray-400">
          Trip table / cards go here. This block is intentionally minimal so it
          never breaks your build while we focus on the map and status colors.
        </div>
      </section>
    </main>
  );
}

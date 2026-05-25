import LiveTripsClient from "./LiveTripsClient";

// ✅ ADMIN PC OPS WRAPPER
// LEFT  = OPS (Zone load, KPIs, trip table inside LiveTripsClient)
// RIGHT = Dispatcher map + live actions (also inside LiveTripsClient)
//
// This file now strictly acts as the Admin Control Center shell.
// No dispatcher logic is touched here.

export default function LiveTripsPage() {
  return (
    <div className="h-[calc(100vh-64px)] w-full bg-slate-100 px-3 py-2">
      <div className="h-full w-full rounded-lg border bg-white shadow-sm overflow-hidden">
        <LiveTripsClient />
      </div>
    </div>
  );
}

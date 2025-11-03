// app/dispatch/page.tsx
import { createClient } from "@supabase/supabase-js";
import DispatchNewRide from "@/components/DispatchNewRide";

async function fetchRides() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server side
    { auth: { persistSession: false } }
  );
  const { data } = await supabase
    .from("rides")
    .select("id, passenger_name, pickup_address, status, driver_id, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export default async function DispatchPage() {
  const rides = await fetchRides();

  return (
    <div className="p-6 space-y-6">
      <DispatchNewRide onSaved={() => { /* client component handles toast; page won't auto-refresh in RSC */ }} />
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Recent rides</h3>
        <div className="grid gap-2">
          {rides.map((r) => (
            <div key={r.id} className="p-3 border rounded">
              <div className="text-sm">#{r.id}</div>
              <div className="text-sm">Passenger: {r.passenger_name ?? "—"}</div>
              <div className="text-sm">Pickup: {r.pickup_address ?? "lat/lng"}</div>
              <div className="text-sm">Status: {r.status}</div>
              <div className="text-sm">Driver: {r.driver_id ?? "unassigned"}</div>
            </div>
          ))}
          {rides.length === 0 && <div className="text-sm opacity-70">No rides yet.</div>}
        </div>
      </div>
    </div>
  );
}

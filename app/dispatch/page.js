<<<<<<< HEAD
// app/dispatch/page.js
import { createClient } from "@supabase/supabase-js";
import dynamic from "next/dynamic";

// Client component (TSX file is fine; Next can import it)
=======
import { createClient } from "@supabase/supabase-js";
import dynamic from "next/dynamic";

>>>>>>> ffce4da (Dispatch: JS route only (page.js); remove any page.tsx)
const DispatchNewRide = dynamic(() => import("@/components/DispatchNewRide"), { ssr: false });

async function fetchRides() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

<<<<<<< HEAD
  const { data, error } = await supabase
=======
  const { data } = await supabase
>>>>>>> ffce4da (Dispatch: JS route only (page.js); remove any page.tsx)
    .from("rides")
    .select("id, passenger_name, pickup_address, status, driver_id, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

<<<<<<< HEAD
  if (error) {
    console.error("fetchRides error:", error.message);
    return [];
  }
=======
>>>>>>> ffce4da (Dispatch: JS route only (page.js); remove any page.tsx)
  return data ?? [];
}

export default async function DispatchPage() {
  const rides = await fetchRides();

  return (
    <div className="p-6 space-y-6">
      <DispatchNewRide />
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Recent rides</h3>
        <div className="grid gap-2">
          {rides.map((r) => (
            <div key={r.id} className="p-3 border rounded">
              <div className="text-sm">#{r.id}</div>
<<<<<<< HEAD
              <div className="text-sm">Passenger: {r.passenger_name ?? "â€”"}</div>
=======
              <div className="text-sm">Passenger: {r.passenger_name ?? "—"}</div>
>>>>>>> ffce4da (Dispatch: JS route only (page.js); remove any page.tsx)
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

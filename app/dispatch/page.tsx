// app/dispatch/page.tsx
import { createClient } from "@supabase/supabase-js";

export default async function DispatchPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // pull active or unassigned rides
  const { data: rides } = await supabase
    .from("rides")
    .select("*")
    .in("status", ["pending", "ongoing"])
    .order("created_at", { ascending: false });

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>

      {!rides || rides.length === 0 ? (
        <div className="text-sm text-gray-500">
          No active rides.
        </div>
      ) : (
        <ul className="space-y-3">
          {rides.map((ride) => (
            <li
              key={ride.id}
              className="border rounded-lg p-4 text-sm bg-white"
            >
              <div className="font-medium text-gray-900 mb-1">
                {ride.pickup_location} ➜ {ride.dropoff_location}
              </div>
              <div className="text-gray-700">
                {ride.passenger_count} pax · {ride.status}
              </div>
              <div className="text-gray-500 text-xs">
                {ride.driver_name || "— unassigned —"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

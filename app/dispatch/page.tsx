// app/dispatch/page.tsx
import { createClient } from "@supabase/supabase-js";

type RideRow = {
  id: string;
  pickup_location: string | null;
  dropoff_location: string | null;
  passenger_count: number | null;
  status: string | null;
  driver_name: string | null;
  created_at: string | null;
};

// NOTE: This is a Server Component (no "use client")
// It runs on the server in Next.js, fetches from Supabase, then returns HTML.
export default async function DispatchPage() {
  // Init Supabase client with public anon key.
  // This is safe for row-level reads if your RLS is correct.
  // (If RLS blocks you, we'll talk about adding a service role via edge function later.)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Get rides that are still active / need dispatch eyes
  const { data: rides, error } = await supabase
    .from("rides")
    .select(
      "id,pickup_location,dropoff_location,passenger_count,status,driver_name,created_at"
    )
    .in("status", ["pending", "ongoing"])
    .order("created_at", { ascending: false }) as {
    data: RideRow[] | null;
    error: any;
  };

  // Basic fallback states
  if (error) {
    return (
      <main className="p-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>
        <div className="text-red-600 text-sm">
          Could not load rides.
        </div>
        <pre className="text-xs text-gray-500 bg-gray-100 p-3 rounded mt-3 overflow-x-auto">
          {JSON.stringify(error, null, 2)}
        </pre>
      </main>
    );
  }

  if (!rides || rides.length === 0) {
    return (
      <main className="p-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>
        <div className="text-sm text-gray-500">
          No active rides.
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>

      <ul className="space-y-4">
        {rides.map((ride) => (
          <li
            key={ride.id}
            className="bg-white border rounded-lg p-4 shadow-sm text-sm"
          >
            <div className="flex items-start justify-between">
              <div className="font-medium text-gray-900">
                {ride.pickup_location || "—"} ➜{" "}
                {ride.dropoff_location || "—"}
              </div>
              <span
                className={`text-xs font-semibold rounded px-2 py-1 ${
                  ride.status === "pending"
                    ? "bg-yellow-100 text-yellow-700 border border-yellow-300"
                    : ride.status === "ongoing"
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-gray-100 text-gray-600 border border-gray-300"
                }`}
              >
                {ride.status || "—"}
              </span>
            </div>

            <div className="mt-2 text-gray-700">
              <div>
                {ride.passenger_count ?? "?"} pax
                {ride.driver_name
                  ? ` • ${ride.driver_name}`
                  : " • unassigned"}
              </div>
            </div>

            <div className="mt-2 text-[11px] text-gray-500 leading-tight">
              <div>Ride ID: {ride.id}</div>
              <div>
                Created:{" "}
                {ride.created_at
                  ? new Date(ride.created_at).toLocaleString()
                  : "—"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

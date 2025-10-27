// app/dispatch/page.tsx
import { createClient } from "@supabase/supabase-js";

type RideRow = {
  id: string;
  pickup_location: string | null;
  pickup_point: string | null;
  destination_location: string | null;
  dropoff_point: string | null;
  passenger_count: number | null;
  fare_amount: number | null;
  status: string | null;
  driver_id: string | null;
  created_at: string | null;
};

function badge(status: string | null | undefined) {
  if (status === "pending") {
    return "bg-yellow-100 text-yellow-700 border border-yellow-300";
  }
  if (status === "accepted" || status === "in_progress") {
    return "bg-green-100 text-green-700 border border-green-300";
  }
  return "bg-gray-100 text-gray-600 border border-gray-300";
}

export default async function DispatchPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: rides, error } = (await supabase
    .from("rides")
    .select(
      `
        id,
        pickup_location,
        pickup_point,
        destination_location,
        dropoff_point,
        passenger_count,
        fare_amount,
        status,
        driver_id,
        created_at
      `
    )
    .in("status", ["pending", "accepted", "in_progress"])
    .order("created_at", { ascending: false })) as {
    data: RideRow[] | null;
    error: any;
  };

  if (error) {
    return (
      <main className="p-6 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>
        <div className="text-red-600 text-sm">Could not load rides.</div>
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
        <div className="text-sm text-gray-500">No active rides.</div>
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
              <div className="font-medium text-gray-900 leading-snug">
                {ride.pickup_location || "—"} ➜{" "}
                {ride.destination_location || "—"}
              </div>

              <span
                className={`text-[10px] font-semibold rounded px-2 py-1 h-fit ${badge(
                  ride.status
                )}`}
              >
                {ride.status || "—"}
              </span>
            </div>

            <div className="mt-2 text-gray-700 leading-snug">
              <div className="text-[13px]">
                {ride.passenger_count ?? "?"} pax{" • "}
                {ride.driver_id
                  ? `driver ${ride.driver_id.slice(0, 4)}…`
                  : "unassigned"}
              </div>

              <div className="text-[12px] text-gray-600 mt-1">
                Pickup: {ride.pickup_point || ride.pickup_location || "—"}
              </div>
              <div className="text-[12px] text-gray-600">
                Dropoff: {ride.dropoff_point || ride.destination_location || "—"}
              </div>
            </div>

            <div className="mt-3 text-[11px] text-gray-500 leading-tight">
              <div>
                Fare: ₱
                {ride.fare_amount !== null && ride.fare_amount !== undefined
                  ? ride.fare_amount
                  : "—"}
              </div>
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

import LiveTripsClient from "./LiveTripsClient";

export default function LiveTripsPage() {
  // All data is fetched client-side via /api/admin/livetrips/page-data
  return (
    <div className="h-[calc(100vh-64px)] px-3 py-2">
      <LiveTripsClient />
    </div>
  );
}

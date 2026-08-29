import LiveTripsClient from "./LiveTripsClient";
import AgrimarketDispatchGate from "./components/AgrimarketDispatchGate";

export default function LiveTripsPage() {
  // Existing Ride/Takeout/Errand data remains inside LiveTripsClient.
  // Agrimarket uses its separate road-route dispatcher above the legacy panel.
  return (
    <div className="flex h-[calc(100vh-64px)] flex-col gap-2 px-3 py-2">
      <AgrimarketDispatchGate />
      <div className="min-h-0 flex-1">
        <LiveTripsClient />
      </div>
    </div>
  );
}

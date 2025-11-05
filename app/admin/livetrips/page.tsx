import LiveDriverMap from "@/components/maps/LiveDriverMap";
import LiveSidebar from "@/components/sidebars/LiveSidebar";

const geofences = [
  // Replace with real GeoJSONs per town
  {
    name: "Lagawe",
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Lagawe" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [121.05,16.78],[121.10,16.78],[121.10,16.83],[121.05,16.83],[121.05,16.78]
              ]
            ]
          }
        }
      ]
    }
  }
];

export default function Page() {
  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 h-[calc(100vh-120px)]">
        <LiveDriverMap geofences={geofences} />
      </div>
      <div className="lg:col-span-1 h-[calc(100vh-120px)]">
        <LiveSidebar />
      </div>
    </div>
  );
}

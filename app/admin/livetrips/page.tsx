import LiveDriverMap, { Geofence } from "@/components/maps/LiveDriverMap";
import LiveSidebar from "@/components/sidebars/LiveSidebar";
import type { FeatureCollection, Feature, Polygon } from "geojson";

// Type the GeoJSON explicitly so "type" stays a literal and not widened to string.
const lagawePolygon: Feature<Polygon> = {
  type: "Feature",
  properties: { name: "Lagawe" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [121.05, 16.78],
        [121.1, 16.78],
        [121.1, 16.83],
        [121.05, 16.83],
        [121.05, 16.78],
      ],
    ],
  },
};

const lagaweFC: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: [lagawePolygon],
};

const geofences: Geofence[] = [
  {
    name: "Lagawe",
    geojson: lagaweFC,
  },
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

"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useMemo } from "react";

// Fix default marker icon paths in Next.js
// (prevents missing marker images)
const DefaultIcon = L.icon({
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

type Props = {
  center?: [number, number];
  zoom?: number;
  height?: number | string;
};

export default function LeafletMapInner({
  center = [14.5995, 120.9842], // example: Manila
  zoom = 12,
  height = 300,
}: Props) {
  const style = useMemo<React.CSSProperties>(() => ({ height }), [height]);

  return (
    <MapContainer center={center} zoom={zoom} style={style}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={center}>
        <Popup>Center</Popup>
      </Marker>
    </MapContainer>
  );
}



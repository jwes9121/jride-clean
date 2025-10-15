"use client";

import React from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  type MapContainerProps,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Default icon fix so markers show up in Next.js bundles
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

type Props = MapContainerProps & {
  markerAt?: LatLngExpression;
  showPopupText?: string;
};

export default function LeafletMap({
  markerAt,
  showPopupText = "Center",
  children,
  ...props
}: Props) {
  return (
    <MapContainer {...props}>
      {/* OSM tiles by default; swap to Mapbox if you like */}
      <TileLayer
        url={`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
      />
      {markerAt && (
        <Marker position={markerAt as [number, number]}>
          <Popup>{showPopupText}</Popup>
        </Marker>
      )}
      {children}
    </MapContainer>
  );
}

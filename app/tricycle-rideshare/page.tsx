import type { Metadata } from "next";
import MapClient from "../../components/MapClient"; // app/tricycle-rideshare -> ../../components

export const metadata: Metadata = { title: "Tricycle Rideshare · JRide" };

export default function RidesharePage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20" style={{ padding: "1rem" }}>
      <h1 className="text-xl mb-3">Tricycle Rideshare</h1>
      <MapClient />
    </div>
  );
}

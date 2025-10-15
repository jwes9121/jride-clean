import type { Metadata } from "next";
import MapClient from "../components/MapClient"; // app/request -> ../components

export const metadata: Metadata = { title: "Request · JRide" };

export default function RequestPage() {
  return (
    <div style={{ padding: "1rem" }}>
      <h1 className="text-xl mb-3">Request a Ride</h1>
      <MapClient />
    </div>
  );
}

"use client";

import React, { useState } from "react";
import LocationInput from "../../components/LocationInput";

export default function SimpleBookRide() {
  const [pickup, setPickup] = useState(null);   // { address, lat?, lng? }
  const [dropoff, setDropoff] = useState(null);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Book a Ride</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <LocationInput
            label="Pickup Location"
            value={pickup?.address || ""}
            onLocationSelect={(location) => setPickup(location)}
            placeholder="Where are you?"
            icon="ri-map-pin-line"
            iconColor="blue"
          />

          <LocationInput
            label="Dropoff Location"
            value={dropoff?.address || ""}
            onLocationSelect={(location) => setDropoff(location)}
            placeholder="Where to?"
            icon="ri-flag-2-line"
            iconColor="green"
          />
        </div>

        <div className="rounded border p-4 text-sm text-gray-600">
          <div className="mb-2 font-medium text-gray-800">Current selection</div>
          <div>Pickup: {pickup?.address || "-"}</div>
          <div>Dropoff: {dropoff?.address || "-"}</div>
        </div>
      </div>
    </div>
  );
}

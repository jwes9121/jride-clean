"use client";

import React, { useState } from "react";
import BottomNavigation from "@/components/BottomNavigation";

export default function DriverPage() {
  const [activeTab, setActiveTab] = useState("Driver");
  const town = "Kiangan";

  const NAV_TABS = [
    { key: "rides",    label: "Rides" },
    { key: "delivery", label: "Deliveries" },
    { key: "errands",  label: "Errands" },
    { key: "map",      label: "Map" },
    { key: "profile",  label: "Profile" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1 p-4 pb-16">
        <h1 className="text-xl font-semibold mb-4 text-gray-800">Driver Dashboard</h1>
        <p className="text-gray-600">
          View assigned trips, go online/offline, and track earnings.
        </p>
      </main>

      <BottomNavigation
        tabs={NAV_TABS}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        town={town}
      />
    </div>
  );
}



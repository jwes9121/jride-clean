"use client";
export default function AdminIndex() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Admin</h1>
      <ul className="list-disc pl-6">
        <li><a className="underline" href="/admin/towns">Manage Towns & Colors</a></li>
        <li><a className="underline" href="/admin/drivers">Manage Drivers (Online/Offline)</a></li>
        <li><a className="underline" href="/admin/audit">Audit Log</a></li>
      </ul>
    </div>
  );
}
import React, { useState } from "react";
import BottomNavigation, { TabItem } from "@/components/BottomNavigation";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("Admin");
  const town = "Lagawe";

  const tabs: TabItem[] = [
    { key: "rides",    label: "Rides" },
    { key: "delivery", label: "Deliveries" },
    { key: "errands",  label: "Errands" },
    { key: "map",      label: "Map" },
    { key: "profile",  label: "Profile" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1 p-4 pb-16">
        <h1 className="text-xl font-semibold mb-4 text-gray-800">Admin Dashboard</h1>
        <p className="text-gray-600">Manage trips, drivers, and deliveries for {town}.</p>
      </main>

      <BottomNavigation
        tabs={tabs}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        town={town}
      />
    </div>
  );
}



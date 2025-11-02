"use client";

import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Admin</h1>
      <ul className="list-disc pl-6">
        <li><Link className="underline" href="/admin/towns">Manage Towns & Colors</Link></li>
        <li><Link className="underline" href="/admin/drivers">Manage Drivers (Online/Offline)</Link></li>
        <li><Link className="underline" href="/admin/audit">Audit Log</Link></li>
      </ul>
    </div>
  );
}


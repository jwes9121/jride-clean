"use client";

export const dynamic = "force-dynamic";


import { useEffect, useState, useCallback } from "react";
import { AssignNearestButton } from "@/components/AssignNearestButton";

type Booking = {
 id: string;
 booking_code: string | null;
 status: string;
 assigned_driver_id: string | null;
 created_at: string;
 pickup_lat: number | null;
 pickup_lng: number | null;
};

type PendingResponse =
 | {
 ok: true;
 bookings: Booking[];
 }
 | {
 ok: false;
 error: string;
 message?: string;
 };

export default function AdminLiveTripsAssignPage() {
 const [bookings, setBookings] = useState<Booking[]>([]);
 const [loading, setLoading] = useState<boolean>(false);
 const [errorText, setErrorText] = useState<string | null>(null);
 const [lastReload, setLastReload] = useState<Date | null>(null);

 const loadPending = useCallback(async () => {
 setLoading(true);
 setErrorText(null);

 try {
 const res = await fetch("/api/admin/livetripss/pending", {
 method: "GET",
 cache: "no-store",
 });

 const data: PendingResponse = await res.json();

 if (!res.ok || !("ok" in data) || data.ok === false) {
 const msg =
 (data as any)?.message ??
 (data as any)?.error ??
 `Request failed with status ${res.status}`;
 setErrorText(`Failed to load pending bookings: ${msg}`);
 setBookings([]);
 return;
 }

 setBookings(data.bookings ?? []);
 setLastReload(new Date());
 } catch (err: any) {
 setErrorText(
 `Server error while fetching pending bookings: ${
 err?.message ?? "Unknown error"
 }`
 );
 setBookings([]);
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 loadPending();
 }, [loadPending]);

 const handleAfterAssign = useCallback(() => {
 // After assigning, refresh pending list
 loadPending();
 }, [loadPending]);

 return (
 <main className="p-4 md:p-6 lg:p-8">
 <div className="max-w-6xl mx-auto space-y-6">
 <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
 <div>
 <h1 className="text-xl md:text-2xl font-semibold">
 Admin - Live Trips (Pending & Assign)
 </h1>
 <p className="text-sm text-gray-600">
 View pending bookings and assign the nearest online driver using{" "}
 <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
 /api/rides/assign-nearest/latest
 </code>
 .
 </p>
 </div>

 <div className="flex items-center gap-3">
 <button
 type="button"
 onClick={loadPending}
 disabled={loading}
 className="px-3 py-2 rounded-md border text-sm font-medium
 disabled:opacity-60 disabled:cursor-not-allowed"
 >
 {loading ? "Refreshing..." : "Refresh Pending"}
 </button>

 <AssignNearestButton onAfterAction={handleAfterAssign} />
 </div>
 </header>

 {errorText && (
 <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-3 py-2">
 {errorText}
 </div>
 )}

 <section className="border rounded-lg overflow-hidden">
 <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
 <h2 className="text-sm font-medium">
 Pending Bookings (status = &apos;pending&apos; or &apos;searching&apos;,
 no assigned driver)
 </h2>
 <span className="text-xs text-gray-500">
 {lastReload
 ? `Last reload: ${lastReload.toLocaleTimeString()}`
 : "Not loaded yet"}
 </span>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-gray-100">
 <tr>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 #
 </th>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 Booking Code
 </th>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 Status
 </th>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 Assigned Driver
 </th>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 Created At
 </th>
 <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
 Pickup (Lat, Lng)
 </th>
 </tr>
 </thead>
 <tbody>
 {bookings.length === 0 && !loading && (
 <tr>
 <td
 colSpan={6}
 className="px-3 py-6 text-center text-xs text-gray-500"
 >
 No pending bookings found.
 </td>
 </tr>
 )}

 {loading && (
 <tr>
 <td
 colSpan={6}
 className="px-3 py-6 text-center text-xs text-gray-500"
 >
 Loading pending bookings...
 </td>
 </tr>
 )}

 {!loading &&
 bookings.map((b, index) => (
 <tr
 key={b.id}
 className="border-t last:border-b hover:bg-gray-50"
 >
 <td className="px-3 py-2 align-top text-xs text-gray-700">
 {index + 1}
 </td>
 <td className="px-3 py-2 align-top text-xs text-gray-800">
 {b.booking_code ?? b.id}
 </td>
 <td className="px-3 py-2 align-top text-xs text-gray-700">
 {b.status}
 </td>
 <td className="px-3 py-2 align-top text-xs text-gray-700">
 {b.assigned_driver_id ?? (
 <span className="text-gray-400 italic">
 none
 </span>
 )}
 </td>
 <td className="px-3 py-2 align-top text-xs text-gray-700">
 {new Date(b.created_at).toLocaleString()}
 </td>
 <td className="px-3 py-2 align-top text-xs text-gray-700">
 {b.pickup_lat != null && b.pickup_lng != null ? (
 <>
 {b.pickup_lat.toFixed(5)},{" "}
 {b.pickup_lng.toFixed(5)}
 </>
 ) : (
 <span className="text-gray-400 italic">
 n/a
 </span>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </section>

 <section className="border rounded-lg p-4 space-y-2">
 <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
 Notes
 </h3>
 <ul className="text-xs text-gray-600 list-disc pl-4 space-y-1">
 <li>
 This page only shows bookings with{" "}
 <code className="bg-gray-100 px-1 rounded">
 status IN (&apos;pending&apos;, &apos;searching&apos;)
 </code>{" "}
 and{" "}
 <code className="bg-gray-100 px-1 rounded">
 assigned_driver_id IS NULL
 </code>
 .
 </li>
 <li>
 The Assign Nearest button uses the Supabase function{" "}
 <code className="bg-gray-100 px-1 rounded">
 assign_nearest_driver_v2()
 </code>{" "}
 via the API route{" "}
 <code className="bg-gray-100 px-1 rounded">
 /api/rides/assign-nearest/latest
 </code>
 .
 </li>
 <li>
 After a successful assignment (or a no-assignment result), the
 pending table is automatically refreshed.
 </li>
 </ul>
 </section>
 </div>
 </main>
 );
}



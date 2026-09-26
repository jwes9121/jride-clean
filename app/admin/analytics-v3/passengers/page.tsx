"use client";

import * as React from "react";
import PassengerEvidence from "@/app/components/PassengerEvidence";
import type {
  PassengerActivity,
  PassengerIdentity,
  VerificationSubmissionLocation,
} from "@/lib/passenger/identity";

type ProfileResult = {
  profile: PassengerIdentity;
  can_view_evidence: boolean;
  can_view_verification_location: boolean;
  verification_location: VerificationSubmissionLocation | null;
  verification_location_error: string | null;
  activity: PassengerActivity[];
  activity_has_more: boolean;
  activity_error: string | null;
};

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function field(label: string, value: string | null) {
  return <div><dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-900">{value || "Not recorded"}</dd></div>;
}

function status(value: string) {
  const labels: Record<string, string> = { approved: "Approved", submitted: "Submitted", pending_admin: "Pending admin", rejected: "Declined", not_submitted: "Not submitted" };
  return labels[value] || value;
}

function locationStatus(value: string) {
  const labels: Record<string, string> = {
    captured: "Captured",
    denied: "Permission denied",
    unavailable: "Unavailable",
    timeout: "Timed out",
    error: "Capture error",
    not_provided: "Not provided",
  };
  return labels[value] || value;
}

function locationSource(value: string) {
  if (value === "browser_geolocation") return "Browser/device geolocation";
  if (value === "client_geolocation") return "Client geolocation";
  return value || "Not recorded";
}

export default function PassengerLookupPage() {
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<PassengerIdentity[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [detail, setDetail] = React.useState<ProfileResult | null>(null);
  const [error, setError] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const searchRequest = React.useRef<AbortController | null>(null);
  const profileRequest = React.useRef<AbortController | null>(null);

  const openProfile = React.useCallback(async (id: string) => {
    profileRequest.current?.abort();
    const controller = new AbortController();
    profileRequest.current = controller;
    setDetail(null);
    setError("");
    setOpening(true);
    try {
      const response = await fetch("/api/admin/analytics/v3/passengers?passenger_id=" + encodeURIComponent(id),
        { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Passenger profile could not be loaded.");
      if (!controller.signal.aborted) setDetail(data);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Passenger profile could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setOpening(false);
    }
  }, []);

  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("passenger_id");
    if (id) { setQuery(id); void openProfile(id); }
    return () => { searchRequest.current?.abort(); profileRequest.current?.abort(); };
  }, [openProfile]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    searchRequest.current?.abort();
    profileRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setOpening(false);
    setDetail(null);
    setRows(null);
    setError("");
    try {
      const response = await fetch("/api/admin/analytics/v3/passengers?q=" + encodeURIComponent(query.trim()),
        { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Passenger search failed.");
      if (!controller.signal.aborted) { setRows(data.rows); setHasMore(data.has_more); }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Passenger search failed.");
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  const p = detail?.profile;
  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 text-slate-900 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Passenger Lookup</h1>
        <p className="mt-1 text-sm text-slate-600">Find the account behind a name or booking. Display identity and approved verification identity are shown separately.</p>
      </div>
      <form onSubmit={search} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="passenger-search" className="text-sm font-semibold">Display name, verified name, phone, UUID, or exact booking/order code</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input id="passenger-search" value={query} onChange={(e) => setQuery(e.target.value)}
            minLength={2} maxLength={120} required autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Enter a name, phone number, UUID, or order code" />
          <button disabled={searching} className="rounded-lg bg-emerald-700 px-5 py-2 font-semibold text-white disabled:opacity-50">
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Names support partial matches. Phone searches accept 09, +63, or at least 4 digits. Booking and order codes match exactly.</p>
      </form>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {rows ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Search results">
          <p role="status" className="mb-3 text-sm">{rows.length ? rows.length + " matching accounts" : "No matching passengers found."}{hasMore ? " - More matches exist. Refine your search." : ""}</p>
          {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">Display name</th><th className="p-2">Verified full name</th><th className="p-2">Phone</th><th className="p-2">Town</th><th className="p-2">Verification</th><th className="p-2">Profile</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.user_id} className="border-t border-slate-100">
              <td className="p-2 font-semibold">{row.display_name || "Not recorded"}{row.identity_name_mismatch ? <span className="mt-1 block text-xs text-amber-800">Names differ</span> : null}</td>
              <td className="p-2">{row.verified_full_name || "Not recorded"}</td><td className="p-2">{row.phone || "Not recorded"}</td><td className="p-2">{row.town || "Not recorded"}</td><td className="p-2">{status(row.verification_status)}</td>
              <td className="p-2"><button type="button" onClick={() => openProfile(row.user_id)} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold" aria-label={"Open profile for " + (row.display_name || row.user_id)}>Open profile</button></td>
            </tr>)}</tbody>
          </table></div> : null}
        </section>
      ) : null}
      {opening ? <p role="status" className="rounded-lg bg-white p-4">Loading passenger profile...</p> : null}
      {p && detail ? (
        <section className="space-y-5" aria-label="Passenger profile">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-xl font-bold">Passenger Profile</h2>
            {p.identity_name_mismatch === true ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Identity name mismatch:</strong> the display name differs from the approved verification name. This flag alone does not establish misconduct.</p> : null}
            {p.identity_name_mismatch === null ? <p className="mt-3 text-sm text-slate-600">Name comparison is unavailable because a display or approved verification name is missing.</p> : null}
            {p.verification_record_conflict ? <p role="alert" className="mt-3 text-sm text-amber-900">Verification records disagree. The verification request is shown as the authoritative record; admin review is needed.</p> : null}
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-3 font-bold">Account identity</h3><dl className="grid gap-4 sm:grid-cols-2">
                {field("Current display name", p.display_name)}{field("Phone", p.phone)}
                {field("Account UUID", p.user_id)}{field("Account created (Manila)", date(p.account_created_at))}
                {field("Town", p.town)}{field("Barangay", p.barangay)}
              </dl></div>
              <div><h3 className="mb-3 font-bold">Verified identity</h3><dl className="grid gap-4 sm:grid-cols-2">
                {field("Verified full name", p.verified_full_name)}{field("Verification status", status(p.verification_status))}
                {field("Approved (Manila)", date(p.verified_at))}{field("Submitted (Manila)", date(p.verification_submitted_at))}
                {field("ID type", p.id_type)}{field("Record", p.verification_record_id)}
              </dl>
              <p className="mt-4 text-xs text-slate-500">{p.verification_source === "passenger_verifications" ? "Source: legacy verification record. " : p.verification_source ? "Source: verification request. " : "No verification record. "}The verified name is the name stored with the approved submission. It is not extracted from the ID image.</p></div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-bold">Verification submission location</h3>
            <p className="mt-1 text-xs text-slate-500">
              This is a review signal recorded when the verification request was submitted. Device geolocation can be spoofed, and network location can reflect a carrier gateway or VPN; neither is proof of physical presence.
            </p>
            {!detail.can_view_verification_location ? (
              <p className="mt-3 text-sm text-slate-600">Verification submission location is restricted to authorized admins.</p>
            ) : detail.verification_location_error ? (
              <p role="alert" className="mt-3 text-sm text-red-700">{detail.verification_location_error}</p>
            ) : detail.verification_location ? (() => {
              const l = detail.verification_location;
              const hasCoordinates = Number.isFinite(l.device_latitude) && Number.isFinite(l.device_longitude);
              const coordinates = hasCoordinates
                ? Number(l.device_latitude).toFixed(6) + ", " + Number(l.device_longitude).toFixed(6)
                : null;
              const network = [l.network_city, l.network_region, l.network_country].filter(Boolean).join(", ") || null;
              const mapUrl = hasCoordinates
                ? "https://www.openstreetmap.org/?mlat=" + encodeURIComponent(String(l.device_latitude)) +
                  "&mlon=" + encodeURIComponent(String(l.device_longitude)) +
                  "#map=17/" + encodeURIComponent(String(l.device_latitude)) + "/" + encodeURIComponent(String(l.device_longitude))
                : null;
              return (
                <div className="mt-4">
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {field("Capture result", locationStatus(l.device_status))}
                    {field("Device-reported coordinates", coordinates)}
                    {field("Accuracy", l.device_accuracy_m !== null ? Math.round(Number(l.device_accuracy_m)) + " m" : null)}
                    {field("Source", locationSource(l.device_source))}
                    {field("Device captured (Manila)", date(l.device_captured_at))}
                    {field("Server received (Manila)", date(l.server_received_at))}
                    {field("Declared town", l.declared_town)}
                    {field("Network location (coarse)", network)}
                  </dl>
                  {mapUrl ? (
                    <a href={mapUrl} target="_blank" rel="noreferrer noopener"
                      className="mt-4 inline-block rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
                      Open submitted location on map
                    </a>
                  ) : null}
                </div>
              );
            })() : (
              <p className="mt-3 text-sm text-slate-600">No submission-location snapshot is recorded for this verification request. Older verifications will normally show this until the passenger submits again.</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 font-bold">Verification evidence</h3>
            <PassengerEvidence key={p.user_id} passengerId={p.user_id} canView={detail.can_view_evidence} hasId={p.has_id_front} hasBack={p.has_id_back} hasSelfie={p.has_selfie} />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Recent activity</h3><button type="button" className="text-sm underline" onClick={() => openProfile(p.user_id)}>Refresh profile</button></div>
            <p className="mt-1 text-xs text-slate-500">Ride, Takeout, Errand and AgriMarket, ordered by last update. All dates are Manila time. Linked AgriMarket delivery bookings appear once.</p>
            {detail.activity_error ? <p role="alert" className="mt-3 text-sm text-red-700">{detail.activity_error}</p> : detail.activity.length ? (
              <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
                <thead><tr className="text-xs uppercase text-slate-500"><th className="p-2">Service</th><th className="p-2">Booking / order</th><th className="p-2">Status</th><th className="p-2">Route</th><th className="p-2">Created</th><th className="p-2">Last update</th></tr></thead>
                <tbody>{detail.activity.map((a) => <tr key={a.service + a.activity_id} className="border-t border-slate-100">
                  <td className="p-2">{a.service}</td><td className="p-2 font-semibold">{a.code}{a.booking_code && a.booking_code !== a.code ? <span className="block text-xs font-normal">{a.booking_code}</span> : null}</td>
                  <td className="p-2">{a.status || "Not recorded"}{a.cancel_reason ? <span className="mt-1 block max-w-xs text-xs text-slate-600">{a.cancel_reason}</span> : null}</td>
                  <td className="p-2">{[a.origin_label, a.destination_label].filter(Boolean).join(" to ") || "Not recorded"}</td>
                  <td className="p-2">{date(a.created_at)}</td><td className="p-2">{date(a.last_activity_at)}</td>
                </tr>)}</tbody>
              </table></div>
            ) : <p className="mt-3 text-sm text-slate-600">No linked activity found in these services.</p>}
            {detail.activity_has_more ? <p className="mt-3 text-xs text-slate-500">Showing the latest 50 activities.</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

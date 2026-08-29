"use client";

import Link from "next/link";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

const TOWNS = ["Lagawe", "Hingyon", "Kiangan", "Banaue", "Lamut"];

type Pin = { lat: number; lng: number };

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AgrimarketFarmerJoinPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [onboardingEnabled, setOnboardingEnabled] = useState(false);
  const [pin, setPin] = useState<Pin | null>(null);
  const [form, setForm] = useState({
    applicant_name: "", phone: "", town: "Lagawe", barangay: "", pickup_label: "",
    intended_products: "", identity_type: "", identity_reference_last4: "", applicant_note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<any>(null);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");

  useEffect(() => {
    fetch("/api/agrimarket/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setOnboardingEnabled(Boolean(payload?.onboarding_enabled)))
      .catch(() => setOnboardingEnabled(false));
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !mapboxgl.accessToken) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.1, 16.82],
      zoom: 9,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.on("click", (event: any) => setPin({ lat: event.lngLat.lat, lng: event.lngLat.lng }));
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!pin || !map) return;

    const existingMarker = markerRef.current;
    if (existingMarker) {
      existingMarker.setLngLat([pin.lng, pin.lat]).addTo(map);
      return;
    }

    const createdMarker = new mapboxgl.Marker({ draggable: true });
    createdMarker.on("dragend", () => {
      const point = createdMarker.getLngLat();
      setPin({ lat: point.lat, lng: point.lng });
    });
    createdMarker.setLngLat([pin.lng, pin.lat]).addTo(map);
    markerRef.current = createdMarker;
  }, [pin]);

  function useCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("This browser cannot read your current location. Tap the map to place the private pickup pin.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setPin(next);
        mapRef.current?.flyTo({ center: [next.lng, next.lat], zoom: 15 });
      },
      () => setError("Location could not be read. Tap the map to place the private pickup pin."),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function submitApplication(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitted(null);
    if (!pin) return setError("Place the exact private farm/home pickup pin first.");
    setSubmitting(true);
    const response = await fetch("/api/agrimarket/farmer-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...form, pickup_lat: pin.lat, pickup_lng: pin.lng }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to submit the farmer application.");
    } else {
      setSubmitted(payload.application);
      setLookupCode(payload.application?.application_code || "");
      setLookupPhone(form.phone);
    }
    setSubmitting(false);
  }

  async function lookupStatus(event: React.FormEvent) {
    event.preventDefault();
    setLookupError("");
    setLookupResult(null);
    const params = new URLSearchParams({ application_code: lookupCode.trim(), phone: lookupPhone.trim() });
    const response = await fetch(`/api/agrimarket/farmer-applications?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) setLookupError(payload?.message || payload?.error || "Application not found.");
    else setLookupResult(payload.application);
  }

  if (onboardingEnabled === false) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-3xl font-bold">Farmer applications are not open yet</h1>
          <p className="mt-3 text-slate-600">JRide can open farmer recruitment separately while the customer marketplace remains hidden.</p>
          <Link href="/" className="mt-6 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Back to JRide</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-3xl font-bold">Apply as a farmer / producer</h1>
          <p className="mt-3 max-w-3xl text-slate-600">Joining and product listing are free during launch. JRide currently takes 0% from the farmer's product price and there is no farmer wallet.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[["Joining fee","FREE"],["Listing fee","FREE"],["Farmer deduction","0%"]].map(([label,value]) => <div key={label} className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs uppercase text-emerald-700">{label}</p><strong className="text-xl text-emerald-900">{value}</strong></div>)}
          </div>
        </header>

        <form onSubmit={submitApplication} className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Farmer information</h2>
            <label className="mt-4 block text-sm font-semibold">Full name<input required value={form.applicant_name} onChange={(e) => setForm({ ...form, applicant_name: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" /></label>
            <label className="mt-4 block text-sm font-semibold">Mobile number<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="09XXXXXXXXX" /></label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Municipality<select value={form.town} onChange={(e) => setForm({ ...form, town: e.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3">{TOWNS.map((town) => <option key={town}>{town}</option>)}</select></label>
              <label className="text-sm font-semibold">Barangay<input value={form.barangay} onChange={(e) => setForm({ ...form, barangay: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" /></label>
            </div>
            <label className="mt-4 block text-sm font-semibold">Products you expect to sell<input required value={form.intended_products} onChange={(e) => setForm({ ...form, intended_products: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Tilapia, native chicken, vegetables" /><span className="mt-1 block text-xs font-normal text-slate-500">Separate several products with commas.</span></label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">ID type (optional)<input value={form.identity_type} onChange={(e) => setForm({ ...form, identity_type: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="National ID, driver's license, etc." /></label>
              <label className="text-sm font-semibold">Last 2-4 ID characters only<input maxLength={4} value={form.identity_reference_last4} onChange={(e) => setForm({ ...form, identity_reference_last4: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="1234" /></label>
            </div>
            <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Do not enter your full government ID number. Actual identity checking can be completed during JRide review.</p>
            <label className="mt-4 block text-sm font-semibold">Notes for JRide (optional)<textarea value={form.applicant_note} onChange={(e) => setForm({ ...form, applicant_note: e.target.value })} className="mt-2 min-h-24 w-full rounded-xl border px-3 py-3" maxLength={500} /></label>
          </section>

          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Private pickup location</h2>
            <p className="mt-2 text-sm text-slate-600">Pin the exact farm/home pickup point. Customers will never see this exact location. It is revealed only to the assigned driver after acceptance.</p>
            <label className="mt-4 block text-sm font-semibold">Pickup description<input required value={form.pickup_label} onChange={(e) => setForm({ ...form, pickup_label: e.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Farm gate / house landmark for the assigned driver" /></label>
            <div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={useCurrentLocation} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Use current location</button><span className="text-xs text-slate-500">or tap/drag the pin on the map</span></div>
            <div ref={mapContainerRef} className="mt-3 h-80 overflow-hidden rounded-2xl border bg-slate-100" />
            {!mapboxgl.accessToken ? <p className="mt-2 text-xs text-amber-800">Map is unavailable until the Mapbox token is configured.</p> : null}
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">{pin ? <>Private pin: <strong>{pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</strong></> : "No pickup pin selected yet."}</div>
            {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
            {submitted ? <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-emerald-950"><p className="font-bold">Application received</p><p className="mt-1 text-sm">Save this code: <strong>{submitted.application_code}</strong></p><p className="mt-1 text-sm">{submitted.status_message}</p></div> : null}
            <button type="submit" disabled={submitting || onboardingEnabled !== true} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">{submitting ? "Submitting..." : "Submit farmer application"}</button>
          </section>
        </form>

        <section className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Check application status</h2>
          <p className="mt-1 text-sm text-slate-600">Use the application code and the same mobile number used in the application.</p>
          <form onSubmit={lookupStatus} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input required value={lookupCode} onChange={(e) => setLookupCode(e.target.value)} className="rounded-xl border px-3 py-3" placeholder="AGAPP-..." />
            <input required value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} className="rounded-xl border px-3 py-3" placeholder="09XXXXXXXXX" />
            <button className="rounded-xl border bg-slate-900 px-5 py-3 font-semibold text-white">Check status</button>
          </form>
          {lookupError ? <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{lookupError}</div> : null}
          {lookupResult ? <div className="mt-3 rounded-xl bg-slate-50 p-4"><p className="font-bold">{titleCase(lookupResult.status)}</p><p className="mt-1 text-sm text-slate-600">{lookupResult.status_message}</p></div> : null}
        </section>
      </div>
    </main>
  );
}

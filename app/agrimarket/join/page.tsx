"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import FarmerPickupMap, { emptyFarmerPin } from "@/components/agrimarket/FarmerPickupMap";
import { FARMER_TOWN_CENTERS } from "@/lib/agrimarket/farmer-towns";
import { FarmerFeedback, FarmerWorkspace } from "../producer/FarmerWorkspace";
import styles from "../producer/farmer.module.css";

const blank = { applicant_name: "", phone: "", town: "Lagawe", barangay: "", pickup_label: "", intended_products: "", identity_type: "", identity_reference_last4: "", applicant_note: "", pickup_motorcycle_accessible: false, pickup_tricycle_accessible: false, pickup_roadside_handoff_required: false, pickup_driver_directions: "", submitted_by: "farmer", helper_name: "", farmer_consent: false, pin_confirmed: false };
type Status = { application_code: string; status: string; status_message: string };
const SAVED = "jride_farmer_application_reference_v2";

export default function AgrimarketFarmerJoinPage() {
  const [availability, setAvailability] = useState<"checking" | "open" | "closed">("checking");
  const [staffMode, setStaffMode] = useState(false);
  const [staffActor, setStaffActor] = useState("");
  const [form, setForm] = useState(blank);
  const [pin, setPin] = useState(emptyFarmerPin);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [application, setApplication] = useState<Status | null>(null);
  const [existingCode, setExistingCode] = useState("");
  const requestId = useRef("");
  const formTop = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    const assisted = new URLSearchParams(window.location.search).get("assist") === "staff";
    const endpoint = assisted ? "/api/agrimarket/farmer-applications?mode=staff" : "/api/agrimarket/status";
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (cancelled) return;
      if (assisted && response.ok && ["admin", "dispatcher"].includes(data.staff_role)) {
        setStaffMode(true); setStaffActor(data.staff_actor); setForm((current) => ({ ...current, submitted_by: "staff" })); setAvailability("open");
      } else setAvailability(!assisted && data.onboarding_enabled === true ? "open" : "closed");
    }).catch(() => { if (!cancelled) setAvailability("closed"); });
    try { const saved = JSON.parse(localStorage.getItem(SAVED) || "null"); if (saved) { setLookupCode(saved.code || ""); setLookupPhone(saved.phone || ""); } } catch {}
    return () => { cancelled = true; };
  }, []);

  function change<K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) { setForm((current) => ({ ...current, [key]: value })); }
  const validPin = pin.lat != null && pin.lng != null && !pin.resolving && pin.launch_eligible && pin.resolved_town === form.town;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!validPin || !form.pin_confirmed) { setError("Place and confirm the actual handoff point in the selected municipality."); return; }
    setBusy(true);
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const response = await fetch("/api/agrimarket/farmer-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, pickup_lat: pin.lat, pickup_lng: pin.lng, existing_application_code: existingCode || null, client_request_id: requestId.current }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Application could not be saved.");
      setApplication(data.application); setLookupCode(data.application.application_code); setLookupPhone(form.phone);
      try { localStorage.setItem(SAVED, JSON.stringify({ code: data.application.application_code, phone: form.phone })); } catch {}
      setExistingCode("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection interrupted. Your form is still here; please try again."); }
    finally { setBusy(false); }
  }

  async function lookup(event: FormEvent) {
    event.preventDefault(); setLookupError(""); setLookupBusy(true);
    try {
      const params = new URLSearchParams({ application_code: lookupCode.trim(), phone: lookupPhone.trim() });
      if (staffMode) params.set("mode", "staff");
      const response = await fetch(`/api/agrimarket/farmer-applications?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Application not found.");
      setApplication(data.application);
      if (data.correction) {
        const correction = data.correction;
        setForm({ ...blank, ...correction, intended_products: (correction.intended_products || []).join(", "), submitted_by: staffMode ? "staff" : "farmer", farmer_consent: false, pin_confirmed: false });
        setPin(emptyFarmerPin()); setExistingCode(data.application.application_code); requestId.current = "";
        formTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (reason) { setLookupError(reason instanceof Error ? reason.message : "Status is unavailable. Please try again."); }
    finally { setLookupBusy(false); }
  }

  return <FarmerWorkspace section="orders" guest>
    <div className={styles.productHeading}><div><span className={styles.eyebrow}>GROW WITH YOUR COMMUNITY</span><h1>Bring your farm to AgriMarket.</h1><p>Free listing. No farmer wallet. You receive your full product subtotal during the free launch period.</p></div></div>
    {availability !== "open" ? <section className={styles.emptyCard}><h2>{availability === "checking" ? "Checking applications…" : "Farmer applications are not open yet."}</h2><p>JRide is preparing farmer registration. Staff helping a farmer must sign in with their JRide staff account.</p><Link href="/agrimarket/producer" className={styles.primaryButton}>Existing farmer sign-in</Link></section> : <>
      {staffMode && <div className={styles.setupNotice}>Assisted application by {staffActor}. The farmer must consent. Administrator approval and readiness checks are separate.</div>}
      {application && <section className={styles.stepsCard} role="status"><h2>{application.status === "correction_requested" ? "A few details need attention." : "Your application"}</h2><p>{application.status_message}</p><p className="mt-3 break-all font-mono text-sm">{application.application_code}</p><p className="mt-2 text-xs">Keep this code private. Use it with your mobile number to check your application or make requested corrections. This browser remembers it when storage is available.</p><button type="button" className={`${styles.secondaryButton} mt-3`} onClick={async () => { try { await navigator.clipboard.writeText(application.application_code); } catch { setLookupError("Select and copy the application code above."); } }}>Copy application code</button>{application.status === "approved" && <Link href="/agrimarket/producer" className={`${styles.primaryButton} mt-3 ml-2`}>Farmer sign-in</Link>}</section>}
      <form ref={formTop} onSubmit={submit} className={`${styles.createPanel} mt-5`}>
        <h2>{existingCode ? "Correct your application" : "Your farmer application"}</h2>
        <fieldset className={styles.formSection}><legend><span>01</span> Farmer and helper</legend><div className={styles.formGrid}>
          <label>Farmer full name<input required minLength={2} maxLength={120} value={form.applicant_name} onChange={(event) => change("applicant_name", event.target.value)} /></label>
          <label>Farmer mobile number<input required type="tel" value={form.phone} readOnly={Boolean(existingCode)} onChange={(event) => change("phone", event.target.value)} placeholder="09XXXXXXXXX" /></label>
          <label>Who is completing this form?<select value={form.submitted_by} disabled={staffMode} onChange={(event) => change("submitted_by", event.target.value)}><option value="farmer">The farmer</option><option value="family">Family member</option><option value="representative">Farmer's representative</option>{staffMode && <option value="staff">Signed-in JRide staff</option>}</select></label>
          {["family", "representative"].includes(form.submitted_by) && <label>Helper name<input required minLength={2} maxLength={120} value={form.helper_name} onChange={(event) => change("helper_name", event.target.value)} /></label>}
          <label className={styles.fullWidth}>Products you expect to sell<input required value={form.intended_products} onChange={(event) => change("intended_products", event.target.value)} placeholder="Vegetables, rice, eggs…" /></label>
          <label>ID type (optional)<input maxLength={80} value={form.identity_type} onChange={(event) => change("identity_type", event.target.value)} /></label>
          <label>Last 2–4 ID characters only (optional)<input maxLength={4} pattern="[A-Za-z0-9]{2,4}" value={form.identity_reference_last4} onChange={(event) => change("identity_reference_last4", event.target.value)} /></label>
        </div></fieldset>
        <fieldset className={styles.formSection}><legend><span>02</span> Private pickup point</legend><div className={styles.formGrid}>
          <label>Municipality<select value={form.town} onChange={(event) => { change("town", event.target.value); change("barangay", ""); change("pin_confirmed", false); }}>{Object.keys(FARMER_TOWN_CENTERS).map((town) => <option key={town}>{town}</option>)}</select></label>
          <label>Barangay / local place<input maxLength={100} value={form.barangay} onChange={(event) => change("barangay", event.target.value)} /></label>
          <label className={styles.fullWidth}>Handoff point description<input required minLength={2} maxLength={180} value={form.pickup_label} onChange={(event) => change("pickup_label", event.target.value)} placeholder="Farm gate or agreed roadside pickup" /></label>
          <div className={styles.fullWidth}><FarmerPickupMap selectedTown={form.town} value={pin} onChange={(next) => { setPin(next); change("pin_confirmed", false); if (next.resolved_barangay) change("barangay", next.resolved_barangay); }} /></div>
          <label className={styles.checkLabel}><input type="checkbox" checked={form.pickup_motorcycle_accessible} onChange={(event) => change("pickup_motorcycle_accessible", event.target.checked)} /> A motorcycle can reach this pin</label>
          <label className={styles.checkLabel}><input type="checkbox" checked={form.pickup_tricycle_accessible} onChange={(event) => change("pickup_tricycle_accessible", event.target.checked)} /> A tricycle can reach and stop at this pin</label>
          <label className={`${styles.checkLabel} ${styles.fullWidth}`}><input type="checkbox" checked={form.pickup_roadside_handoff_required} onChange={(event) => change("pickup_roadside_handoff_required", event.target.checked)} /> We will meet the driver at this roadside handoff point</label>
          <label className={styles.fullWidth}>Private driver directions<textarea required minLength={5} maxLength={1000} value={form.pickup_driver_directions} onChange={(event) => change("pickup_driver_directions", event.target.value)} placeholder="Road access, landmark and where to stop. Customers will not see these directions." /></label>
          <label className={`${styles.checkLabel} ${styles.fullWidth}`}><input type="checkbox" required disabled={!validPin} checked={form.pin_confirmed} onChange={(event) => change("pin_confirmed", event.target.checked)} /> I confirm this is the actual handoff point for the selected vehicle access</label>
        </div></fieldset>
        <fieldset className={styles.formSection}><legend><span>03</span> Consent and review</legend><div className={styles.formGrid}>
          <label className={styles.fullWidth}>Notes for JRide (optional)<textarea maxLength={500} value={form.applicant_note} onChange={(event) => change("applicant_note", event.target.value)} /></label>
          <label className={`${styles.checkLabel} ${styles.fullWidth}`}><input required type="checkbox" checked={form.farmer_consent} onChange={(event) => change("farmer_consent", event.target.checked)} /> The farmer consents to this application, JRide's verification, and sharing private pickup details with the assigned driver when an order is accepted</label>
          <p className={`${styles.fullWidth} text-sm`}>An administrator reviews your application. Approval lets you set up products; a separate readiness check opens customer orders.</p>
        </div></fieldset>
        <FarmerFeedback error={error} /><button disabled={busy || !validPin} className={styles.primaryButton}>{busy ? "Saving application…" : existingCode ? "Send corrected application" : "Submit application"}</button>
      </form>
      <section className={`${styles.createPanel} mt-5`}><h2>Check or correct an application</h2><form onSubmit={lookup} className={`${styles.formGrid} mt-4`}>
        <label>Private application code<input required value={lookupCode} onChange={(event) => setLookupCode(event.target.value.toUpperCase())} autoCapitalize="characters" /></label>
        <label>Farmer mobile number<input required type="tel" value={lookupPhone} onChange={(event) => setLookupPhone(event.target.value)} /></label>
        <button disabled={lookupBusy} className={styles.secondaryButton}>{lookupBusy ? "Checking…" : "Check application"}</button>
      </form><FarmerFeedback error={lookupError} /></section>
    </>}
  </FarmerWorkspace>;
}

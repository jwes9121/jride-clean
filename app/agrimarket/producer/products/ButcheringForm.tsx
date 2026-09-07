"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { manilaDateTimeToIso } from "@/lib/agrimarket/schedule";
import styles from "../farmer.module.css";

type CutDraft = { id: string; name: string; price_per_kg: string; available_kg: string };
type Draft = { request_id: string; species: string; breed: string; description: string; butcher_start_at: string; butcher_end_at: string; order_cutoff_at: string; condition: string; vehicle_requirement: string; default_prep_minutes: string; is_active: boolean; cuts: CutDraft[] };
const cutDraft = (): CutDraft => ({ id: crypto.randomUUID(), name: "", price_per_kg: "", available_kg: "" });
const newDraft = (): Draft => ({ request_id: crypto.randomUUID(), species: "Pig", breed: "", description: "", butcher_start_at: "", butcher_end_at: "", order_cutoff_at: "", condition: "fresh", vehicle_requirement: "either", default_prep_minutes: "15", is_active: true, cuts: [cutDraft()] });

export function ButcheringForm({ accessCode, headers, onSaved, onClose }: { accessCode: string; headers: Record<string, string>; onSaved: (count: number) => Promise<void>; onClose: () => void }) {
  const key = `JRIDE_AGRIMARKET_BUTCHERING_DRAFT:${accessCode}`;
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved?.draft?.request_id && Array.isArray(saved.draft.cuts) && saved.draft.cuts.length <= 30) { setDraft(saved.draft); setAttempt(saved.attempt || null); }
    } catch { /* A malformed local draft can be replaced by a fresh form. */ }
    setLoaded(true); panel.current?.scrollIntoView({ block: "start" });
  }, [key]);
  useEffect(() => { if (loaded) { try { sessionStorage.setItem(key, JSON.stringify({ draft, attempt })); } catch { /* Submission reports an unavailable retry store before writing. */ } } }, [key, loaded, draft, attempt]);
  function updateCut(id: string, field: keyof CutDraft, value: string) { setDraft(current => ({ ...current, cuts: current.cuts.map(cut => cut.id === id ? { ...cut, [field]: value } : cut) })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const payload = attempt || { ...draft, butcher_start_at: manilaDateTimeToIso(draft.butcher_start_at), butcher_end_at: draft.butcher_end_at ? manilaDateTimeToIso(draft.butcher_end_at) : null, order_cutoff_at: manilaDateTimeToIso(draft.order_cutoff_at), cuts: draft.cuts.map(({ name, price_per_kg, available_kg }) => ({ name, price_per_kg, available_kg })) };
    try { sessionStorage.setItem(key, JSON.stringify({ draft, attempt: payload })); }
    catch { setError("This browser cannot keep the form for a safe retry. Allow site storage and try again."); return; }
    setAttempt(payload); setBusy(true);
    try {
      const response = await fetch("/api/agrimarket/producer/butchering", { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status === 400 || response.status === 413) setAttempt(null);
        throw new Error(result.message || "The schedule could not be confirmed. Retry to check what was saved.");
      }
      sessionStorage.removeItem(key);
      await onSaved(result.batch.product_ids.length);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection interrupted. Retry this saved request to avoid duplicate cuts."); }
    finally { setBusy(false); }
  }
  return <section ref={panel} className={styles.createPanel} aria-label="Scheduled butchering form">
    <div className={styles.sectionHeading}><div><h2>Butchering & meat cuts</h2><p>Set one schedule, then give each part its own price and expected kilos.</p></div><button type="button" disabled={busy} className={styles.quietButton} onClick={onClose}>Close</button></div>
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {attempt && !busy && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">This submission is saved for checking. Retry below to confirm it before changing any details.</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy || !!attempt || !loaded} className="disabled:opacity-70">
        <fieldset className={styles.formSection}><legend>01 Animal & schedule</legend><div className={styles.formGrid}>
          <label>Animal type<select value={draft.species} onChange={event => setDraft({ ...draft, species: event.target.value })}>{["Pig", "Goat", "Carabao", "Cattle", "Sheep"].map(species => <option key={species}>{species}</option>)}</select></label>
          <label>Breed (optional)<input maxLength={80} value={draft.breed} onChange={event => setDraft({ ...draft, breed: event.target.value })} /></label>
          <label>Butchering date & time<input required type="datetime-local" value={draft.butcher_start_at} onChange={event => setDraft({ ...draft, butcher_start_at: event.target.value })} /></label>
          <label>Expected finish (optional)<input type="datetime-local" min={draft.butcher_start_at || undefined} value={draft.butcher_end_at} onChange={event => setDraft({ ...draft, butcher_end_at: event.target.value })} /></label>
          <label>Accept reservations until<input required type="datetime-local" max={draft.butcher_start_at || undefined} value={draft.order_cutoff_at} onChange={event => setDraft({ ...draft, order_cutoff_at: event.target.value })} /></label>
          <p className={`${styles.fieldHint} self-center`}>All times are Philippine time. Reservations close before butchering starts. Confirm the actual meat and load before a driver is assigned.</p>
        </div></fieldset>
        <fieldset className={styles.formSection}><legend>02 Parts & prices</legend><p className="mb-4 text-sm text-slate-600">Add cuts such as belly, ribs, leg, shoulder or liver. Each cut is sold and reserved by kilo.</p>
          <div className="space-y-4">{draft.cuts.map((cut, index) => <fieldset key={cut.id} className="rounded-2xl border border-[#dfe5d7] bg-[#fafbf7] p-4">
            <legend className="px-2 text-sm font-semibold">Cut {index + 1}</legend><div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Part / meat cut<input aria-label={`Cut ${index + 1} name`} required minLength={2} maxLength={80} value={cut.name} placeholder="e.g. Belly / Liempo" onChange={event => updateCut(cut.id, "name", event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3" /></label>
              <label className="text-sm font-semibold">Price per kilo (PHP)<input aria-label={`Cut ${index + 1} price per kilo`} required type="number" min="0.01" max="999999.99" step="0.01" value={cut.price_per_kg} onChange={event => updateCut(cut.id, "price_per_kg", event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3" /></label>
              <label className="text-sm font-semibold">Expected available kilos<input aria-label={`Cut ${index + 1} available kilos`} required type="number" min="0.01" max="100000" step="0.01" value={cut.available_kg} onChange={event => updateCut(cut.id, "available_kg", event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3" /></label>
            </div><button type="button" aria-label={`Remove cut ${index + 1}`} disabled={draft.cuts.length === 1} className="mt-3 inline-flex items-center gap-2 px-2 py-2 text-sm text-red-800 disabled:opacity-40" onClick={() => setDraft({ ...draft, cuts: draft.cuts.filter(row => row.id !== cut.id) })}><Trash2 size={15} />Remove cut</button>
          </fieldset>)}</div>
          <button type="button" disabled={draft.cuts.length >= 30} className={`${styles.secondaryButton} mt-4`} onClick={() => setDraft({ ...draft, cuts: [...draft.cuts, cutDraft()] })}><Plus size={17} />Add another cut</button>
        </fieldset>
        <fieldset className={styles.formSection}><legend>03 Pickup details</legend><div className={styles.formGrid}>
          <label>Meat condition at pickup<select value={draft.condition} onChange={event => setDraft({ ...draft, condition: event.target.value })}><option value="fresh">Fresh</option><option value="chilled">Chilled</option></select></label>
          <label>Vehicle<select value={draft.vehicle_requirement} onChange={event => setDraft({ ...draft, vehicle_requirement: event.target.value })}><option value="either">Motorcycle or Tricycle</option><option value="motorcycle">Motorcycle</option><option value="tricycle">Tricycle</option></select></label>
          <label>Packing time once ready (minutes)<input required type="number" min="0" max="1440" step="1" value={draft.default_prep_minutes} onChange={event => setDraft({ ...draft, default_prep_minutes: event.target.value })} /></label>
          <label className={styles.fullWidth}>Description (optional)<textarea rows={3} maxLength={2000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          <label className={styles.checkLabel}><input type="checkbox" checked={draft.is_active} onChange={event => setDraft({ ...draft, is_active: event.target.checked })} />Open these cuts for reservations when your farm is accepting orders</label>
        </div><p className="mt-3 text-xs text-slate-600">Each cut gets its own product card. You can add photos, update stock or pause a cut there. Delivery eligibility is checked against the actual ordered load.</p></fieldset>
      </fieldset>
      <div className={styles.formActions}><button type="button" disabled={busy} onClick={onClose} className={styles.quietButton}>Save draft & close</button><button disabled={busy || !loaded} className={styles.primaryButton}>{busy ? "Saving schedule…" : attempt ? "Retry saved request" : "Save schedule & cuts"}</button></div>
    </form>
  </section>;
}

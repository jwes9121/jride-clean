"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION_LABELS, averageOnline, currentShift, duration, matchesMetric, phTime, type MetricKey, type ShiftAction, type ShiftReport, type ShiftSelection } from "@/lib/operations-shift-report";
import styles from "./shift-report.module.css";
import DriverOutreachPanel from "./DriverOutreachPanel";

const endpoint = "/api/admin/operations-schedule/shift-report";
const shiftLabel = (duty: string) => duty === "primary" ? "Primary 10 AM - 3 PM" : "Evening 3 PM - 7 PM";
const serviceLabel = (value: string) => value === "takeout" ? "Takeout" : value === "errand" ? "Errand" : "Ride";
const isTerminal = (value: string | null) => ["completed", "cancelled", "canceled"].includes((value || "").toLowerCase());

export default function ShiftReportPanel({ admin }: { admin: boolean }) {
  const [selected, setSelected] = useState<ShiftSelection | null>(admin ? currentShift() : null);
  const [catalog, setCatalog] = useState<ShiftSelection[]>([]);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [town, setTown] = useState("All towns");
  const [service, setService] = useState("All services");
  const [team, setTeam] = useState("");
  const [metric, setMetric] = useState<MetricKey>("all");
  const [draft, setDraft] = useState<{ action: ShiftAction; booking_id: string | null } | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const controller = useRef<AbortController | null>(null);
  const lastPresence = useRef(0);
  const loading = useRef(false);
  const mutating = useRef(false);
  const currentReport = useRef<ShiftReport | null>(null);
  const pending = useRef<{ key: string; request_id: string } | null>(null);
  const details = useRef<HTMLDivElement | null>(null);
  const editor = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (admin) return;
    const abort = new AbortController();
    async function loadCatalog() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(endpoint + "?mode=catalog", { cache: "no-store", signal: abort.signal });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.shifts)) throw new Error(body.error || "Your shifts could not be loaded.");
        if (abort.signal.aborted) return;
        setCatalog(body.shifts);
        setSelected(old => old || body.shifts.find((s: ShiftSelection) => s.day === currentShift().day && s.duty === currentShift().duty) || body.shifts[0] || null);
      } catch (error) {
        if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "Unable to load your shifts.");
      }
    }
    void loadCatalog();
    const interval = window.setInterval(loadCatalog, 60000);
    window.addEventListener("focus", loadCatalog);
    return () => { abort.abort(); clearInterval(interval); window.removeEventListener("focus", loadCatalog); };
  }, [admin]);

  const day = selected?.day || "";
  const duty = selected?.duty || "primary";
  const load = useCallback(async (forcePresence = false) => {
    if (!day || loading.current) return;
    loading.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 20000);
    const includePresence = forcePresence || Date.now() - lastPresence.current >= 60000;
    try {
      const response = await fetch(`${endpoint}?day=${day}&duty=${duty}&presence=${includePresence ? "1" : "0"}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (!response.ok || !body.window || !body.metrics) throw new Error(body.error || "The shift report is unavailable.");
      if (!mounted.current || controller.current !== abort) return;
      if (body.presence) lastPresence.current = Date.now();
      const prior = currentReport.current;
      const next: ShiftReport = { ...body, presence: body.presence || (prior?.day === day && prior?.duty === duty ? prior.presence : null) };
      currentReport.current = next; setReport(next); setLoadError("");
    } catch (error) {
      if (mounted.current && controller.current === abort) setLoadError(abort.signal.aborted ? "Refresh timed out. Displayed data may be stale; retry before taking action." : error instanceof Error ? error.message : "Refresh failed. Displayed data may be stale.");
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) { loading.current = false; controller.current = null; }
    }
  }, [day, duty]);

  useEffect(() => {
    setReport(null); currentReport.current = null; lastPresence.current = 0;
    setLoadError(""); setActionError(""); setMessage(""); setDraft(null); pending.current = null;
    void load(true);
    const refresh = () => { if (!mutating.current && document.visibilityState !== "hidden") void load(); };
    const interval = window.setInterval(() => {
      const value = currentReport.current;
      if (!value || value.live_watch || value.window.phase === "NOT STARTED" || value.window.phase === "LIVE") refresh();
    }, 15000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      const old = controller.current; controller.current = null; old?.abort(); loading.current = false;
      clearInterval(interval); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh);
    };
  }, [load]);
  useEffect(() => { if (draft) editor.current?.focus(); }, [draft]);

  async function perform(action: ShiftAction, bookingId: string | null = null, reason = "", receiver: string | null = null) {
    if (!report || mutating.current || loadError) return;
    const base = { day: report.day, duty: report.duty, version: report.run.version, action, booking_id: bookingId, note: reason.trim(), target: receiver };
    // Polling can advance the version after a lost response. Preserve the same
    // request ID for a retry of that intent so a saved contact cannot be doubled.
    const key = JSON.stringify({ day: base.day, duty: base.duty, action, bookingId, reason: base.note, receiver });
    if (!pending.current || pending.current.key !== key) pending.current = { key, request_id: crypto.randomUUID() };
    mutating.current = true; setBusy(true); setActionError(""); setMessage("");
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, request_id: pending.current.request_id }), signal: abort.signal });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) { const old = controller.current; controller.current = null; old?.abort(); loading.current = false; await load(true); } throw new Error(result.error || "This action could not be saved."); }
      if (!mounted.current) return;
      pending.current = null; setDraft(null); setNote(""); setTarget("");
      setMessage("Action saved with your identity and the actual server time. Trip status was not changed.");
      const old = controller.current; controller.current = null; old?.abort(); loading.current = false;
      await load(true);
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : "Save could not be confirmed. Retry the same action.");
    } finally { clearTimeout(timeout); mutating.current = false; if (mounted.current) setBusy(false); }
  }
  function openDraft(action: ShiftAction, bookingId: string | null = null) {
    setDraft({ action, booking_id: bookingId }); setNote(""); setTarget(""); setActionError(""); setMessage("");
  }
  const owner = (id: string | null | undefined) => !id ? "Not acknowledged / unassigned" : report?.employees.find(e => e.id === id)?.name || (id === "admin" || id.startsWith("admin:") ? "Admin" : id);
  const byTown = (value: { town: string | null; service_type: string }) => (town === "All towns" || (value.town || "Unknown") === town) && (service === "All services" || serviceLabel(value.service_type) === service);
  const facts = report?.metrics.bookings.filter(byTown) || [];
  const watched = report?.watch.filter(byTown) || [];
  const shownDrivers = report?.presence?.drivers.filter(d => !team || report.teams[d.driver_id] === team) || [];
  const currentMonitor = !!report && report.run.monitor_id === report.actor_id;
  const canAct = !!report && currentMonitor && !loadError && (report.window.phase === "LIVE" || (admin && report.live_watch && report.duty === "evening"));
  const canHandover = !!report && currentMonitor && report.live_watch && !loadError && (admin || report.day === new Date(Date.parse(report.server_time) + 8 * 3600000).toISOString().slice(0, 10));
  const canControl = !!report && !loadError && (report.window.phase === "LIVE" || (admin && report.live_watch && report.duty === "evening"));
  const selectedFactRows = facts.filter(f => matchesMetric(f, metric));
  const count = (key: MetricKey) => facts.filter(f => matchesMetric(f, key)).length;
  const stats: { key: MetricKey; label: string; value: string | number }[] = report ? [
    { key: "carry_in", label: "Carried in at start", value: report.window.full_history ? count("carry_in") : "Not recorded" },
    { key: "new", label: "New bookings", value: count("new") },
    { key: "completed", label: "Recorded completed", value: count("completed") },
    { key: "cancelled", label: "Recorded cancelled", value: report.window.full_history ? count("cancelled") : `Partial: ${count("cancelled")} known` },
    { key: "waiting", label: report.window.phase === "ENDED" ? "Unassigned at shift end" : "Unassigned at report cutoff", value: report.window.full_history ? count("waiting") : "Not recorded" },
    { key: "carry_out", label: report.window.phase === "ENDED" ? "Carried out at shift end" : "Open at report cutoff", value: report.window.full_history ? count("carry_out") : "Not recorded" },
  ] : [];

  return <section className={styles.root} aria-label="Shift report">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>JRide staff operations</span><h2>Shift Report</h2><p>Monitor each trip through its recorded outcome. Hand over unfinished trips explicitly.</p></div>
      <button type="button" disabled={busy} onClick={() => void load(true)}>Refresh report</button>
    </div>
    <div className={styles.controls}>
      {admin ? <>
        <label>Shift date<input type="date" min="2026-09-08" max={new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)} value={day} disabled={busy} onChange={e => { if (e.target.value) setSelected({ day: e.target.value, duty }); }} /></label>
        <label>Duty<select value={duty} disabled={busy} onChange={e => setSelected({ day, duty: e.target.value as "primary" | "evening" })}><option value="primary">Primary 10 AM - 3 PM</option><option value="evening">Evening 3 PM - 7 PM</option></select></label>
      </> : <label>Your assigned / covered shifts<select value={selected ? `${day}/${duty}` : ""} disabled={busy} onChange={e => { const [d, k] = e.target.value.split("/"); if (d) setSelected({ day: d, duty: k as "primary" | "evening" }); }}><option value="">Choose your shift</option>{catalog.map(s => <option key={`${s.day}/${s.duty}`} value={`${s.day}/${s.duty}`}>{s.day} / {shiftLabel(s.duty)}</option>)}</select></label>}
      <button type="button" disabled={busy} onClick={() => { const now = currentShift(); if (admin || catalog.some(s => s.day === now.day && s.duty === now.duty)) setSelected(now); else setActionError("You do not own the current shift. The assigned coordinator or Admin must arrange and accept coverage first."); }}>Open current shift</button>
    </div>
    <div aria-live="polite">{loadError && <p className={styles.error} role="alert">{loadError}</p>}{actionError && <p className={styles.error} role="alert">{actionError}</p>}{message && <p className={styles.success}>{message}</p>}</div>
    {!selected && !loadError && <p className={styles.notice}>No past/current assigned or covered shift was found. Your future schedules are unchanged. A requested temporary coverage will also appear here.</p>}
    {selected && !report && !loadError && <p className={styles.notice}>Loading this shift's records...</p>}
    {report && <>
      <div className={styles.panel}>
        <div className={styles.row}><h3>{report.day} / {shiftLabel(report.duty)}</h3><strong className={styles.badge}>{report.window.phase}</strong></div>
        <div className={styles.identityGrid}>
          <div><small>Scheduled owner</small><strong>{owner(report.run.scheduled_owner)}</strong></div>
          <div><small>Acknowledged monitor</small><strong>{owner(report.run.monitor_id)}</strong></div>
          <div><small>First acknowledgement</small><strong>{phTime(report.run.acknowledged_at)}</strong><small>{report.run.first_ack_id ? owner(report.run.first_ack_id) : "No acknowledgement recorded"}</small></div>
        </div>
        <p className={styles.muted}>{report.run.assignment_basis}. Updated {phTime(report.server_time)} PHT.</p>
        {report.live_watch && report.run.snapshot_at && report.run.current_saved_owner !== report.run.scheduled_owner && <p className={styles.notice}>The saved schedule now lists {owner(report.run.current_saved_owner)}. Recorded coverage is not rewritten; use requested and accepted coverage to change the active monitor.</p>}
        {report.run.cover_to && <p className={styles.notice}>Coverage requested from {owner(report.run.cover_to)}: {report.run.cover_reason}. {owner(report.run.monitor_id)} remains responsible until the replacement accepts.</p>}
        {report.window.phase === "ENDED" && <p className={styles.notice}>This scheduled shift has ended. Unfinished trips remain on the live watchlist when available. The next coordinator must acknowledge them; after 7 PM, contact Admin. There is no automatic extension of employee duty hours.</p>}
        <div className={styles.buttons}>
          {canControl && !report.run.monitor_id && !admin && report.run.scheduled_owner === report.actor_id && <button className={styles.primary} disabled={busy} onClick={() => void perform("start")}>Acknowledge shift now</button>}
          {canControl && admin && <button disabled={busy} onClick={() => openDraft("admin_takeover")}>Admin: take over with reason</button>}
          {report.window.phase === "LIVE" && (currentMonitor || admin) && <button disabled={busy || !!loadError} onClick={() => openDraft("request_cover")}>Request temporary coverage</button>}
          {report.window.phase === "LIVE" && (report.run.cover_to === report.actor_id || (admin && report.run.cover_to === "admin")) && <button className={styles.primary} disabled={busy || !!loadError} onClick={() => void perform("accept_cover")}>Accept coverage now</button>}
        </div>
      </div>

      {draft && <div ref={editor} tabIndex={-1} className={styles.editor}>
        <h3>{ACTION_LABELS[draft.action]}{draft.booking_id ? ` / ${report.watch.find(t => t.id === draft.booking_id)?.booking_code || draft.booking_id}` : ""}</h3>
        <form onSubmit={e => { e.preventDefault(); void perform(draft.action, draft.booking_id, note, draft.action === "request_cover" ? target : null); }}>
          {draft.action === "request_cover" && <label>Replacement<select required value={target} disabled={busy} onChange={e => setTarget(e.target.value)}><option value="">Choose replacement</option>{report.employees.filter(e => e.id !== report.actor_id && e.email).map(e => <option value={e.id} key={e.id}>{e.name}</option>)}<option value="admin">Admin</option></select></label>}
          <label>Reason / outcome (8-500 ASCII characters)<textarea required minLength={8} maxLength={500} rows={3} value={note} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="State the concern, what you did, and what still needs attention." /></label>
          <p className={styles.muted}>Saving a contact or escalation logs your action. It does not place a call or send a message. Contact the person first. Resolving an issue never marks the trip completed.</p>
          <div className={styles.buttons}><button className={styles.primary} disabled={busy || !!loadError || note.trim().length < 8 || (draft.action === "request_cover" && !target)}>Save action</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
        </form>
      </div>}

      <section className={styles.panel}>
        <div className={styles.row}><h3>Active-trip watchlist</h3><strong>{report.watch.length} total ({watched.length} shown) / {report.watch.filter(t => t.needs_ack || t.case?.handover_pending).length} need acknowledgement / {report.watch.filter(t => t.case?.issue_open).length} open issues</strong></div>
        <p>Watch trips from booking/assignment through completion or cancellation. A driver-offer expiry is not a cancelled trip. A long trip is not automatically a failure.</p>
        {!report.live_watch ? <p className={styles.notice}>This is a historical or not-yet-started shift. The booking details below show its recorded outcomes and carry-over where available. Open the current shift for live assistance.</p> : <>
          <p className={styles.muted}>Refreshes every 15 seconds while this tab is visible. GPS/push/background monitoring is not added by this tab. At a shift change, pending trips are shown again for the next monitor to acknowledge.</p>
          {!watched.length && <p className={styles.success}>No active trips or unresolved tracked issues match the selected filters.</p>}
          <div className={styles.watchGrid}>{watched.map(trip => <article className={`${styles.trip} ${trip.case?.issue_open ? styles.issue : trip.needs_ack || trip.case?.handover_pending ? styles.unacknowledged : ""}`} key={trip.id}>
            <div className={styles.row}><strong>{trip.booking_code}</strong><span className={styles.badge}>{trip.status || "Status not recorded"}</span></div>
            <p>{serviceLabel(trip.service_type)} / {trip.town || "Unknown town"} / <strong>{trip.driver_name}</strong></p>
            <p className={styles.muted}>Driver stage: {trip.driver_status || "Not recorded"}{trip.service_type === "takeout" ? ` / Vendor: ${trip.vendor_status || "Not recorded"}` : ""}</p>
            <p className={styles.muted}>Booked {phTime(trip.booked_at)}. Last observed state change: {phTime(trip.last_status_at)}.</p>
            {(trip.needs_ack || trip.case?.handover_pending) && <p className={styles.notice}>Monitoring / handover acknowledgement required.</p>}
            {trip.case?.handover_note && <p><strong>Handover:</strong> {trip.case.handover_note}</p>}
            {trip.case?.issue_open && <p className={styles.error}><strong>Open issue:</strong> {trip.case.issue_note}<br />Raised {phTime(trip.case.raised_at)} / Acknowledged {phTime(trip.case.issue_ack_at)}</p>}
            {trip.case?.last_reviewed_at && <p className={styles.muted}>Last recorded review/action: {phTime(trip.case.last_reviewed_at)}.</p>}
            <div className={styles.buttons}>
              {canAct && (trip.needs_ack || trip.case?.handover_pending) && <button className={styles.primary} disabled={busy} onClick={() => void perform("ack_trip", trip.id)}>Acknowledge monitoring</button>}
              {canAct && trip.case?.issue_open && !trip.case.issue_ack_at && <button disabled={busy} onClick={() => void perform("ack_issue", trip.id)}>Acknowledge issue</button>}
              {canAct && !isTerminal(trip.status) && <button disabled={busy} onClick={() => openDraft("flag_issue", trip.id)}>Raise issue</button>}
              {canAct && trip.driver_id && <button disabled={busy} onClick={() => openDraft("contact_driver", trip.id)}>Log driver contact</button>}
              {canAct && trip.service_type === "takeout" && <button disabled={busy} onClick={() => openDraft("contact_vendor", trip.id)}>Log vendor contact</button>}
              {canAct && <button disabled={busy} onClick={() => openDraft("escalate", trip.id)}>Log escalation to Admin</button>}
              {canAct && trip.case?.issue_open && <button disabled={busy} onClick={() => openDraft("resolve_issue", trip.id)}>Resolve issue</button>}
              {canHandover && <button disabled={busy} onClick={() => openDraft("handover", trip.id)}>Record handover</button>}
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(trip.booking_code); setMessage("Booking code copied. Search it in LiveTrips to assist the driver."); } catch { setActionError("Copy the booking code shown on this card."); } }}>Copy booking code</button>
            </div>
          </article>)}</div>
        </>}
      </section>

      <section className={styles.panel}>
        <h3>Operations during this shift</h3><p>These are system outcomes, not automatic credit or blame for the coordinator.</p>
        <div className={styles.controls}>
          <label>Booking / watchlist town<select value={town} onChange={e => setTown(e.target.value)}>{["All towns", "Lagawe", "Hingyon", "Banaue", "Lamut", "Unknown"].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Booking / watchlist service<select value={service} onChange={e => setService(e.target.value)}>{["All services", "Ride", "Takeout", "Errand"].map(t => <option key={t}>{t}</option>)}</select></label>
        </div>
        {!report.window.full_history && <p className={styles.notice}>Partial historical shift. Reliable status observations started {phTime(report.window.tracking_since)} PHT. Unknown cancellation totals and opening/closing states are not shown as zero.</p>}
        <div className={styles.stats}>{stats.map(item => <button key={item.key} className={metric === item.key ? styles.selected : ""} onClick={() => { setMetric(item.key); details.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}><strong>{item.value}</strong><span>{item.label}</span><small>View booking records</small></button>)}</div>
        <p className={styles.muted}>{report.metrics.basis} Exactly 3 PM belongs to Evening. Test identities and excluded bookings are removed. AgriMarket is not included in this first version.</p>
        <p className={styles.muted}>Recorded expired assignment offers (whole shift, not filtered): {report.metrics.offer_expiries}. Deleted booking records observed: {report.metrics.deleted_records}. Neither is silently counted as a cancellation.</p>
        <div ref={details}><div className={styles.row}><h4>Underlying booking records ({selectedFactRows.length})</h4><button onClick={() => setMetric("all")}>Show all shift records</button></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Booking / town</th><th>Service / driver</th><th>{report.window.full_history ? "State at cutoff" : "Current stored state (not historical)"}</th><th>Shift events</th><th>Cancellation reason</th></tr></thead><tbody>{selectedFactRows.map(b => <tr key={b.id}><td><strong>{b.booking_code}</strong><br />{b.town || "Unknown"}</td><td>{b.service}<br />{b.driver_name}</td><td>{b.status || "Not recorded"}</td><td>{b.is_new && <div>New: {phTime(b.booked_at)}</div>}{b.carry_in && <div>Carried in</div>}{b.completed_in_shift_at && <div>Completed: {phTime(b.completed_in_shift_at)}</div>}{b.cancelled_in_shift_at && <div>Cancelled: {phTime(b.cancelled_in_shift_at)}</div>}{b.carry_out && <div>Carried out / still open at cutoff</div>}{b.deleted_in_shift && <div>Record deleted</div>}</td><td>{b.cancelled_in_shift_at ? b.cancel_reason || "Reason not recorded" : "--"}</td></tr>)}</tbody></table></div>
          {!selectedFactRows.length && <p>No confirmed records for this selection. Check the data-quality notice above before interpreting a partial historical result.</p>}
        </div>
      </section>

      <section className={styles.panel}><h3>Driver coverage</h3>
        <p>Counts people separately from login sessions. Duration is limited to the shift and excludes overlapping security-check ineligible periods.</p>
        {!report.presence ? <p className={styles.notice}>Presence summary has not loaded. Refresh the report.</p> : <>
          <label>Driver team (current saved assignment, not historical ownership)<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All driver teams</option>{report.employees.map(e => <option key={e.id} value={e.id}>Team {e.name}</option>)}</select></label>
          <div className={styles.stats}>
            <div><strong>{team ? shownDrivers.length : report.presence.unique_drivers}</strong><span>Unique drivers with recorded presence</span></div>
            <div><strong>{duration(team ? shownDrivers.reduce((a, d) => a + Number(d.net_seconds), 0) : report.presence.net_seconds)}</strong><span>Net recorded online time</span></div>
            <div><strong>{averageOnline(team ? shownDrivers.reduce((a, d) => a + Number(d.net_seconds), 0) : report.presence.net_seconds, Number(report.presence.elapsed_seconds))}</strong><span>Average recorded online drivers</span></div>
            <div><strong>{team ? shownDrivers.reduce((a, d) => a + Number(d.session_starts), 0) : report.presence.session_starts}</strong><span>Session starts{team ? " for shown drivers" : " (not unique people)"}</span></div>
          </div>
          <p className={styles.muted}>Presence updated {phTime(report.presence.calculated_at)}. Refreshes at most once a minute automatically. {report.presence.basis} Online is not the same as available for dispatch.</p>
          <div className={styles.tableWrap}><table><thead><tr><th>Driver</th><th>Recorded town(s)</th><th>Raw online</th><th>Security excluded</th><th>Net online</th><th>Session starts</th><th>Boundary presence</th></tr></thead><tbody>{shownDrivers.map(d => <tr key={d.driver_id}><td>{d.name}</td><td>{d.town}</td><td>{duration(Number(d.raw_seconds))}</td><td>{duration(Number(d.excluded_seconds))}</td><td><strong>{duration(Number(d.net_seconds))}</strong></td><td>{d.session_starts}</td><td>{d.recorded_before_start ? "Recorded in minute before shift" : "No record in minute before shift"}</td></tr>)}</tbody></table></div>
          <h4>All-town coverage (not team-filtered)</h4><div className={styles.tableWrap}><table><thead><tr><th>Town</th><th>Unique recorded drivers</th><th>Net time</th><th>Average recorded online</th><th>Time without recorded eligible presence</th></tr></thead><tbody>{report.presence.towns.map(t => <tr key={t.town}><td>{t.town}</td><td>{t.unique_drivers}</td><td>{duration(Number(t.net_seconds))}</td><td>{Number(t.average_online).toFixed(1)}</td><td>{duration(Number(t.no_recorded_presence_seconds))}</td></tr>)}</tbody></table></div>
        </>}
      </section>

      <DriverOutreachPanel key={`${report.day}/${report.duty}`} report={report} canAct={canAct && report.window.phase === "LIVE"} onBusyChange={value => { mutating.current = value; setBusy(value); }} />

      <section className={styles.panel}><h3>Coordinator actions and handover</h3><p>Server-recorded actions are evidence of acknowledgement and follow-through, not proof of a phone conversation or continuous attention. No employee score is assigned.</p>
        {!report.actions.length && <p className={styles.notice}>No coordinator actions recorded for this shift. This does not prove that no assistance happened before action logging was introduced.</p>}
        <div className={styles.activity}>{report.actions.map(a => <article key={a.id}><div className={styles.row}><strong>{ACTION_LABELS[a.action] || a.action}</strong><span>{phTime(a.recorded_at)} PHT</span></div><p>{owner(a.actor_id)}{a.booking_id ? ` / ${report.metrics.bookings.find(b => b.id === a.booking_id)?.booking_code || report.watch.find(b => b.id === a.booking_id)?.booking_code || a.booking_id}` : ""}{a.target ? ` / Requested: ${owner(a.target)}` : ""}</p>{a.note && <p>{a.note}</p>}{a.details.monitor_before !== a.details.monitor_after && <p>Monitor: {owner(a.details.monitor_before)} -&gt; {owner(a.details.monitor_after)}</p>}{a.details.outside_shift && <p className={styles.notice}>Recorded outside scheduled shift hours. Not counted as activity within the shift window.</p>}<small>{a.details.evidence}</small></article>)}</div>
        <details><summary>Task completion / reopening records during the shift ({report.task_actions.length})</summary><p>These are the named employee's recorded task actions, not automatic credit for the shift monitor.</p>{report.task_actions.map(a => <p key={a.id}>{phTime(a.recorded_at)} / {a.actor} / {a.action.replaceAll("_", " ")} / {a.note}</p>)}</details>
      </section>
    </>}
  </section>;
}

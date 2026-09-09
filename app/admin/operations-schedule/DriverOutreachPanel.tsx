"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHANNELS, OUTCOMES, SIGNALS, contactPhone, outreachStats, type Candidate, type Outreach, type OutreachOutcome } from "@/lib/operations-shift-outreach";
import { phTime, type ShiftReport } from "@/lib/operations-shift-report";
import styles from "./shift-report.module.css";

const endpoint = "/api/admin/operations-schedule/shift-report/outreach";
export default function DriverOutreachPanel({ report, canAct, onBusyChange }: {
  report: ShiftReport; canAct: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const { day, duty } = report;
  const [data, setData] = useState<Outreach | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [channel, setChannel] = useState<keyof typeof CHANNELS>("call");
  const [outcome, setOutcome] = useState<OutreachOutcome>("no_answer");
  const [note, setNote] = useState("");
  const [town, setTown] = useState("");
  const [team, setTeam] = useState("");
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const saving = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const editor = useRef<HTMLDivElement | null>(null);
  const refresh = useCallback(async () => {
    if (active.current || saving.current) return;
    const abort = new AbortController(); active.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(`${endpoint}?day=${day}&duty=${duty}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.candidates) || !Array.isArray(body.contacts)) throw new Error(body.error || "Follow-up list could not be loaded.");
      if (mounted.current && active.current === abort) { setData(body); setError(""); }
    } catch (e) {
      if (mounted.current && active.current === abort) setError(abort.signal.aborted ? "Follow-up refresh timed out. Refresh before logging contact." : e instanceof Error ? e.message : "Follow-up refresh failed.");
    } finally { clearTimeout(timeout); if (active.current === abort) active.current = null; }
  }, [day, duty]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const poll = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(poll, 30000);
    window.addEventListener("focus", poll);
    return () => { mounted.current = false; active.current?.abort(); active.current = null; clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [refresh]);
  useEffect(() => { if (chosen) editor.current?.focus(); }, [chosen]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || saving.current || !canAct || error || !data?.live) return;
    const body = { day, duty, driver_id: chosen.driver_id, previous_contact_id: chosen.last_contact?.request_id || null, channel, outcome, note: note.trim() };
    const key = JSON.stringify(body);
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() };
    saving.current = true; setBusy(true); onBusyChange(true); setSaveError(""); setMessage("");
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, request_id: pending.current.id }), signal: abort.signal });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setChosen(null); throw new Error(result.error || "Contact could not be saved."); }
      if (mounted.current) { pending.current = null; setChosen(null); setNote(""); setMessage("Contact outcome recorded. Check the live list for any further follow-up."); }
    } catch (e) { if (mounted.current) setSaveError(e instanceof Error ? e.message : "Save could not be confirmed. Retry the same action."); }
    finally { clearTimeout(timeout); saving.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); await refresh(); } }
  }
  const owner = (id: string) => report.employees.find(e => e.id === id)?.name || (id.startsWith("admin:") ? "Admin" : id);
  const stats = data ? outreachStats(data.contacts) : null;
  const candidates = (data?.candidates || []).filter(d => (!town || d.town.toLowerCase() === town.toLowerCase()) && (!team || report.teams[d.driver_id] === team));
  const awaiting = candidates.filter(d => d.last_contact?.outcome !== "unavailable_today");
  const writable = canAct && !!data?.live && !error;
  return <section className={styles.panel} aria-label="Offline driver follow-up">
    <div className={styles.row}><h3>Offline driver follow-up</h3><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh follow-up list</button></div>
    <p>Prioritize active-trip assistance, then check driver availability. Stale status means the latest update is old; it does not prove the driver chose to stay offline.</p>
    <div aria-live="polite">{error && <p role="alert" className={styles.error}>{error}</p>}{saveError && <p role="alert" className={styles.error}>{saveError}</p>}{message && <p className={styles.success}>{message}</p>}</div>
    {!data && !error && <p>Loading follow-up records...</p>}
    {stats && <div className={styles.stats}>
      <div><strong>{stats.attempts}</strong><span>Recorded contact attempts</span></div>
      <div><strong>{stats.contacted}</strong><span>Unique drivers contacted</span></div>
      <div><strong>{stats.laterOnline}</strong><span>Recorded online later in this shift</span></div>
    </div>}
    {data && <>
      <p className={styles.muted}>All-shift contact totals. Updated {phTime(data.server_time)} PHT. Later online activity is recorded separately from the officer's contact report.</p>
      {!data.live ? <p className={styles.notice}>This shift is not live. Contact history is retained; a historical offline list is not reconstructed from today's driver status.</p> : <>
        {!writable && <p className={styles.notice}>The assigned officer must acknowledge this shift, or accept coverage, before recording outreach.</p>}
        <div className={styles.controls}>
          <label>Follow-up town<select value={town} onChange={e => setTown(e.target.value)}><option value="">All towns</option>{["Lagawe","Hingyon","Banaue","Lamut"].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Driver team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{report.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        </div>
        <p><strong>{awaiting.length}</strong> shown drivers to check / {candidates.length - awaiting.length} already reported unavailable today. Drivers currently online or on trips are excluded.</p>
        {chosen && <div className={styles.editor} ref={editor} tabIndex={-1}>
          <h4>Record contact with {chosen.name}</h4><p>Use this after your call, message or visit. Saving this form records the outcome.</p>
          <form onSubmit={save}>
            <div className={styles.controls}><label>Contact method<select value={channel} disabled={busy} onChange={e => setChannel(e.target.value as keyof typeof CHANNELS)}>{Object.entries(CHANNELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Outcome<select value={outcome} disabled={busy} onChange={e => setOutcome(e.target.value as OutreachOutcome)}>{Object.entries(OUTCOMES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
            <label>What happened?<textarea required minLength={8} maxLength={500} rows={3} value={note} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="For example: Called once; no answer. Will check again after assisting active trips." /></label>
            <div className={styles.buttons}><button className={styles.primary} disabled={busy || !writable}>Save contact outcome</button><button type="button" disabled={busy} onClick={() => setChosen(null)}>Cancel</button></div>
          </form>
        </div>}
        <div className={styles.tableWrap}><table><thead><tr><th>Driver</th><th>Availability evidence</th><th>Last contact today</th><th>Action</th></tr></thead><tbody>{candidates.map(d => {
          const phone = contactPhone(d.phone);
          return <tr key={d.driver_id}><td><strong>{d.name}</strong><div>{d.town}</div>{d.needs_wallet_help && <div>Wallet assistance may be needed</div>}</td><td>{SIGNALS[d.signal] || "Availability needs checking"}<div>Last update: {phTime(d.last_seen_at)}</div></td><td>{d.last_contact ? <>{OUTCOMES[d.last_contact.outcome]}<div>{owner(d.last_contact.actor_id)} / {phTime(d.last_contact.recorded_at)}</div><div>{d.last_contact.note}</div></> : "No contact recorded today"}</td><td>{d.last_contact?.outcome === "unavailable_today" ? "Skip reminders today" : <div className={styles.buttons}>{writable && phone && <a href={phone}>Call {d.phone}</a>}<button type="button" disabled={busy || !writable} onClick={() => { setChosen(d); setNote(""); setSaveError(""); setMessage(""); }}>Log contact</button></div>}</td></tr>;
        })}</tbody></table></div>
      </>}
      <details><summary>Contact history for this shift ({data.contacts.length})</summary><div className={styles.activity}>{data.contacts.map(c => <article key={c.request_id}>
        <strong>{c.driver_name} / {OUTCOMES[c.outcome]}</strong><p>{owner(c.actor_id)} / {CHANNELS[c.channel]} / {phTime(c.recorded_at)} PHT</p><p>{c.note}</p><small>{c.online_after_contact_at ? `Later online minute recorded: ${phTime(c.online_after_contact_at)} PHT` : "No later online minute recorded within this shift"}</small>
      </article>)}</div>{!data.contacts.length && <p>No contact outcomes recorded for this shift.</p>}</details>
    </>}
  </section>;
}

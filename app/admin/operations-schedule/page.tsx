"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AREAS, DUTIES, LAUNCH_DATE, eventBlocksDuty, eventsOn, addDays, getSlot, issues, localDate, monthDays, nextMonth, restCount, weekStart, type Actor, type Driver, type Duty, type Employee, type Schedule } from "@/lib/operations-schedule";
import { weeklyDutyCount, weeklyDutyTarget } from "@/lib/operations-schedule-guidance";
import styles from "./schedule.module.css";
import EventsPanel from "./EventsPanel";
import EmployeeLocationsPanel from "./EmployeeLocationsPanel";
import ShiftReportPanel from "./ShiftReportPanel";
import ContactsPanel from "./ContactsPanel";
import ToolsLinksPanel from "./ToolsLinksPanel";

type Event = { id: number; version: number; actor: string; action: string; note: string; day: string; duty: string; created_at: string; changes: { before: Schedule; after: Schedule } };
type Data = { onboarding?: boolean; version: number; state: Schedule; actor: Actor; approved: string[]; drivers: Driver[]; events: Event[]; serverTime: string };
type Recommendation = { employee: Employee; remaining: number; exception: boolean; reason: string };
const labels = { primary: "Core Primary", backup: "Core Backup", evening: "Evening Monitor" };
const times = { primary: "10:00 AM - 3:00 PM", backup: "10:00 AM - 3:00 PM", evening: "3:00 PM - 7:00 PM" };
const displayDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function OperationsSchedule() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState(() => localDate(new Date()).slice(0, 7) < "2026-09" ? "2026-09" : localDate(new Date()).slice(0, 7));
  const [week, setWeek] = useState(() => {
    const currentDay = localDate(new Date());
    const currentWeeks = Array.from(new Set(monthDays(currentDay.slice(0, 7)).map(weekStart)));
    const currentIndex = currentWeeks.indexOf(weekStart(currentDay));
    return currentIndex >= 0 ? currentIndex : 0;
  });
  const [tab, setTab] = useState("schedule");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ day: string; duty: Duty } | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [switchTarget, setSwitchTarget] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("");
  const [taskDraft, setTaskDraft] = useState({ title: "", instructions: "", employee: "", due: localDate(new Date()) });
  const [selectedTask, setSelectedTask] = useState("");
  const [chosenName, setChosenName] = useState("");
  const [oldEvents, setOldEvents] = useState<Event[]>([]);
  const [historyEnd, setHistoryEnd] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const requestCounter = useRef(0);
  const load = useCallback(async () => {
    const counter = ++requestCounter.current;
    try {
      const response = await fetch("/api/admin/operations-schedule", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Schedule could not be loaded.");
      if (counter === requestCounter.current) { setData(body); setError(""); }
    } catch (e) { if (counter === requestCounter.current) setError(e instanceof Error ? e.message : "Connection lost. Refresh to retry."); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 15000); window.addEventListener("focus", load); return () => { clearInterval(id); window.removeEventListener("focus", load); }; }, [load]);
  useEffect(() => { if (selection) editRef.current?.focus(); }, [selection]);
  async function act(action: string, extras: Record<string, unknown> = {}) {
    if (!data || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/operations-schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: data.version, note, ...extras }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) await load(); throw new Error(result.error); }
      setMessage("Saved to the shared schedule."); setSelection(null); setNote(""); setTarget(""); setSwitchTarget(""); setHandoffTarget(""); setOldEvents([]); setHistoryEnd(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed. Please refresh."); }
    finally { setBusy(false); }
  }
  async function moreHistory() {
    if (!data) return;
    const last = [...data.events, ...oldEvents].at(-1); if (!last) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/operations-schedule?before=${last.id}`, { cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setOldEvents([...oldEvents, ...result.events]); setHistoryEnd(result.events.length < 40);
    } catch (e) { setError(e instanceof Error ? e.message : "History could not be loaded."); }
    finally { setBusy(false); }
  }
  const s = data?.state;
  const admin = data?.actor.role === "admin";
  const me = s?.employees.find(e => e.email === data?.actor.email)?.id || (admin ? "admin:" + data?.actor.email : "");
  const ownerName = (id: string | null, state = s) => !id ? "Available" : state?.employees.find(e => e.id === id)?.name || (id.startsWith("admin:") ? "Admin" : "Former coordinator");
  const days = monthDays(month), weeks = Array.from(new Set(days.map(weekStart)));
  const start = weeks[Math.min(week, weeks.length - 1)] || "2026-09-07";
  const visibleDays = days.filter(d => weekStart(d) === start);
  const checks = s ? issues(s, month) : [];
  const monthSlots = s ? days.filter(d => d.startsWith(month)).flatMap(d => DUTIES.map(k => getSlot(s, d, k))) : [];
  const now = new Date(data?.serverTime || Date.now());
  const today = localDate(now);
  const currentWeekStart = weekStart(today);
  const isCurrentWeek = month === today.slice(0, 7) && start === currentWeekStart;
  const goCurrentWeek = () => {
    const currentMonth = today.slice(0, 7);
    const currentWeeks = Array.from(new Set(monthDays(currentMonth).map(weekStart)));
    setMonth(currentMonth);
    setWeek(Math.max(0, currentWeeks.indexOf(currentWeekStart)));
    setSelection(null);
    setSwitchTarget("");
    setHandoffTarget("");
  };
  const selectedSlot = s && selection ? getSlot(s, selection.day, selection.duty) : null;
  const availableSwitchSlots = s && selection && selectedSlot?.owner === me
    ? days
      .filter(day => day.startsWith(month) && day >= today)
      .flatMap(day => DUTIES.map(duty => ({ day, duty, slot: getSlot(s, day, duty) })))
      .filter(item => {
        if (item.day === selection.day && item.duty === selection.duty) return false;
        if (item.slot.owner) return false;
        const ended = new Date(`${item.day}T${item.duty === "evening" ? "19" : "15"}:00:00+08:00`) <= now;
        if (ended || s.rests[item.day] === me) return false;
        if (eventsOn(s, item.day).some(event => event.participants.includes(me) && eventBlocksDuty(event, item.duty))) return false;
        const sameDutyWeek = item.duty === selection.duty && weekStart(item.day) === weekStart(selection.day);
        const count = weeklyDutyCount(s, me, weekStart(item.day), item.duty) - (sameDutyWeek ? 1 : 0);
        return count < weeklyDutyTarget(s, me, weekStart(item.day), item.duty);
      })
    : [];
  const hoursAway = selection ? (new Date(`${selection.day}T${selection.duty === "evening" ? "15" : "10"}:00:00+08:00`).getTime() - now.getTime()) / 3600000 : 0;
  const activeEvents = data ? [...data.events, ...oldEvents].filter((e, i, a) => a.findIndex(x => x.id === e.id) === i) : [];
  const adminFillOptions = s && selection ? s.employees.map(employee => {
    const current = weeklyDutyCount(s, employee.id, weekStart(selection.day), selection.duty);
    const required = weeklyDutyTarget(s, employee.id, weekStart(selection.day), selection.duty);
    const onRest = s.rests[selection.day] === employee.id;
    const otherDuty: Duty = selection.duty === "primary" ? "evening" : "primary";
    const hasOtherShift = getSlot(s, selection.day, otherDuty).owner === employee.id;
    const conflicts = eventsOn(s, selection.day).some(event => event.participants.includes(employee.id) && eventBlocksDuty(event, selection.duty));
    const normalEligible = !onRest && !hasOtherShift && !conflicts && (current < required || (admin && selection.day === today));
    const exceptionEligible = admin && !onRest && !conflicts && !normalEligible;
    const status = onRest
      ? "rest day"
      : conflicts
        ? "event conflict"
        : hasOtherShift
          ? "already has the other shift"
          : current >= required
            ? (admin && selection.day === today) ? `target complete ${current}/${required} - correction allowed` : `target complete ${current}/${required}`
            : `${current}/${required} this week`;
    return { employee, current, required, eligible: normalEligible || exceptionEligible, exception: exceptionEligible, status };
  }) : [];
  const currentDayAdminCorrection = Boolean(admin && selection?.day === today);
  const adminFillNote = note.trim() || "Admin assigned unfilled schedule";
  const selectedAdminFill = adminFillOptions.find(item => item.employee.id === target);
  const adminExceptionNeedsReason = Boolean(selectedAdminFill?.exception);
  const recommendationsForWeek = (week: string) => {
    const plan = new Map<string, Recommendation>();
    if (!s || !s.employees.length) return plan;

    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    const countBy = new Map<string, Record<Duty, number>>();
    s.employees.forEach(employee => countBy.set(employee.id, { primary: 0, evening: 0 }));
    weekDays.forEach(day => DUTIES.forEach(duty => {
      const owner = getSlot(s, day, duty).owner;
      if (owner && countBy.has(owner)) countBy.get(owner)![duty] += 1;
    }));

    const slotKey = (day: string, duty: Duty) => `${day}/${duty}`;
    const preferredIndex = (day: string, duty: Duty) => {
      const dayOffset = Math.floor((new Date(day + "T00:00:00Z").getTime() - new Date(LAUNCH_DATE + "T00:00:00Z").getTime()) / 86400000);
      return ((dayOffset + DUTIES.indexOf(duty)) % s.employees.length + s.employees.length) % s.employees.length;
    };
    const projectedOwners = new Map<string, string>();
    const ownerAt = (day: string, duty: Duty) => projectedOwners.get(slotKey(day, duty)) || getSlot(s, day, duty).owner;
    const openSlots = weekDays
      .flatMap(day => DUTIES.map(duty => ({ day, duty })))
      .filter(({ day, duty }) => {
        if (getSlot(s, day, duty).owner) return false;
        const ended = new Date(`${day}T${duty === "evening" ? "19" : "15"}:00:00+08:00`).getTime() <= now.getTime();
        return !ended;
      });

    const normalCandidates = ({ day, duty }: { day: string; duty: Duty }) => {
      const otherDuty: Duty = duty === "primary" ? "evening" : "primary";
      return s.employees.map((employee, index) => {
        const count = countBy.get(employee.id)![duty];
        const targetCount = weeklyDutyTarget(s, employee.id, week, duty);
        const remaining = targetCount - count;
        const onRest = s.rests[day] === employee.id;
        const conflicts = eventsOn(s, day).some(event => event.participants.includes(employee.id) && eventBlocksDuty(event, duty));
        const hasOtherShift = ownerAt(day, otherDuty) === employee.id;
        const distance = (index - preferredIndex(day, duty) + s.employees.length) % s.employees.length;
        return { employee, remaining, onRest, conflicts, hasOtherShift, distance };
      }).filter(item => item.remaining > 0 && !item.onRest && !item.conflicts && !item.hasOtherShift)
        .sort((a, b) => a.distance - b.distance || b.remaining - a.remaining);
    };

    const orderedSlots = openSlots.slice().sort((a, b) =>
      normalCandidates(a).length - normalCandidates(b).length ||
      a.day.localeCompare(b.day) ||
      DUTIES.indexOf(a.duty) - DUTIES.indexOf(b.duty)
    );
    let best: { assigned: number; score: number; assignments: Map<string, Recommendation> } = { assigned: -1, score: Number.POSITIVE_INFINITY, assignments: new Map() };
    let explored = 0;
    const search = (index: number, score: number, assignments: Map<string, Recommendation>) => {
      explored += 1;
      if (explored > 250000) return;
      if (best.assigned === orderedSlots.length && score >= best.score) return;
      if (assignments.size + orderedSlots.length - index < best.assigned) return;
      if (index >= orderedSlots.length) {
        if (assignments.size > best.assigned || assignments.size === best.assigned && score < best.score) {
          best = { assigned: assignments.size, score, assignments: new Map(assignments) };
        }
        return;
      }

      const slot = orderedSlots[index];
      const candidates = normalCandidates(slot);
      for (const candidate of candidates) {
        const count = countBy.get(candidate.employee.id)!;
        count[slot.duty] += 1;
        projectedOwners.set(slotKey(slot.day, slot.duty), candidate.employee.id);
        const nextAssignments = new Map(assignments);
        nextAssignments.set(slotKey(slot.day, slot.duty), {
          employee: candidate.employee,
          remaining: Math.max(0, candidate.remaining - 1),
          exception: false,
          reason: "",
        });
        search(index + 1, score + candidate.distance, nextAssignments);
        projectedOwners.delete(slotKey(slot.day, slot.duty));
        count[slot.duty] -= 1;
      }
      search(index + 1, score + 1000, assignments);
    };
    search(0, 0, new Map());

    const projectedCounts = new Map<string, Record<Duty, number>>();
    s.employees.forEach(employee => projectedCounts.set(employee.id, { ...countBy.get(employee.id)! }));
    const projectedFromBest = new Map<string, string>();
    best.assignments.forEach((recommendation, key) => {
      projectedFromBest.set(key, recommendation.employee.id);
      projectedCounts.get(recommendation.employee.id)![key.endsWith("/evening") ? "evening" : "primary"] += 1;
      plan.set(key, recommendation);
    });
    const ownerAfterPlan = (day: string, duty: Duty) => projectedFromBest.get(slotKey(day, duty)) || getSlot(s, day, duty).owner;

    for (const slot of openSlots.sort((a, b) => a.day.localeCompare(b.day) || DUTIES.indexOf(a.duty) - DUTIES.indexOf(b.duty))) {
      const key = slotKey(slot.day, slot.duty);
      if (plan.has(key)) continue;
      const otherDuty: Duty = slot.duty === "primary" ? "evening" : "primary";
      const candidates = s.employees.map((employee, index) => {
        const count = projectedCounts.get(employee.id)![slot.duty];
        const targetCount = weeklyDutyTarget(s, employee.id, week, slot.duty);
        const remaining = targetCount - count;
        const onRest = s.rests[slot.day] === employee.id;
        const conflicts = eventsOn(s, slot.day).some(event => event.participants.includes(employee.id) && eventBlocksDuty(event, slot.duty));
        const hasOtherShift = ownerAfterPlan(slot.day, otherDuty) === employee.id;
        const distance = (index - preferredIndex(slot.day, slot.duty) + s.employees.length) % s.employees.length;
        return { employee, remaining, onRest, conflicts, hasOtherShift, distance };
      });
      const regular = candidates
        .filter(item => item.remaining > 0 && !item.onRest && !item.conflicts && !item.hasOtherShift)
        .sort((a, b) => a.distance - b.distance || b.remaining - a.remaining)[0];
      const choice = regular || candidates
        .filter(item => !item.onRest && !item.conflicts)
        .sort((a, b) => Number(b.remaining > 0) - Number(a.remaining > 0) || Number(a.hasOtherShift) - Number(b.hasOtherShift) || a.distance - b.distance || b.remaining - a.remaining)[0];
      if (!choice) continue;
      const reasons = [
        choice.hasOtherShift ? `already has ${labels[otherDuty]}` : "",
        choice.remaining <= 0 ? `weekly ${labels[slot.duty]} target met` : "",
      ].filter(Boolean);
      plan.set(key, {
        employee: choice.employee,
        remaining: Math.max(0, choice.remaining - 1),
        exception: !regular,
        reason: reasons.join("; ") || "no regular target slot",
      });
      projectedCounts.get(choice.employee.id)![slot.duty] += 1;
      projectedFromBest.set(key, choice.employee.id);
    }
    return plan;
  };
  const recommendationPlan = s ? recommendationsForWeek(start) : new Map<string, Recommendation>();
  const weekGuidance = s
    ? s.employees.filter(employee => admin || employee.id === me).map(employee => {
      const needs = DUTIES.map(duty => {
        const count = weeklyDutyCount(s, employee.id, start, duty);
        const targetCount = weeklyDutyTarget(s, employee.id, start, duty);
        return { duty, remaining: Math.max(0, targetCount - count) };
      }).filter(item => item.remaining > 0);
      return { employee, needs };
    })
    : [];

  return <main className={styles.root}>
    <header className={styles.header}><div><a href="/admin/control-center" className={styles.brand}>JRide <span>STAFF OPERATIONS</span></a><h1>Operations Schedule</h1><p>Plan ahead. Know who is responsible.</p></div><div className={styles.identity}>{data ? <><strong>{data.actor.name || data.actor.email}</strong><span>{admin ? "Admin" : ownerName(me)}</span></> : "Staff access"}<a href="/admin/control-center">Control center</a></div></header>
    <div className={styles.shell}>
      <div aria-live="polite">{error && <div role="alert" className={styles.error}>{error} <button onClick={load}>Retry</button></div>}{message && <div className={styles.success}>{message}</div>}</div>
      {!data ? <section className={styles.panel}><h2>{error ? "Schedule unavailable" : "Loading the shared schedule..."}</h2><p>Use your approved JRide staff account.</p><a href="/staff/login?callbackUrl=%2Fadmin%2Foperations-schedule">Staff sign-in</a></section> : data.onboarding ? <section className={styles.panel}><h2>Welcome! Which coordinator are you?</h2><p>Signed in as {data.actor.email}. Choose your own name once. It will be saved to this Google account and this selection will disappear.</p><form onSubmit={e => { e.preventDefault(); act("identify", { employee: chosenName }); }}><label htmlFor="first-login-name">Your name</label><select id="first-login-name" required value={chosenName} onChange={e => setChosenName(e.target.value)}><option value="">Choose your name</option>{data.state.employees.map(e => <option key={e.id} value={e.id}>{e.name} / {e.area}</option>)}</select><p>This choice cannot be edited after saving. A name already claimed by another account will not appear.</p>{!data.state.employees.length && <p>All names are linked. Contact Admin to resolve your account access.</p>}<button type="submit" className={styles.primary} disabled={busy || !chosenName}>Save my name permanently</button></form></section> : <>
        <nav className={styles.tabs} aria-label="Operations views">{["schedule", "shift-report", "tasks", "contacts", "tools", "events", "teams", ...(admin ? ["locations"] : []), "history"].map(t => <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => { setTab(t); setSelection(null); setSelectedTask(""); setNote(""); }}>{t === "shift-report" ? "Shift Report" : t === "tasks" ? `Tasks (${Object.values(s?.tasks || {}).filter(t => t.status === "open").length})` : t === "contacts" ? "Contacts" : t === "tools" ? "Tools & Links" : t === "events" ? "Events" : t === "teams" ? "Driver teams" : t === "locations" ? "Employee locations" : t === "setup" ? "Coordinator setup" : t === "history" ? "Assignment history" : "Schedule"}</button>)}</nav>
        {tab === "shift-report" && <ShiftReportPanel admin={!!admin} />}
        {tab === "schedule" && s && <>
          <section className={styles.toolbar}><div><label htmlFor="planning-month">Planning month</label><input id="planning-month" type="month" min="2026-09" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setMonth(e.target.value); setWeek(0); setSelection(null); } }} /><span className={styles.badge}>{s.months[month] === undefined ? "Not opened" : s.months[month] ? "Finalized" : "Planning"}</span></div><div className={styles.actions}><button onClick={async () => { try { await navigator.clipboard.writeText(window.location.origin + "/admin/operations-schedule"); setMessage("Schedule link copied. Employees use their approved Google account."); } catch { setError("Copy the page address from your browser to share it."); } }}>Copy schedule link</button><button onClick={load} disabled={busy}>Refresh</button>{admin && <button className={styles.primary} disabled={busy || (s.months[month] !== undefined && checks.length > 0)} onClick={() => act(s.months[month] === undefined ? "open_month" : "publish", { month })}>{s.months[month] === undefined ? "Open planning" : "Finalize month"}</button>}</div></section>
          <section className={styles.stats}><div><strong>{monthSlots.filter(x => x.owner).length}<small> / {monthSlots.length}</small></strong><span>Duties claimed</span></div><div><strong>{monthSlots.filter(x => !x.owner).length}</strong><span>Available to grab / bawi</span></div><div><strong>{monthSlots.filter(x => x.coverage).length}</strong><span>Coverage requests</span></div><div><strong>2 <small>per week</small></strong><span>Rest days per coordinator</span></div></section>
          {admin && <section className={styles.panel}><h2>Coordinator choices / {month}</h2><p>Current saved choices from all employees. Updates every 15 seconds.</p><div className={styles.teamGrid}>{s.employees.map(e => { const restDates = Object.entries(s.rests).filter(([d, id]) => id === e.id && d.startsWith(month)).map(([d]) => d).sort(); const assignments = Object.entries(s.slots).filter(([k, slot]) => k.startsWith(month) && slot.owner === e.id && DUTIES.some(d => k.endsWith("/" + d))).sort(([a], [b]) => a.localeCompare(b)); return <article key={e.id}><h3>{e.name}</h3><p>{e.area}</p><p>{e.email || "Has not chosen their name yet"}</p><strong>Rest days: {restDates.length}{month === "2026-09" ? " / 7" : ""}</strong><p>{restDates.length ? restDates.map(displayDay).join(", ") : "No rest dates chosen yet"}</p><p>{DUTIES.map(d => labels[d] + ": " + assignments.filter(([k]) => k.endsWith("/" + d)).length).join(" / ")}</p><p>Open tasks: {Object.values(s.tasks || {}).filter(t => t.employee === e.id && t.status === "open").length}</p><details><summary>View chosen duties ({assignments.length})</summary><ul>{assignments.map(([k, slot]) => <li key={k}>{displayDay(k.split("/")[0])}: {labels[k.split("/")[1] as keyof typeof labels] || k.split("/")[1]}{slot.coverage ? " - coverage requested" : ""}</li>)}</ul></details></article>; })}</div></section>}
          {!s.employees.length && <div className={styles.notice}>Admin: set up the three coordinators before employees begin planning.</div>}
          <div className={styles.notice}>Required monitoring is now Primary 10:00 AM - 3:00 PM and Evening 3:00 PM - 7:00 PM. Backup is no longer a regular weekly duty. Each coordinator chooses exactly two designated rest days per week; a day without an assigned duty is off-duty, not an additional rest-day selection.</div>
          <section className={styles.weekbar}><div className={styles.weekNav}><button disabled={week === 0} onClick={() => { setWeek(week - 1); setSelection(null); }}>Previous week</button><button className={isCurrentWeek ? styles.currentWeek : ""} disabled={isCurrentWeek} onClick={goCurrentWeek}>Current week</button></div><h2>{displayDay(visibleDays[0] || start)} - {displayDay(addDays(start, 6))}</h2><button disabled={week >= weeks.length - 1} onClick={() => { setWeek(week + 1); setSelection(null); }}>Next week</button></section>
          <section className={styles.restTotals}>{s.employees.map(e => <div key={e.id}><strong>{e.name}</strong><span>{restCount(s, e.id, start)}/2 rest days</span><small>{e.area}</small></div>)}</section>
          <section className={styles.restTotals}>{weekGuidance.map(item => <div key={item.employee.id}><strong>{item.employee.name}</strong><span>{item.needs.length ? "Needs another schedule" : "Weekly targets met"}</span><small>{item.needs.length ? item.needs.map(need => `${labels[need.duty]}: ${need.remaining} more`).join(" / ") : "No additional duty needed this week"}</small></div>)}</section>
          <div className={styles.notice}>Recommendations are planned as one weekly rotation. They honor saved duties first, then balance the remaining open slots against each employee&apos;s weekly targets.</div>
          {selection && selectedSlot && <div className={styles.editor} ref={editRef} tabIndex={-1}><div className={styles.editorTitle}><h2>{displayDay(selection.day)} / {labels[selection.duty]}</h2><button onClick={() => setSelection(null)}>Close</button></div><p>{times[selection.duty]} - Current owner: <strong>{ownerName(selectedSlot.owner)}</strong></p>
            {selectedSlot.coverage && <p className={styles.warning}>Coverage requested. {ownerName(selectedSlot.owner)} remains responsible until someone accepts.</p>}
            <label htmlFor="change-note">Reason for change (required when switching, transferring a duty, requesting coverage, or using Admin override)</label><input id="change-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Example: Schedule swap; covering this shift" />
            <div className={styles.actions}>{!selectedSlot.owner && !admin && <button className={styles.primary} disabled={busy} onClick={() => act("claim", selection)}>Grab this duty / bawi</button>}{selectedSlot.coverage && selectedSlot.owner !== me && <button className={styles.primary} disabled={busy} onClick={() => act("accept", selection)}>Accept coverage</button>}{selectedSlot.owner === me && <><div className={styles.swap}><label htmlFor="switch-slot">Change this duty to another available slot</label><select id="switch-slot" value={switchTarget} onChange={e => setSwitchTarget(e.target.value)}><option value="">Choose an available slot</option>{availableSwitchSlots.map(item => <option key={`${item.day}|${item.duty}`} value={`${item.day}|${item.duty}`}>{displayDay(item.day)} / {labels[item.duty]} / Available</option>)}</select><button className={styles.primary} disabled={busy || !switchTarget || !note.trim()} onClick={() => { const [targetDay, targetDuty] = switchTarget.split("|"); if (targetDay && targetDuty) act("switch", { day: selection.day, duty: selection.duty, targetDay, targetDuty }); }}>Change schedule</button><small>The current duty becomes available only when the replacement is saved successfully.</small></div><div className={styles.swap}><label htmlFor="handoff-target">Transfer this duty directly to a coworker</label><select id="handoff-target" value={handoffTarget} onChange={e => setHandoffTarget(e.target.value)}><option value="">Choose coworker</option>{s.employees.filter(employee => employee.id !== me).map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button className={styles.primary} disabled={busy || !handoffTarget || note.trim().length < 8} onClick={() => act("handoff", { ...selection, targetEmployee: handoffTarget })}>Transfer duty</button><small>Use this for a same-day change. The coworker becomes responsible immediately, and your reason is saved in the schedule history.</small></div>{hoursAway > 24 && <button disabled={busy} onClick={() => act("release", selection)}>Release to available slots</button>}<button disabled={busy || (!selectedSlot.coverage && !note.trim())} onClick={() => act(selectedSlot.coverage ? "cancel_coverage" : "coverage", selection)}>{selectedSlot.coverage ? "Cancel coverage request" : "Request coverage"}</button></>}</div>
            {selectedSlot.owner === me && <p>Release is allowed more than 24 hours before start. Within 24 hours, request coverage or transfer the duty directly to a coworker. The Change schedule action moves you atomically to another open slot.</p>}
            {admin && <div className={styles.override}>{!selectedSlot.owner ? <>
              <label htmlFor="override-person">Admin: fill open schedule</label><select id="override-person" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose employee</option>{adminFillOptions.map(item => <option key={item.employee.id} value={item.employee.id} disabled={!item.eligible}>{item.employee.name} - {item.status}{item.exception ? " - Admin exception" : ""}</option>)}</select><button className={styles.primary} disabled={busy || !target || !selectedAdminFill?.eligible || ((adminExceptionNeedsReason || currentDayAdminCorrection) && note.trim().length < 8)} onClick={() => act("override", { ...selection, employee: target, note: adminFillNote })}>Assign employee</button><small>Use this when employees have not grabbed the schedule on time. Options marked Admin exception may exceed a weekly target or create a second same-day duty. Enter an 8+ character reason; rest-day and event conflicts remain blocked.</small>
            </> : <>
              <label htmlFor="override-person">Admin reassignment</label><select id="override-person" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose replacement</option>{s.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}<option value={"admin:" + data.actor.email}>Me (Admin)</option></select><button disabled={busy || !target || !note.trim()} onClick={() => act("override", { ...selection, employee: target })}>Override owner</button><button disabled={busy || !note.trim()} onClick={() => { if (window.confirm("Clear this assignment and make the slot available?")) act("clear", selection); }}>Clear assignment</button><small>Replacing or clearing an existing owner requires your reason and remains in assignment history.</small>
            </>}</div>}
          </div>}
          <div className={styles.calendar}>{visibleDays.map(day => <section key={day} className={`${styles.day} ${!day.startsWith(month) ? styles.boundary : ""}`}><header><span>{new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span><h3>{displayDay(day)}</h3>{day === today && <small>Today</small>}{!day.startsWith(month) && <small>Shared boundary week</small>}</header>{eventsOn(s, day).map(e => <button key={e.id} className={styles.notice} onClick={() => setTab("events")}><strong>{e.title}</strong><br />{e.start} - {e.end}<br />{e.participants.map(id => ownerName(id)).join(", ")}</button>)}{DUTIES.map(duty => { const slot = getSlot(s, day, duty); const ended = new Date(`${day}T${duty === "evening" ? "19" : "15"}:00:00+08:00`) <= now; const employeeMe = s.employees.some(e => e.id === me); const quotaFull = !admin && employeeMe && weeklyDutyCount(s, me, weekStart(day), duty) >= weeklyDutyTarget(s, me, weekStart(day), duty); const adminCanCorrectToday = admin && day === today; const recommendation = !slot.owner && !ended ? recommendationPlan.get(`${day}/${duty}`) || null : null; return <button key={duty} disabled={busy || (ended && !adminCanCorrectToday) || s.months[month] === undefined || (!slot.owner && quotaFull)} className={`${styles.slot} ${slot.owner ? styles.claimed : styles.open} ${slot.coverage ? styles.coverage : ""}`} onClick={() => { setSelection({ day, duty }); setNote(""); setTarget(""); setSwitchTarget(""); setHandoffTarget(""); }}><span>{labels[duty]}</span><small>{duty === "evening" ? "3 PM - 7 PM" : "10 AM - 3 PM"}</small><strong>{slot.owner ? ownerName(slot.owner) : recommendation ? (recommendation.exception ? `Admin review: ${recommendation.employee.name}` : `Recommended: ${recommendation.employee.name}`) : "Available"}</strong><small>{slot.coverage ? "Coverage needed" : ended ? adminCanCorrectToday ? "Ended - Admin correction" : "Ended" : !slot.owner ? recommendation ? (recommendation.exception ? `Needs Admin exception: ${recommendation.reason}` : `${recommendation.employee.name} needs ${recommendation.remaining} more ${labels[duty]} this week`) : quotaFull ? "Your weekly target is complete" : admin ? "Open - Admin may assign" : "Grab / bawi" : slot.owner === me ? "Your duty - manage" : "Taken - view assignment"}</small></button>; })}<div className={styles.rest}><strong>{s.rests[day] ? "Designated rest day" : "Rest-day selection"}</strong><span>{s.rests[day] ? ownerName(s.rests[day]) : "No designated rest day"}</span><small>No shift is not automatically counted as a rest day.</small>{day > today && s.months[month] !== undefined && <>{(!s.rests[day] || s.rests[day] === me) && s.employees.some(e => e.id === me) && <button disabled={busy} onClick={() => act(s.rests[day] === me ? "unrest" : "rest", { day })}>{s.rests[day] === me ? "Remove my rest day" : "Choose my rest day"}</button>}{admin && <select aria-label={`Set rest day for ${day}`} value="" disabled={busy} onChange={e => { if (e.target.value) act(s.rests[day] ? "unrest" : "rest", { day, employee: e.target.value, note: "Admin planned rest day adjustment" }); }}><option value="">Admin: manage rest</option>{s.rests[day] ? <option value={s.rests[day]}>Remove {ownerName(s.rests[day])}</option> : s.employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}</>}</div></section>)}</div>
          <details className={styles.panel}><summary>Planning checks ({checks.length})</summary><p>Each Monday-Sunday week needs exactly two rest days per coordinator, including dates outside the selected month. Only one person may rest on a date. Primary and Evening are the only required monitoring duties. Changes return a finalized month to Planning.</p>{checks.length ? <ul>{checks.map(c => <li key={c}>{c}</li>)}</ul> : <p>All monthly duties and weekly rest-day requirements are complete.</p>}</details>
        </>}
        {tab === "tasks" && s && <section className={styles.panel}><h2>Tasks from Admin</h2><p>Open tasks stay visible until the assigned employee confirms completion. Personal vendor visits should include who was met, what was completed, and anything still pending.</p>
          {admin && <details className={styles.taskForm} open={!Object.keys(s.tasks || {}).length}><summary>Assign an immediate task</summary><form onSubmit={e => { e.preventDefault(); act("create_task", taskDraft); }}><div className={styles.actions}><button type="button" onClick={() => setTaskDraft({ ...taskDraft, title: "Personal vendor visit", instructions: "Visit the vendor personally. Record the vendor name, person met, concerns discussed, and agreed next steps." })}>Personal vendor visit</button><button type="button" onClick={() => setTaskDraft({ ...taskDraft, title: "Finish upcoming vendor profile", instructions: "Meet the upcoming vendor personally and help finish their profile setup. Confirm required profile details are complete, explain daily app use, and record any remaining requirements." })}>Upcoming vendor profile setup</button></div><label htmlFor="task-title">Task title</label><input id="task-title" required maxLength={120} value={taskDraft.title} onChange={e => setTaskDraft({ ...taskDraft, title: e.target.value })} /><label htmlFor="task-instructions">Instructions and vendor name / location</label><textarea id="task-instructions" required maxLength={1500} rows={4} value={taskDraft.instructions} onChange={e => setTaskDraft({ ...taskDraft, instructions: e.target.value })} /><div className={styles.actions}><div><label htmlFor="task-employee">Assigned employee</label><select id="task-employee" required value={taskDraft.employee} onChange={e => setTaskDraft({ ...taskDraft, employee: e.target.value })}><option value="">Choose employee</option>{s.employees.map(e => <option key={e.id} value={e.id}>{e.name} / {e.area}</option>)}</select></div><div><label htmlFor="task-due">Due date (Philippine time)</label><input id="task-due" type="date" required min={today} value={taskDraft.due} onChange={e => setTaskDraft({ ...taskDraft, due: e.target.value })} /></div></div><button className={styles.primary} disabled={busy || s.employees.length !== 3}>Assign task</button></form></details>}
          {!Object.keys(s.tasks || {}).length && <p>No tasks assigned yet.</p>}
          {Object.values(s.tasks || {}).sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || a.due.localeCompare(b.due) || a.createdAt.localeCompare(b.createdAt)).map(task => <article key={task.id} className={styles.task}><div className={styles.editorTitle}><h3>{task.title}</h3><span className={styles.badge}>{task.status === "done" ? "Confirmed done" : task.due < today ? "Overdue" : task.due === today ? "Due today" : "Open"}</span></div><p><strong>{ownerName(task.employee)}</strong> / Due {displayDay(task.due)} / {s.employees.find(e => e.id === task.employee)?.area}</p><p className={styles.instructions}>{task.instructions}</p>{task.status === "done" && <div className={styles.success}><strong>Completion confirmed by {ownerName(task.employee)}</strong><p>{task.completionNote}</p><small>{new Date(task.completedAt!).toLocaleString("en-US", { timeZone: "Asia/Manila" })} PHT / {task.completedBy}</small></div>}{(task.status === "open" && task.employee === me || task.status === "done" && admin) && <>{selectedTask !== task.id ? <button onClick={() => { setSelectedTask(task.id); setNote(""); }}>{task.status === "done" ? "Reopen task" : "Confirm task done"}</button> : <form onSubmit={e => { e.preventDefault(); act(task.status === "done" ? "reopen_task" : "complete_task", { taskId: task.id }); setSelectedTask(""); }}><label htmlFor={`confirmation-${task.id}`}>{task.status === "done" ? "Reason for reopening" : "Completion details: who you met and what you finished"}</label><textarea id={`confirmation-${task.id}`} required maxLength={500} rows={3} value={note} onChange={e => setNote(e.target.value)} /><button className={styles.primary} disabled={busy || !note.trim()}>{task.status === "done" ? "Reopen with reason" : "I confirm this task is done"}</button><button type="button" onClick={() => setSelectedTask("")}>Cancel</button></form>}</>}</article>)}
        </section>}
        {tab === "contacts" && <ContactsPanel />}
        {tab === "tools" && <ToolsLinksPanel admin={!!admin} />}
        {tab === "events" && s && <EventsPanel state={s} admin={!!admin} busy={busy} today={today} act={act} />}
        {tab === "teams" && s && <section className={styles.panel}><h2>Driver teams, across towns</h2><p>Team coordinators handle ongoing driver follow-up. Physical visits, vendor concerns and onboarding stay with the coordinator for the driver's town.</p><p>Teams use the LiveTrips driver list, with coordinators, tester accounts, and explicitly inactive or terminated records excluded. Town balance uses registered home towns. An assignment stays saved until Admin rebalances.</p><div className={styles.teamGrid}>{s.employees.map(e => { const list = data.drivers.filter(d => s.teams[d.id] === e.id); return <article key={e.id}><h3>Team {e.name}</h3><p>Physical / vendor area: <strong>{e.area}</strong></p><strong>{list.length} drivers</strong><p>{Array.from(new Set(list.map(d => d.town))).map(t => `${t}: ${list.filter(d => d.town === t).length}`).join(" / ") || "No team assigned"}</p><ul>{list.map(d => <li key={d.id}>{d.name} <small>{d.town}</small></li>)}</ul></article>; })}</div><p>{data.drivers.filter(d => !s.teams[d.id]).length} eligible drivers are unassigned.</p>{admin && <div className={styles.override}><label htmlFor="team-reason">Reason for balanced random assignment</label><input id="team-reason" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Initial team setup" /><p>This assigns the eligible roster again, balancing each town and total team size. Previous assignments remain in history.</p><button className={styles.primary} disabled={busy || !note.trim() || s.employees.length !== 3} onClick={() => act("balance_teams")}>Assign balanced mixed-town teams</button></div>}</section>}
        {tab === "locations" && admin && <EmployeeLocationsPanel />}
        {tab === "history" && <section className={styles.panel}><h2>Assignment history</h2><p>Every saved change records the person, time, reason, and previous and new assignments.</p>{!activeEvents.length && <p>No changes yet.</p>}{activeEvents.map(e => <details key={e.id} className={styles.event}><summary><strong>{e.action.replaceAll("_", " ")}</strong> {e.day} {e.duty} <span>{new Date(e.created_at).toLocaleString("en-US", { timeZone: "Asia/Manila" })} PHT</span></summary><p>By {e.actor} / Version {e.version}</p>{e.note && <p>Reason: {e.note}</p>}<ul>{Array.from(new Set([...Object.keys(e.changes.before.slots), ...Object.keys(e.changes.after.slots)])).filter(k => JSON.stringify(e.changes.before.slots[k]) !== JSON.stringify(e.changes.after.slots[k])).map(k => <li key={k}>{k}: {ownerName(e.changes.before.slots[k]?.owner || null, e.changes.before)} to {ownerName(e.changes.after.slots[k]?.owner || null, e.changes.after)}{e.changes.after.slots[k]?.coverage ? " (coverage requested; owner retained)" : ""}</li>)}{Array.from(new Set([...Object.keys(e.changes.before.rests), ...Object.keys(e.changes.after.rests)])).filter(k => e.changes.before.rests[k] !== e.changes.after.rests[k]).map(k => <li key={k}>Rest {k}: {ownerName(e.changes.before.rests[k], e.changes.before)} to {ownerName(e.changes.after.rests[k], e.changes.after)}</li>)}</ul><ul>{Object.values(e.changes.after.tasks || {}).filter(t => JSON.stringify(t) !== JSON.stringify(e.changes.before.tasks?.[t.id])).map(t => <li key={t.id}>{t.title}: {ownerName(t.employee, e.changes.after)} / {t.status === "done" ? "Confirmed done" : "Open"}{t.completionNote ? " - " + t.completionNote : ""}</li>)}</ul><details><summary>Full recorded change</summary><pre>{JSON.stringify(e.changes, null, 2)}</pre></details></details>)}{activeEvents.length >= 40 && !historyEnd && <button disabled={busy} onClick={moreHistory}>Load older history</button>}</section>}

      </>}
      <footer className={styles.footer}>Shared JRide staff schedule / Philippine time / {data ? `Updated ${new Date(data.serverTime).toLocaleTimeString("en-US", { timeZone: "Asia/Manila" })}. Refreshes every 15 seconds.` : "Connecting..."}</footer>
    </div>
  </main>;
}

export const AREAS = ["Lagawe + Hingyon", "Banaue", "Lamut"] as const;
export const DUTIES = ["primary", "backup", "evening"] as const;
export type Duty = typeof DUTIES[number];
export type Employee = { id: string; name: string; email: string; area: string };
export type Slot = { owner: string | null; coverage: boolean };
export type Driver = { id: string; name: string; town: string };
export type StaffTask = { id: string; title: string; instructions: string; employee: string; due: string; createdAt: string; createdBy: string; status: "open" | "done"; completedAt?: string; completedBy?: string; completionNote?: string };
export type Schedule = {
  employees: Employee[];
  slots: Record<string, Slot>;
  rests: Record<string, string>;
  months: Record<string, boolean>;
  teams: Record<string, string>;
  tasks?: Record<string, StaffTask>;
};
export type Actor = { email: string; role: string; name: string };
export const emptySchedule = (): Schedule => ({ employees: [], slots: {}, rests: {}, months: {}, teams: {} });
export function dateKey(d: Date) { return d.toISOString().slice(0, 10); }
export function localDate(now: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function addDays(day: string, count: number) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + count); return dateKey(d); }
export function weekStart(day: string) { return addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7)); }
export function monthDays(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a valid month.");
  const first = month + "-01";
  const next = new Date(first + "T00:00:00Z"); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = addDays(weekStart(addDays(dateKey(next), -1)), 6);
  const days: string[] = [];
  for (let d = weekStart(first); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}
export function nextMonth(now: Date) { const d = new Date(localDate(now) + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return dateKey(d).slice(0, 7); }
export function slotKey(day: string, duty: Duty) { return day + "/" + duty; }
export function getSlot(s: Schedule, day: string, duty: Duty): Slot { return s.slots[slotKey(day, duty)] || { owner: null, coverage: false }; }
export function restCount(s: Schedule, employee: string, week: string) { return Array.from({ length: 7 }, (_, i) => s.rests[addDays(week, i)] === employee).filter(Boolean).length; }
export function issues(s: Schedule, month: string) {
  const days = monthDays(month), result: string[] = [];
  if (s.employees.length !== 3) result.push("Set up all three coordinators.");
  days.filter(d => d === weekStart(d)).forEach(w => s.employees.forEach(e => {
    const n = restCount(s, e.id, w); if (n !== 2) result.push(`${e.name}: ${n}/2 rest days for week of ${w}.`);
  }));
  days.filter(d => d.startsWith(month)).forEach(d => DUTIES.forEach(k => {
    const slot = getSlot(s, d, k);
    if (!slot.owner) result.push(`${d}: ${k} is open.`);
    else if (slot.coverage) result.push(`${d}: ${k} needs coverage.`);
  }));
  return result;
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function validDay(day: string) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day)) && dateKey(new Date(day)) === day; }
function startTime(day: string, duty: Duty) { return new Date(`${day}T${duty === "evening" ? "15" : "10"}:00:00+08:00`).getTime(); }
function endTime(day: string, duty: Duty) { return new Date(`${day}T${duty === "evening" ? "19" : "15"}:00:00+08:00`).getTime(); }

// Pure rules run on the server; storage commits use a version check in one DB transaction.
export function changeSchedule(current: Schedule, actor: Actor, input: Record<string, unknown>, now: Date, approved: string[], drivers: Driver[] = [], random = Math.random) {
  const s: Schedule = JSON.parse(JSON.stringify(current));
  const action = text(input.action), admin = actor.role === "admin";
  const me = s.employees.find(e => e.email === actor.email)?.id || (admin ? "admin:" + actor.email : "");
  const note = text(input.note);
  check(note.length <= 500 && /^[\x20-\x7e\r\n]*$/.test(note), "Use ASCII text, up to 500 characters.");
  if (action === "setup") {
    check(admin, "Only Admin can set up coordinators.");
    check(Array.isArray(input.employees) && input.employees.length === 3, "Provide three coordinators.");
    const employees = input.employees.map((raw: any, i: number) => ({ id: `coordinator-${i + 1}`, name: text(raw.name), email: text(raw.email).toLowerCase(), area: AREAS[i] }));
    check(new Set(employees.map(e => e.email)).size === 3, "Each coordinator needs a different account.");
    employees.forEach(e => {
      check(e.name.length > 0 && e.name.length <= 60 && /^[\x20-\x7e]+$/.test(e.name), "Enter an ASCII coordinator name, up to 60 characters.");
      check(approved.includes(e.email), "Choose an existing approved dispatcher account.");
    });
    check(!s.employees.length || note, "Explain the coordinator setup change.");
    // Preserve historic identities and ownership; roster replacement needs a separate migration.
    check(!s.employees.length || employees.every((e, i) => e.email === s.employees[i].email), "Existing coordinator accounts cannot be replaced while history is retained.");
    s.employees = employees;
  } else {
    check(me, "Admin must link your account to a coordinator first.");
    if (action === "open_month" || action === "publish") {
      check(admin, "Only Admin can open or finalize a month.");
      const month = text(input.month); monthDays(month);
      check(month >= localDate(now).slice(0, 7) && month <= nextMonth(new Date(now.getTime() + 335 * 86400000)), "Choose this month or a month in the next year.");
      if (action === "publish") check(issues(s, month).length === 0, "Complete all duties and exactly two weekly rest days before finalizing.");
      s.months[month] = action === "publish";
    } else if (["create_task", "complete_task", "reopen_task"].includes(action)) {
      s.tasks = s.tasks || {};
      if (action === "create_task") {
        check(admin, "Only Admin can assign tasks.");
        const title = text(input.title), instructions = text(input.instructions), employee = text(input.employee), due = text(input.due);
        check(title.length > 0 && title.length <= 120 && instructions.length > 0 && instructions.length <= 1500, "Add a task title and clear instructions (up to 1500 characters).");
        check(/^[\x20-\x7e\r\n]+$/.test(title + instructions), "Use ASCII text for task instructions.");
        check(s.employees.some(e => e.id === employee), "Assign the task to a coordinator.");
        check(validDay(due) && due >= localDate(now), "Choose today or a future due date.");
        const id = now.getTime().toString(36) + "-" + random().toString(36).slice(2);
        check(!s.tasks[id], "Please try assigning the task again.");
        s.tasks[id] = { id, title, instructions, employee, due, createdAt: now.toISOString(), createdBy: actor.email, status: "open" };
      } else {
        const task = s.tasks[text(input.taskId)];
        check(task, "This task was not found.");
        check(note, "Add a completion note or reopening reason.");
        if (action === "complete_task") {
          check(task.employee === me, "Only the assigned employee can confirm completion.");
          check(task.status === "open", "This task is already done.");
          s.tasks[task.id] = { ...task, status: "done", completedAt: now.toISOString(), completedBy: actor.email, completionNote: note };
        } else {
          check(admin, "Only Admin can reopen a task.");
          check(task.status === "done", "This task is already open.");
          s.tasks[task.id] = { ...task, status: "open", completedAt: undefined, completedBy: undefined, completionNote: undefined };
        }
      }
    } else if (action === "balance_teams") {
      check(admin && note, "Admin must give a reason to assign driver teams.");
      check(s.employees.length === 3, "Set up the three coordinators first.");
      check(drivers.length > 0, "No eligible roster drivers were found.");
      const totals: Record<string, number> = Object.fromEntries(s.employees.map(e => [e.id, 0]));
      const teams: Record<string, string> = {};
      for (const town of Array.from(new Set(drivers.map(d => d.town))).sort()) {
        const list = drivers.filter(d => d.town === town);
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        const townTotals = { ...Object.fromEntries(s.employees.map(e => [e.id, 0])) };
        list.forEach(d => {
          const candidates = s.employees.map(e => ({ id: e.id, tie: random() })).sort((a, b) => townTotals[a.id] - townTotals[b.id] || totals[a.id] - totals[b.id] || a.tie - b.tie);
          const id = candidates[0].id; teams[d.id] = id; totals[id]++; townTotals[id]++;
        });
      }
      s.teams = teams;
    } else {
      const day = text(input.day), duty = text(input.duty) as Duty;
      check(validDay(day), "Choose a valid date.");
      check(Object.keys(s.months).some(m => monthDays(m).includes(day)), "Admin must open this planning month first.");
      check(day >= localDate(now), "Past schedules cannot be changed.");
      const target = admin && text(input.employee) ? text(input.employee) : me;
      check(s.employees.some(e => e.id === target) || target === "admin:" + actor.email && admin, "Choose a coordinator or yourself as Admin.");
      const override = action === "override" || action === "override_rest";
      if (override) check(admin && note, "Admin override requires a reason.");
      if (["rest", "unrest", "override_rest"].includes(action)) {
        check(s.employees.some(e => e.id === target), "Rest days are for coordinators.");
        check(day > localDate(now) || override, "Plan rest days in advance; ask Admin about today.");
        if (action === "unrest") { check(s.rests[day] === target, "This is not your rest day."); delete s.rests[day]; }
        else {
          check(!s.rests[day] || s.rests[day] === target, "Another coordinator has this rest day.");
          check(s.rests[day] === target || restCount(s, target, weekStart(day)) < 2, "You already have two rest days that week.");
          check(!DUTIES.some(d => getSlot(s, day, d).owner === target), "Transfer or release your duties before choosing this rest day.");
          s.rests[day] = target;
        }
      } else {
        check(DUTIES.includes(duty), "Choose a valid duty.");
        check(endTime(day, duty) > now.getTime(), "This duty has ended.");
        const key = slotKey(day, duty), slot = getSlot(s, day, duty);
        if (action === "claim" || action === "accept" || action === "override") {
          if (action === "claim") check(!slot.owner, "Someone already owns this duty. Refresh the schedule.");
          if (action === "accept") check(slot.coverage && slot.owner && slot.owner !== target, "This coverage request is no longer available to you.");
          check(s.rests[day] !== target, "You cannot take a duty on your rest day.");
          check(duty === "evening" || getSlot(s, day, duty === "primary" ? "backup" : "primary").owner !== target, "Core Primary and Backup must be different people. Admin can reassign the other slot first.");
          s.slots[key] = { owner: target, coverage: false };
        } else {
          check(slot.owner === me, "Only the duty owner can release or request coverage.");
          if (action === "release") {
            check(startTime(day, duty) - now.getTime() > 24 * 3600000, "Within 24 hours, request coverage. You remain responsible until accepted.");
            s.slots[key] = { owner: null, coverage: false };
          } else if (action === "coverage") { check(note, "Add a brief coverage reason."); s.slots[key] = { ...slot, coverage: true }; }
          else if (action === "cancel_coverage") s.slots[key] = { ...slot, coverage: false };
          else throw new Error("Unknown schedule action.");
        }
      }
      // A changed finalized plan must be checked again, including shared boundary weeks.
      Object.keys(s.months).forEach(m => { if (monthDays(m).includes(day)) s.months[m] = false; });
    }
  }
  return { state: s, event: { action, actor: actor.email, actor_name: actor.name, note, day: text(input.day), duty: text(input.duty), at: now.toISOString(), before: current, after: s } };
}

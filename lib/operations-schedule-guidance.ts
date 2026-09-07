import { DUTIES, LAUNCH_DATE, addDays, getSlot, weekStart, type Duty, type Schedule } from "@/lib/operations-schedule";

export const WEEKLY_BASE_DUTY_TARGET = 2;
export const WEEKLY_REST_TARGET = 2;

export const DUTY_LABELS: Record<Duty, string> = {
  primary: "Core Primary",
  evening: "Evening Monitor",
};

function weekIndex(week: string) {
  const launchWeek = weekStart(LAUNCH_DATE);
  const start = new Date(launchWeek + "T00:00:00Z").getTime();
  const current = new Date(week + "T00:00:00Z").getTime();
  return Math.floor((current - start) / (7 * 86400000));
}

function eligibleDaysInWeek(week: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i)).filter((day) => day >= LAUNCH_DATE);
}

export function weeklyDutyTarget(state: Schedule, employeeId: string, week: string, duty: Duty) {
  const employees = state.employees;
  if (!employees.length) return WEEKLY_BASE_DUTY_TARGET;

  const totalSlots = eligibleDaysInWeek(week).length;
  const base = Math.floor(totalSlots / employees.length);
  const extraSlots = totalSlots % employees.length;
  if (!extraSlots) return base;

  const employeeIndex = employees.findIndex((employee) => employee.id === employeeId);
  if (employeeIndex < 0) return base;

  const dutyOffset = DUTIES.indexOf(duty);
  const rotationStart = ((weekIndex(week) + dutyOffset) % employees.length + employees.length) % employees.length;
  const getsExtra = Array.from({ length: extraSlots }, (_, i) => (rotationStart + i) % employees.length).includes(employeeIndex);
  return base + (getsExtra ? 1 : 0);
}

export function weeklyDutyCount(state: Schedule, employeeId: string, week: string, duty: Duty) {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i))
    .filter((day) => getSlot(state, day, duty).owner === employeeId)
    .length;
}

export function weeklyRestCount(state: Schedule, employeeId: string, week: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i))
    .filter((day) => state.rests[day] === employeeId)
    .length;
}

export function createsPrimaryEveningWholeDay(state: Schedule, employeeId: string, day: string, duty: Duty) {
  return duty === "primary"
    ? getSlot(state, day, "evening").owner === employeeId
    : getSlot(state, day, "primary").owner === employeeId;
}

export function weeklyDutySummary(state: Schedule, employeeId: string, week: string) {
  return DUTIES.map((duty) => ({
    duty,
    label: DUTY_LABELS[duty],
    count: weeklyDutyCount(state, employeeId, week, duty),
    target: weeklyDutyTarget(state, employeeId, week, duty),
  }));
}

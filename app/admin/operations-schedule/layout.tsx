import type { ReactNode } from "react";
import EmployeeGpsCheck from "./EmployeeGpsCheck";
import ScheduleCoach from "./ScheduleCoach";
import AdminTodayRest from "./AdminTodayRest";

export default function OperationsScheduleLayout({ children }: { children: ReactNode }) {
  return <EmployeeGpsCheck><>{children}<ScheduleCoach /><AdminTodayRest /></></EmployeeGpsCheck>;
}

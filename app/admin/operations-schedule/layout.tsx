import type { ReactNode } from "react";
import EmployeeGpsCheck from "./EmployeeGpsCheck";
import ScheduleCoach from "./ScheduleCoach";
import AdminTodayRest from "./AdminTodayRest";
import MeetingShell from "./MeetingShell";

export default function OperationsScheduleLayout({ children }: { children: ReactNode }) {
  return (
    <EmployeeGpsCheck>
      <MeetingShell>
        <>
          {children}
          <ScheduleCoach />
          <AdminTodayRest />
        </>
      </MeetingShell>
    </EmployeeGpsCheck>
  );
}

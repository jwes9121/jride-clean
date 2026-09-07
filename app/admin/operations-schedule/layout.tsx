import type { ReactNode } from "react";
import EmployeeGpsCheck from "./EmployeeGpsCheck";

export default function OperationsScheduleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <EmployeeGpsCheck />
    </>
  );
}

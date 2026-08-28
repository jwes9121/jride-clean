import type { ReactNode } from "react";
import ErrandEscalationQueue from "../../dispatch/ErrandEscalationQueue";

export default function AdminDispatchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandEscalationQueue />
      {children}
    </>
  );
}

import type { ReactNode } from "react";
import ErrandEscalationQueue from "./ErrandEscalationQueue";

export default function DispatchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ErrandEscalationQueue />
      {children}
    </>
  );
}

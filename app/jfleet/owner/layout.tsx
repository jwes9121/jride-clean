import Link from "next/link";
import type { ReactNode } from "react";
export default function JFleetOwnerLayout({children}: {children: ReactNode}) {
  return <><nav className="bg-slate-900 p-4 text-white flex flex-wrap gap-4 text-sm">
    <Link href="/jfleet/owner">Bookings and payments</Link>
    <Link href="/jfleet/owner/routes">Route review and quotations</Link>
    <span>Approve the saved route before issuing a quotation. Legacy quote forms cannot bypass approval.</span>
  </nav>{children}</>;
}

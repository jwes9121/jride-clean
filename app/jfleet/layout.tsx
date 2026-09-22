"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function JFleetLayout({children}:{children:React.ReactNode}){
  const path=usePathname();
  if(path?.startsWith("/jfleet/owner")||path?.startsWith("/jfleet/driver"))return <>{children}</>;
  return <><nav aria-label="JFleet customer" className="flex flex-wrap gap-4 border-b bg-white p-4 text-sm font-semibold text-slate-950"><Link href="/jfleet/request">Request quote</Link><Link href="/jfleet/inquiries">Full quotations and revisions</Link><Link href="/jfleet">Bookings</Link></nav>{children}</>;
}

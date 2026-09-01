"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function AgrimarketFarmerLoginLink() {
  const pathname = usePathname();
  const [marketplaceEnabled, setMarketplaceEnabled] = useState(false);

  useEffect(() => {
    if (pathname !== "/agrimarket") return;
    fetch("/api/agrimarket/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setMarketplaceEnabled(Boolean(payload?.enabled)))
      .catch(() => setMarketplaceEnabled(false));
  }, [pathname]);

  if (pathname !== "/agrimarket" || !marketplaceEnabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <Link
        href="/agrimarket/farmer"
        className="rounded-full border border-emerald-200 bg-white/95 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm"
      >
        Farmer Login
      </Link>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { BarChart3, ClipboardList, Store, Utensils } from "lucide-react";

type VendorSection = "menu" | "orders" | "profile" | "analytics";

export default function VendorNavigation({
  active,
  vendorId,
}: {
  active: VendorSection;
  vendorId: string;
}) {
  const query = vendorId ? "?vendor_id=" + encodeURIComponent(vendorId) : "";

  useEffect(() => {
    // This Android version already places its status control above the WebView.
    if (!navigator.userAgent.includes("JRideVendorPush/1")) return;
    document.documentElement.dataset.jrideVendorNative = "true";
    return () => { delete document.documentElement.dataset.jrideVendorNative; };
  }, []);

  const links = [
    { key: "menu", label: "Menu", href: "/vendor-portal" + query + "#menu", icon: Utensils },
    { key: "orders", label: "Orders", href: "/vendor-orders" + query, icon: ClipboardList },
    { key: "profile", label: "Profile", href: "/vendor-portal" + query + "#profile", icon: Store },
    { key: "analytics", label: "Analytics", href: "/vendor-analytics" + query, icon: BarChart3 },
  ] as const;

  return (
    <nav className="vendor-navigation" aria-label="Vendor navigation">
      {links.map(({ key, label, href, icon: Icon }) => (
        <a key={key} href={href} aria-current={active === key ? "page" : undefined}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function elementText(element: Element | null): string {
  return clean(element?.textContent).replace(/\s+/g, " ");
}

function readVendorId(): string {
  if (typeof window === "undefined") return "";

  for (const key of VENDOR_ID_KEYS) {
    const values = [window.sessionStorage.getItem(key), window.localStorage.getItem(key)];
    for (const value of values) {
      const id = clean(value);
      if (id) return id;
    }
  }

  return "";
}

function vendorSections(): HTMLElement[] {
  const shell = document.querySelector<HTMLElement>(".jride-vendor-premium-shell");
  if (!shell) return [];
  return Array.from(shell.querySelectorAll<HTMLElement>("section"));
}

function sectionByHeading(label: string): HTMLElement | null {
  return (
    vendorSections().find((section) => elementText(section.querySelector("h2")) === label) ||
    null
  );
}

function scrollToSection(label: string) {
  const section = sectionByHeading(label);
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markPortalStructure() {
  const shell = document.querySelector<HTMLElement>(".jride-vendor-premium-shell");
  if (!shell) return;

  const portalHeading = Array.from(shell.querySelectorAll<HTMLHeadingElement>("h1")).find(
    (heading) => elementText(heading) === "Vendor Portal",
  );

  const header = portalHeading?.closest<HTMLElement>("div.rounded-2xl") || null;
  if (header) {
    header.dataset.jrideVendorPortalHeader = "true";

    Array.from(header.querySelectorAll<HTMLElement>("a, button")).forEach((action) => {
      const label = elementText(action);
      if (label === "Orders" || label === "Analytics" || label === "Refresh") {
        action.dataset.jrideVendorHeaderRedundant = "true";
      }
    });
  }

  const profile = sectionByHeading("Vendor profile");
  const menu = sectionByHeading("Menu manager");
  if (profile) profile.dataset.jrideVendorScrollTarget = "true";
  if (menu) menu.dataset.jrideVendorScrollTarget = "true";

  const historyHeading = Array.from(shell.querySelectorAll<HTMLHeadingElement>("h3")).find((heading) =>
    elementText(heading).startsWith("Completed and cancelled history"),
  );
  const historyPanel = historyHeading?.parentElement;
  if (historyPanel instanceof HTMLElement) {
    historyPanel.dataset.jrideVendorHistoryPanel = "true";
  }
}

export default function VendorPortalMobileChrome() {
  const pathname = usePathname();
  const [vendorId, setVendorId] = useState("");

  useEffect(() => {
    if (pathname !== "/vendor-portal") {
      setVendorId("");
      return;
    }

    let stopped = false;
    let timer: number | null = null;

    const discover = () => {
      if (stopped) return;
      const id = readVendorId();
      if (id) {
        setVendorId(id);
        return;
      }
      timer = window.setTimeout(discover, 1000);
    };

    discover();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/vendor-portal") return;

    let frame = 0;
    const apply = () => markPortalStructure();
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  const vendorQuery = useMemo(
    () => (vendorId ? "?vendor_id=" + encodeURIComponent(vendorId) : ""),
    [vendorId],
  );

  if (pathname !== "/vendor-portal") return null;

  return (
    <nav className="jride-vendor-mobile-nav" aria-label="Vendor portal navigation">
      <button type="button" onClick={() => scrollToSection("Menu manager")}>Menu</button>
      <a href={"/vendor-orders" + vendorQuery}>Orders</a>
      <button type="button" onClick={() => scrollToSection("Vendor profile")}>Profile</button>
      <a href={"/vendor-analytics" + vendorQuery}>Analytics</a>
    </nav>
  );
}

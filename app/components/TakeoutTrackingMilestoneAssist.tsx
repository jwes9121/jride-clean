"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const TRACKING_MILESTONES = new Set([
  "Store confirmed",
  "Driver found",
  "Quote ready",
  "Order confirmed",
  "At store",
  "Picked up",
  "Delivering",
  "Completed",
]);

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function neutralizeUnmetMilestones() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("div.rounded-full.border"));

  for (const pill of candidates) {
    if (!TRACKING_MILESTONES.has(clean(pill.textContent))) continue;

    const isUnmet =
      pill.classList.contains("border-amber-300") &&
      pill.classList.contains("bg-amber-50") &&
      pill.classList.contains("text-amber-700");

    if (!isUnmet) continue;

    pill.classList.remove("border-amber-300", "bg-amber-50", "text-amber-700");
    pill.classList.add("border-slate-200", "bg-slate-50", "text-slate-500");
  }
}

export default function TakeoutTrackingMilestoneAssist() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/takeout/track/")) return;

    neutralizeUnmetMilestones();

    const observer = new MutationObserver(() => neutralizeUnmetMilestones());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}

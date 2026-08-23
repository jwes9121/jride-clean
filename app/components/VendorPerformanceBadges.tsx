"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

function normalized(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function cardMatchesVendor(card: HTMLElement, vendor: any): boolean {
  const name = normalized(vendor?.display_name);
  if (!name) return false;

  const exactNameElement = Array.from(card.querySelectorAll<HTMLElement>("div,span"))
    .some((element) => normalized(element.textContent) === name);
  if (!exactNameElement) return false;

  const town = normalized(vendor?.town);
  return !town || normalized(card.textContent).includes(town);
}

function performanceKey(vendor: any): string {
  return [
    vendor?.public_state,
    vendor?.acceptance_visible,
    vendor?.acceptance_rate,
    vendor?.rating_visible,
    vendor?.rating_average,
  ].join("|");
}

function buildPerformanceBox(vendor: any): HTMLElement {
  const box = document.createElement("div");
  box.dataset.jrideVendorPerformance = "true";
  box.className = "mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold";

  if (vendor?.public_state === "building") {
    const newBadge = document.createElement("span");
    newBadge.className = "rounded-full border border-blue-400/50 bg-blue-500/10 px-2 py-0.5 text-blue-100";
    newBadge.textContent = "New on JRide";
    box.appendChild(newBadge);

    const tracking = document.createElement("span");
    tracking.className = "text-slate-300";
    tracking.textContent = "Performance tracking active";
    box.appendChild(tracking);
    return box;
  }

  if (vendor?.acceptance_visible && Number.isFinite(Number(vendor?.acceptance_rate))) {
    const acceptance = document.createElement("span");
    acceptance.className = "rounded-full border border-emerald-400/50 bg-emerald-500/10 px-2 py-0.5 text-emerald-100";
    acceptance.textContent = "Acceptance " + Math.round(Number(vendor.acceptance_rate)) + "%";
    box.appendChild(acceptance);
  } else {
    const building = document.createElement("span");
    building.className = "text-slate-300";
    building.textContent = "Acceptance tracking active";
    box.appendChild(building);
  }

  if (vendor?.rating_visible && Number.isFinite(Number(vendor?.rating_average))) {
    const rating = document.createElement("span");
    rating.className = "rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-amber-100";
    rating.textContent = "Rating " + Number(vendor.rating_average).toFixed(1) + " / 5";
    box.appendChild(rating);
  } else {
    const feedback = document.createElement("span");
    feedback.className = "text-slate-300";
    feedback.textContent = "Feedback building";
    box.appendChild(feedback);
  }

  return box;
}

export default function VendorPerformanceBadges() {
  const pathname = usePathname();
  const vendorsRef = useRef<any[]>([]);

  useEffect(() => {
    if (pathname !== "/takeout") return;

    let stopped = false;
    let observerTimer: number | null = null;
    let refreshTimer: number | null = null;

    const apply = () => {
      if (stopped) return;
      const grids = Array.from(document.querySelectorAll<HTMLElement>(".jride-vendor-grid"));
      if (!grids.length) return;

      for (const grid of grids) {
        const cards = Array.from(grid.children).filter(
          (child): child is HTMLElement => child instanceof HTMLElement
        );

        for (const card of cards) {
          const matches = vendorsRef.current.filter((vendor) => cardMatchesVendor(card, vendor));
          if (matches.length !== 1) continue;

          const vendor = matches[0];
          const key = performanceKey(vendor);
          if (card.dataset.jrideVendorPerformanceKey === key) continue;

          card.querySelectorAll('[data-jride-vendor-performance="true"]').forEach((node) => node.remove());
          const target = card.querySelector<HTMLElement>(".min-w-0.flex-1") || card;
          target.appendChild(buildPerformanceBox(vendor));
          card.dataset.jrideVendorPerformanceKey = key;
        }
      }
    };

    const load = async () => {
      const response = await fetch("/api/public/vendor-performance", {
        method: "GET",
        cache: "no-store",
      }).catch(() => null);
      if (!response || !response.ok) return;
      const body = await response.json().catch(() => ({}));
      vendorsRef.current = Array.isArray(body?.vendors) ? body.vendors : [];
      apply();
    };

    const observer = new MutationObserver(() => {
      if (observerTimer !== null) window.clearTimeout(observerTimer);
      observerTimer = window.setTimeout(apply, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    void load();
    refreshTimer = window.setInterval(() => void load(), 60000);

    return () => {
      stopped = true;
      observer.disconnect();
      if (observerTimer !== null) window.clearTimeout(observerTimer);
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    };
  }, [pathname]);

  return null;
}

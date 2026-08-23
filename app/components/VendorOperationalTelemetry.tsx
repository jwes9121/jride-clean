"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatManila(value: unknown): string {
  const raw = text(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function findHistoryContainer(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h3"));
  const heading = headings.find((item) => text(item).startsWith("Completed and cancelled history"));
  if (!heading) return null;
  const next = heading.nextElementSibling;
  return next instanceof HTMLElement ? next : null;
}

function recordedLabel(order: any): { label: string; value: string | null; exact: boolean } {
  if (order?.vendor_timeout_at) return { label: "Missed at", value: order.vendor_timeout_at, exact: true };
  if (order?.vendor_rejected_at) return { label: "Rejected at", value: order.vendor_rejected_at, exact: true };
  if (order?.vendor_accepted_at) return { label: "Accepted at", value: order.vendor_accepted_at, exact: true };
  if (order?.vendor_responded_at) return { label: "Responded at", value: order.vendor_responded_at, exact: true };
  return { label: "Recorded at", value: order?.updated_at || null, exact: false };
}

export default function VendorOperationalTelemetry() {
  const pathname = usePathname();
  const auditRef = useRef<any[]>([]);

  useEffect(() => {
    if (pathname !== "/vendor-portal") return;

    let stopped = false;
    let heartbeatTimer: number | null = null;
    let auditTimer: number | null = null;
    let mutationTimer: number | null = null;

    const sendHeartbeat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      await fetch("/api/vendor-presence/heartbeat", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => undefined);
    };

    const applyDates = () => {
      if (stopped) return;
      const container = findHistoryContainer();
      if (!container) return;

      const cards = Array.from(container.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );

      for (const card of cards) {
        if (card.dataset.jrideOrderDateApplied === "true") continue;
        const cardText = text(card);
        const order = auditRef.current.find((row) => {
          const code = text(row?.booking_code);
          const id = text(row?.id);
          return (code && cardText.includes(code)) || (id && cardText.includes(id));
        });
        if (!order) continue;

        const detail = card.querySelector<HTMLElement>(".mt-1.space-y-0\\.5") || card;
        const response = recordedLabel(order);
        const dateBox = document.createElement("div");
        dateBox.dataset.jrideOrderDate = "true";
        dateBox.className = "mt-2 rounded-lg border border-emerald-900/40 bg-slate-950/40 px-2 py-1.5 text-[11px] text-slate-300";

        const placed = document.createElement("div");
        placed.textContent = "Order placed: " + formatManila(order?.created_at);
        dateBox.appendChild(placed);

        if (response.value) {
          const recorded = document.createElement("div");
          recorded.textContent = response.label + ": " + formatManila(response.value) + (response.exact ? "" : " (recorded update time)");
          dateBox.appendChild(recorded);
        }

        detail.appendChild(dateBox);
        card.dataset.jrideOrderDateApplied = "true";
      }
    };

    const loadAudit = async () => {
      if (stopped) return;
      const response = await fetch("/api/vendor-portal/order-audit", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => null);
      if (!response || !response.ok) return;
      const body = await response.json().catch(() => ({}));
      auditRef.current = Array.isArray(body?.orders) ? body.orders : [];
      document
        .querySelectorAll<HTMLElement>('[data-jride-order-date-applied="true"]')
        .forEach((card) => {
          card.querySelectorAll('[data-jride-order-date="true"]').forEach((node) => node.remove());
          delete card.dataset.jrideOrderDateApplied;
        });
      applyDates();
    };

    const observer = new MutationObserver(() => {
      if (mutationTimer !== null) window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(applyDates, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
        void loadAudit();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void sendHeartbeat();
    void loadAudit();
    heartbeatTimer = window.setInterval(() => void sendHeartbeat(), 60000);
    auditTimer = window.setInterval(() => void loadAudit(), 30000);

    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (auditTimer !== null) window.clearInterval(auditTimer);
      if (mutationTimer !== null) window.clearTimeout(mutationTimer);
    };
  }, [pathname]);

  return null;
}

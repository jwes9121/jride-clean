"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function elementText(element: Element | null): string {
  return clean(element?.textContent);
}

function findExact<T extends Element>(
  root: ParentNode,
  selector: string,
  labels: string[],
): T | null {
  return (
    Array.from(root.querySelectorAll<T>(selector)).find((element) =>
      labels.includes(elementText(element)),
    ) || null
  );
}

function setText(element: HTMLElement | null, value: string) {
  if (element && elementText(element) !== value) element.textContent = value;
}

function markTechnicalStoreCopy(shell: HTMLElement) {
  Array.from(shell.querySelectorAll<HTMLElement>("div,span,p")).forEach((element) => {
    const value = elementText(element);
    if (!value.includes("Performance tracking active")) return;
    if (element.childElementCount > 2) return;
    element.dataset.jrideTakeoutPassengerTechnicalCopy = "true";
  });
}

function polishCheckout(shell: HTMLElement) {
  shell.dataset.jrideTakeoutCheckoutPolish = "true";
  markTechnicalStoreCopy(shell);

  const refreshSaved = shell.querySelector<HTMLElement>(
    "[data-jride-takeout-refresh-saved='true']",
  );
  if (refreshSaved) refreshSaved.dataset.jrideTakeoutPassengerHideRefresh = "true";

  const title = findExact<HTMLElement>(shell, "div", ["Exact delivery location"]);
  const left = title?.parentElement;
  const row = left?.parentElement;
  const card = row?.parentElement;

  if (card instanceof HTMLElement && row instanceof HTMLElement) {
    card.dataset.jrideTakeoutPassengerPinCard = "true";

    const toggle = row.querySelector<HTMLButtonElement>("button");
    const toggleLabel = elementText(toggle);
    const pinOpen = toggleLabel === "Hide map";

    const status = Array.from(card.children).find((child) => {
      const value = elementText(child);
      return (
        value.startsWith("Exact delivery location selected") ||
        value.startsWith("Exact delivery location saved") ||
        value.startsWith("Exact delivery location confirmed")
      );
    });
    const statusText = elementText(status || null);
    const confirmed =
      statusText.startsWith("Exact delivery location saved") ||
      statusText.startsWith("Exact delivery location confirmed") ||
      Boolean(card.querySelector("[data-jride-takeout-pin-badge='true']"));

    card.dataset.jrideTakeoutPassengerPinOpen = pinOpen ? "true" : "false";
    card.dataset.jrideTakeoutPassengerPinConfirmed = confirmed ? "true" : "false";

    if (confirmed && shell.dataset.jrideTakeoutSavedPinInitialized !== "true") {
      shell.dataset.jrideTakeoutSavedPinInitialized = "true";
      if (pinOpen && toggle) {
        window.setTimeout(() => toggle.click(), 0);
      }
    }

    const actionRequired = pinOpen && !confirmed;
    shell.dataset.jrideTakeoutPinActionRequired = actionRequired ? "true" : "false";

    const confirmButton = findExact<HTMLButtonElement>(card, "button", [
      "Confirm location",
      "Use this location",
    ]);
    if (confirmButton) {
      confirmButton.dataset.jrideTakeoutUseLocation = "true";
      setText(confirmButton, "Use this location");
    }

    const adjustButton = findExact<HTMLButtonElement>(card, "button", [
      "Adjust location",
    ]);
    if (adjustButton) {
      adjustButton.dataset.jrideTakeoutRedundantAdjust = "true";
    }
  } else {
    shell.dataset.jrideTakeoutPinActionRequired = "false";
  }

  const cart = shell.querySelector<HTMLElement>(".jride-takeout-cart");
  if (cart) {
    const primaryButton = Array.from(cart.children).find(
      (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
    );

    if (primaryButton) {
      primaryButton.dataset.jrideTakeoutPassengerPrimaryCta = "true";
      const label = elementText(primaryButton);
      const submitting =
        label === "Submitting order..." ||
        label === "Sending your order to the store...";

      cart.dataset.jrideTakeoutSubmitting = submitting ? "true" : "false";

      if (submitting) {
        setText(primaryButton, "Sending your order to the store...");
        const helper = primaryButton.nextElementSibling;
        if (helper instanceof HTMLElement) {
          helper.dataset.jrideTakeoutSubmittingHelper = "true";
          setText(helper, "Please wait. This can take a few seconds.");
        }
      }
    }
  }
}

type ProgressStage = {
  done: string;
  current: string;
  future: string;
};

const TRACKING_STAGES: ProgressStage[] = [
  { done: "Store confirmed", current: "Waiting for store", future: "Store" },
  { done: "Driver found", current: "Finding driver", future: "Driver" },
  { done: "Quote ready", current: "Waiting for quote", future: "Delivery quote" },
  { done: "Order confirmed", current: "Confirm total", future: "Confirm total" },
  { done: "At store", current: "Going to store", future: "At store" },
  { done: "Picked up", current: "Waiting for pickup", future: "Pickup" },
  { done: "Delivering", current: "Delivering", future: "Delivery" },
  { done: "Completed", current: "Finishing order", future: "Completed" },
];

function stageAliases(stage: ProgressStage): string[] {
  return Array.from(new Set([stage.done, stage.current, stage.future]));
}

function polishTrackingProgress(shell: HTMLElement) {
  const allDivs = Array.from(shell.querySelectorAll<HTMLElement>("div"));
  const chips = TRACKING_STAGES.map((stage) =>
    allDivs.find((element) => stageAliases(stage).includes(elementText(element))) || null,
  );

  if (chips.filter(Boolean).length < 4) return;

  const firstChip = chips.find((chip): chip is HTMLElement => Boolean(chip));
  const grid = firstChip?.parentElement;
  if (grid instanceof HTMLElement) grid.dataset.jrideTakeoutProgressGrid = "true";

  const doneStates = chips.map((chip) =>
    Boolean(chip && String(chip.className).includes("border-emerald-300")),
  );
  const currentIndex = doneStates.findIndex((done) => !done);

  chips.forEach((chip, index) => {
    if (!chip) return;
    const stage = TRACKING_STAGES[index];
    const done = doneStates[index];
    const current = !done && index === currentIndex;

    chip.dataset.jrideTakeoutProgressState = done
      ? "done"
      : current
        ? "current"
        : "future";

    if (current) chip.setAttribute("aria-current", "step");
    else chip.removeAttribute("aria-current");

    setText(chip, done ? stage.done : current ? stage.current : stage.future);
  });
}

function polishTrackingSummary(shell: HTMLElement) {
  const spans = Array.from(shell.querySelectorAll<HTMLSpanElement>("span"));
  const pricingLabel = spans.find((span) =>
    ["Pricing status", "Delivery quote"].includes(elementText(span)),
  );

  if (pricingLabel) {
    pricingLabel.dataset.jrideTakeoutTrackingSummaryLabel = "true";
    setText(pricingLabel, "Delivery quote");

    const value = pricingLabel.nextElementSibling;
    if (value instanceof HTMLElement) {
      value.dataset.jrideTakeoutTrackingSummaryValue = "true";
      const raw = elementText(value).toLowerCase().replace(/_/g, " ");
      if (raw === "pricing pending" || raw === "pending") setText(value, "Waiting");
      else if (raw === "driver fee proposed") setText(value, "Ready to review");
      else if (raw.includes("customer confirmed") || raw === "confirmed") setText(value, "Confirmed");
      else if (raw === "expired") setText(value, "Expired");
    }
  }

  Array.from(shell.querySelectorAll<HTMLElement>("div")).forEach((element) => {
    const value = elementText(element);
    if (value.startsWith("Vendor status:") || value.startsWith("Customer status:")) {
      element.dataset.jrideTakeoutTrackingTechnicalStatus = "true";
    }
  });
}

function polishTracking(pathname: string) {
  const shell = document.querySelector<HTMLElement>("div.mx-auto.max-w-2xl.p-6");
  if (!shell) return;

  document.body.dataset.jrideTakeoutTrackingPage = "true";
  shell.dataset.jrideTakeoutTrackingShell = "true";
  shell.dataset.jrideTakeoutTrackingPath = pathname;

  const refreshButton = findExact<HTMLButtonElement>(shell, "button", [
    "Refresh",
    "Refreshing...",
  ]);
  if (refreshButton) refreshButton.dataset.jrideTakeoutTrackingRefresh = "true";

  polishTrackingSummary(shell);
  polishTrackingProgress(shell);
}

const STYLES = `
@keyframes jrideTakeoutSubmitSpin {
  to { transform: rotate(360deg); }
}

@media (max-width: 639px) {
  [data-jride-takeout-passenger-technical-copy="true"],
  [data-jride-takeout-passenger-hide-refresh="true"],
  [data-jride-takeout-redundant-adjust="true"] {
    display: none !important;
  }

  .jride-takeout-page[data-jride-takeout-pin-action-required="true"]
    [data-jride-takeout-passenger-primary-cta="true"] {
    display: none !important;
  }

  [data-jride-takeout-use-location="true"] {
    width: 100% !important;
    min-height: 2.8rem !important;
    border-radius: 0.85rem !important;
    background: linear-gradient(135deg, #86efac 0%, #22c55e 48%, #14b8a6 100%) !important;
    color: #061014 !important;
    font-weight: 900 !important;
  }

  .jride-takeout-cart[data-jride-takeout-submitting="true"]
    [data-jride-takeout-passenger-primary-cta="true"]::before {
    content: "";
    display: inline-block;
    width: 0.9rem;
    height: 0.9rem;
    margin-right: 0.5rem;
    vertical-align: -0.1rem;
    border: 2px solid rgba(248, 250, 252, 0.4);
    border-top-color: #f8fafc;
    border-radius: 999px;
    animation: jrideTakeoutSubmitSpin 0.8s linear infinite;
  }

  [data-jride-takeout-submitting-helper="true"] {
    color: #cbd5e1 !important;
    font-size: 0.68rem !important;
  }
}

body[data-jride-takeout-tracking-page="true"] {
  min-height: 100vh;
  background:
    radial-gradient(circle at 18% 0%, rgba(34, 197, 94, 0.2), transparent 28%),
    radial-gradient(circle at 100% 18%, rgba(20, 184, 166, 0.11), transparent 32%),
    linear-gradient(180deg, #041015 0%, #071014 52%, #020617 100%) !important;
  color: #f8fafc !important;
}

[data-jride-takeout-tracking-shell="true"] {
  max-width: 42rem !important;
  min-height: 100vh;
  padding: max(0.9rem, env(safe-area-inset-top, 0px)) 0.85rem 2rem !important;
  color: #f8fafc !important;
}

[data-jride-takeout-tracking-shell="true"] > div:first-child {
  padding: 0.35rem 0.2rem 0.25rem !important;
}

[data-jride-takeout-tracking-shell="true"] > div:first-child .text-2xl {
  color: #f8fafc !important;
  font-size: 1.45rem !important;
  font-weight: 900 !important;
  letter-spacing: -0.03em !important;
}

[data-jride-takeout-tracking-shell="true"] .text-slate-950,
[data-jride-takeout-tracking-shell="true"] .text-slate-900,
[data-jride-takeout-tracking-shell="true"] .text-slate-800,
[data-jride-takeout-tracking-shell="true"] .text-slate-700 {
  color: #f8fafc !important;
}

[data-jride-takeout-tracking-shell="true"] .text-slate-600,
[data-jride-takeout-tracking-shell="true"] .text-slate-500 {
  color: #9fb0c1 !important;
}

[data-jride-takeout-tracking-shell="true"] .bg-white,
[data-jride-takeout-tracking-shell="true"] .bg-slate-50 {
  background: linear-gradient(180deg, rgba(15, 30, 41, 0.96), rgba(7, 18, 25, 0.96)) !important;
  color: #f8fafc !important;
}

[data-jride-takeout-tracking-shell="true"] .border,
[data-jride-takeout-tracking-shell="true"] .border-slate-200,
[data-jride-takeout-tracking-shell="true"] .border-slate-300 {
  border-color: rgba(148, 163, 184, 0.22) !important;
}

[data-jride-takeout-tracking-shell="true"] > .mt-4.rounded-lg {
  border-color: rgba(34, 197, 94, 0.28) !important;
  border-radius: 1.15rem !important;
  background: linear-gradient(180deg, rgba(11, 23, 32, 0.97), rgba(6, 16, 22, 0.98)) !important;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34) !important;
}

[data-jride-takeout-tracking-shell="true"] .bg-blue-50 {
  background: rgba(14, 116, 144, 0.14) !important;
  border-color: rgba(56, 189, 248, 0.34) !important;
  color: #bae6fd !important;
}

[data-jride-takeout-tracking-shell="true"] .bg-emerald-50 {
  background: rgba(16, 185, 129, 0.12) !important;
  border-color: rgba(52, 211, 153, 0.32) !important;
  color: #bbf7d0 !important;
}

[data-jride-takeout-tracking-shell="true"] .bg-amber-50 {
  background: rgba(245, 158, 11, 0.12) !important;
  border-color: rgba(245, 158, 11, 0.34) !important;
  color: #fde68a !important;
}

[data-jride-takeout-tracking-shell="true"] .bg-red-50,
[data-jride-takeout-tracking-shell="true"] .bg-rose-50 {
  background: rgba(239, 68, 68, 0.12) !important;
  border-color: rgba(248, 113, 113, 0.34) !important;
  color: #fecaca !important;
}

[data-jride-takeout-tracking-refresh="true"],
[data-jride-takeout-tracking-technical-status="true"] {
  display: none !important;
}

[data-jride-takeout-progress-grid="true"] {
  gap: 0.45rem !important;
}

[data-jride-takeout-progress-state] {
  min-height: 2rem;
  display: flex !important;
  align-items: center;
  justify-content: center;
  border-radius: 0.75rem !important;
  padding: 0.4rem 0.5rem !important;
  font-size: 0.68rem !important;
  line-height: 1.1 !important;
}

[data-jride-takeout-progress-state="done"] {
  border-color: rgba(52, 211, 153, 0.48) !important;
  background: rgba(16, 185, 129, 0.15) !important;
  color: #bbf7d0 !important;
}

[data-jride-takeout-progress-state="done"]::before {
  content: "✓";
  margin-right: 0.3rem;
  font-weight: 900;
}

[data-jride-takeout-progress-state="current"] {
  border-color: rgba(250, 204, 21, 0.52) !important;
  background: rgba(250, 204, 21, 0.12) !important;
  color: #fde68a !important;
  box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.1) !important;
}

[data-jride-takeout-progress-state="current"]::before {
  content: "";
  width: 0.42rem;
  height: 0.42rem;
  margin-right: 0.35rem;
  border-radius: 999px;
  background: #facc15;
  box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.1);
}

[data-jride-takeout-progress-state="future"] {
  border-color: rgba(148, 163, 184, 0.18) !important;
  background: rgba(15, 23, 42, 0.36) !important;
  color: #7f91a4 !important;
}

[data-jride-takeout-tracking-shell="true"] button.bg-slate-900,
[data-jride-takeout-tracking-shell="true"] a.bg-slate-900 {
  background: linear-gradient(135deg, #86efac 0%, #22c55e 48%, #14b8a6 100%) !important;
  color: #061014 !important;
  border-radius: 0.85rem !important;
  font-weight: 900 !important;
}

@media (max-width: 639px) {
  [data-jride-takeout-tracking-shell="true"] {
    padding-left: 0.65rem !important;
    padding-right: 0.65rem !important;
  }

  [data-jride-takeout-tracking-shell="true"] > .mt-4.rounded-lg {
    margin-top: 0.75rem !important;
    padding: 0.8rem !important;
  }

  [data-jride-takeout-progress-grid="true"] {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}
`;

export default function TakeoutPassengerCheckoutPolish() {
  const pathname = usePathname();

  useEffect(() => {
    const onCheckout = pathname === "/takeout";
    const onTracking = pathname.startsWith("/takeout/track/");
    if (!onCheckout && !onTracking) return;

    let frame = 0;
    const apply = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (onCheckout) {
          const shell = document.querySelector<HTMLElement>(".jride-takeout-page");
          if (shell) polishCheckout(shell);
        }
        if (onTracking) polishTracking(pathname);
      });
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    const timer = window.setInterval(apply, 1000);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      observer.disconnect();
      delete document.body.dataset.jrideTakeoutTrackingPage;
    };
  }, [pathname]);

  if (pathname !== "/takeout" && !pathname.startsWith("/takeout/track/")) return null;
  return <style>{STYLES}</style>;
}

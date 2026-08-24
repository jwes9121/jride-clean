"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function elementText(element: Element | null): string {
  return clean(element?.textContent);
}

function maskPhone(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 8) return digits;
  return digits.slice(0, 4) + "***" + digits.slice(-4);
}

function findExact<T extends Element>(
  root: ParentNode,
  selector: string,
  label: string,
): T | null {
  return (
    Array.from(root.querySelectorAll<T>(selector)).find(
      (element) => elementText(element) === label,
    ) || null
  );
}

function setElementText(element: HTMLElement | null, value: string) {
  if (element && elementText(element) !== value) element.textContent = value;
}

function setButtonText(button: HTMLButtonElement | null, value: string) {
  if (button && elementText(button) !== value) button.textContent = value;
}

function markDeliveryHeader(shell: HTMLElement) {
  const title = Array.from(shell.querySelectorAll<HTMLElement>("div")).find(
    (element) =>
      elementText(element) === "Delivery details" &&
      element.className.includes("text-lg"),
  );
  const left = title?.parentElement;
  const row = left?.parentElement;
  const card = row?.parentElement;
  if (!(card instanceof HTMLElement) || !(left instanceof HTMLElement)) return;

  card.dataset.jrideTakeoutDeliveryStageHeader = "true";
  Array.from(left.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const value = elementText(child);
    if (value === "Step 4") child.dataset.jrideTakeoutDeliveryStep = "true";
    if (value.startsWith("Confirm your passenger details")) {
      child.dataset.jrideTakeoutDeliveryHeaderDescription = "true";
    }
  });
}

function ensureContactSummary(shell: HTMLElement) {
  const nameLabel = Array.from(shell.querySelectorAll<HTMLLabelElement>("label")).find(
    (label) => elementText(label) === "Passenger name (required)",
  );
  const phoneLabel = Array.from(shell.querySelectorAll<HTMLLabelElement>("label")).find(
    (label) => elementText(label) === "Passenger phone (required)",
  );
  const nameWrap = nameLabel?.parentElement;
  const phoneWrap = phoneLabel?.parentElement;
  const nameInput = nameWrap?.querySelector<HTMLInputElement>("input");
  const phoneInput = phoneWrap?.querySelector<HTMLInputElement>("input");

  if (!(nameWrap instanceof HTMLElement) || !(phoneWrap instanceof HTMLElement)) return;
  if (!nameInput || !phoneInput) return;

  nameWrap.dataset.jrideTakeoutContactField = "name";
  phoneWrap.dataset.jrideTakeoutContactField = "phone";

  const name = clean(nameInput.value);
  const phone = clean(phoneInput.value);
  let summary = shell.querySelector<HTMLElement>("[data-jride-takeout-contact-summary='true']");

  if (!name || !phone) {
    if (summary) summary.style.display = "none";
    shell.dataset.jrideTakeoutContactExpanded = "true";
    shell.dataset.jrideTakeoutContactForced = "true";
    return;
  }

  if (shell.dataset.jrideTakeoutContactForced === "true") {
    delete shell.dataset.jrideTakeoutContactExpanded;
    delete shell.dataset.jrideTakeoutContactForced;
  }

  if (!summary) {
    summary = document.createElement("div");
    summary.dataset.jrideTakeoutContactSummary = "true";
    summary.className = "jride-takeout-mobile-only";

    const copy = document.createElement("div");
    copy.dataset.jrideTakeoutContactCopy = "true";

    const eyebrow = document.createElement("div");
    eyebrow.dataset.jrideTakeoutContactEyebrow = "true";
    eyebrow.textContent = "Passenger";

    const value = document.createElement("div");
    value.dataset.jrideTakeoutContactValue = "true";

    const note = document.createElement("div");
    note.dataset.jrideTakeoutContactNote = "true";

    copy.appendChild(eyebrow);
    copy.appendChild(value);
    copy.appendChild(note);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.dataset.jrideTakeoutContactToggle = "true";
    toggle.addEventListener("click", () => {
      delete shell.dataset.jrideTakeoutContactForced;
      const expanded = shell.dataset.jrideTakeoutContactExpanded === "true";
      if (expanded) {
        delete shell.dataset.jrideTakeoutContactExpanded;
      } else {
        shell.dataset.jrideTakeoutContactExpanded = "true";
        window.setTimeout(() => {
          nameWrap.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 30);
      }
      ensureContactSummary(shell);
    });

    summary.appendChild(copy);
    summary.appendChild(toggle);
    nameWrap.parentElement?.insertBefore(summary, nameWrap);
  }

  summary.style.display = "";
  const value = summary.querySelector<HTMLElement>("[data-jride-takeout-contact-value='true']");
  const note = summary.querySelector<HTMLElement>("[data-jride-takeout-contact-note='true']");
  const toggle = summary.querySelector<HTMLButtonElement>("[data-jride-takeout-contact-toggle='true']");
  const readOnly = nameInput.readOnly && phoneInput.readOnly;

  setElementText(value, name + " | " + maskPhone(phone));
  setElementText(note, readOnly ? "From your passenger profile" : "Check before submitting");
  setButtonText(
    toggle,
    shell.dataset.jrideTakeoutContactExpanded === "true"
      ? "Hide"
      : readOnly
        ? "Details"
        : "Edit",
  );
}

function markAddressControls(shell: HTMLElement) {
  const deliveryLabel = Array.from(shell.querySelectorAll<HTMLLabelElement>("label")).find(
    (label) =>
      elementText(label) === "Delivery details" &&
      label.className.includes("uppercase"),
  );
  const deliveryRow = deliveryLabel?.parentElement;
  if (deliveryRow instanceof HTMLElement) {
    deliveryRow.dataset.jrideTakeoutAddressHeader = "true";
    const refresh = Array.from(deliveryRow.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => elementText(button) === "Refresh saved" || elementText(button) === "Refresh",
    );
    if (refresh) {
      refresh.dataset.jrideTakeoutRefreshSaved = "true";
      setButtonText(refresh, "Refresh");
    }
  }

  const modeRadio = shell.querySelector<HTMLInputElement>('input[name="addrMode"]');
  const modeRow = modeRadio?.parentElement?.parentElement;
  if (modeRow instanceof HTMLElement) {
    modeRow.dataset.jrideTakeoutAddressMode = "true";
    Array.from(modeRow.querySelectorAll<HTMLLabelElement>("label")).forEach((label) => {
      label.dataset.jrideTakeoutAddressModeOption = "true";
      const span = label.querySelector<HTMLElement>("span");
      const value = elementText(span);
      if (value === "Use saved address") setElementText(span, "Saved address");
      if (value === "Enter a new address") setElementText(span, "New address");
    });
  }

  Array.from(shell.querySelectorAll<HTMLElement>("div")).forEach((element) => {
    const value = elementText(element);
    if (value === "(Pilot mode: tied to this device key)") {
      element.dataset.jrideTakeoutPilotText = "true";
    }
    if (value.startsWith("Using:") && element.className.includes("text-[11px]")) {
      element.dataset.jrideTakeoutUsingAddress = "true";
    }
  });

  const primaryTitle = findExact<HTMLElement>(shell, "div", "Primary address");
  let primaryCard: HTMLElement | null = primaryTitle?.parentElement || null;
  while (primaryCard && primaryCard !== shell) {
    if (primaryCard.className.includes("bg-slate-50") && primaryCard.className.includes("border")) {
      primaryCard.dataset.jrideTakeoutPrimaryAddress = "true";
      break;
    }
    primaryCard = primaryCard.parentElement;
  }
}

function markPinCard(shell: HTMLElement) {
  const title = findExact<HTMLElement>(shell, "div", "Exact delivery location");
  const left = title?.parentElement;
  const row = left?.parentElement;
  const card = row?.parentElement;
  if (!(card instanceof HTMLElement) || !(left instanceof HTMLElement) || !(row instanceof HTMLElement)) return;

  card.dataset.jrideTakeoutPinCard = "true";
  const description = Array.from(left.children).find(
    (child) => elementText(child).startsWith("Set the exact drop-off pin"),
  );
  if (description instanceof HTMLElement) {
    description.dataset.jrideTakeoutPinDescription = "true";
  }

  const button = row.querySelector<HTMLButtonElement>("button");
  if (button) {
    button.dataset.jrideTakeoutPinToggle = "true";
    const label = elementText(button);
    if (label === "Change exact location") setButtonText(button, "Change pin");
    if (label === "Set exact location") setButtonText(button, "Set pin");
    card.dataset.jrideTakeoutPinOpen = label === "Hide map" ? "true" : "false";
  }

  const status = Array.from(card.children).find((child) => {
    const value = elementText(child);
    return value.startsWith("Exact delivery location selected") ||
      value.startsWith("Exact delivery location saved") ||
      value.startsWith("Exact delivery location confirmed");
  });

  const statusText = elementText(status || null);
  const confirmed =
    statusText.startsWith("Exact delivery location saved") ||
    statusText.startsWith("Exact delivery location confirmed");

  if (status instanceof HTMLElement) {
    status.dataset.jrideTakeoutPinStatus = "true";
  }
  card.dataset.jrideTakeoutPinConfirmed = confirmed ? "true" : "false";

  let badge = left.querySelector<HTMLElement>("[data-jride-takeout-pin-badge='true']");
  if (confirmed) {
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.jrideTakeoutPinBadge = "true";
      badge.textContent = "Pin confirmed";
      left.appendChild(badge);
    }
  } else {
    badge?.remove();
  }
}

function markCart(shell: HTMLElement) {
  const cart = shell.querySelector<HTMLElement>(".jride-takeout-cart");
  if (!cart) return;
  cart.dataset.jrideTakeoutCartCompact = "true";

  const primaryButton = Array.from(cart.children).find(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
  );
  if (primaryButton) primaryButton.dataset.jrideTakeoutPrimaryCta = "true";
}

function applyMobileAssist() {
  const shell = document.querySelector<HTMLElement>(".jride-takeout-page");
  if (!shell) return;

  shell.dataset.jrideTakeoutMobileReady = "true";
  markDeliveryHeader(shell);
  ensureContactSummary(shell);
  markAddressControls(shell);
  markPinCard(shell);
  markCart(shell);
}

const MOBILE_STYLES = `
.jride-takeout-mobile-only { display: none; }

@media (max-width: 639px) {
  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] {
    padding-bottom: 7.25rem !important;
  }

  [data-jride-takeout-delivery-stage-header="true"] {
    padding: 0.65rem 0.75rem !important;
  }

  [data-jride-takeout-delivery-step="true"],
  [data-jride-takeout-delivery-header-description="true"] {
    display: none !important;
  }

  [data-jride-takeout-delivery-stage-header="true"] .text-lg {
    font-size: 0.95rem !important;
    line-height: 1.2 !important;
  }

  [data-jride-takeout-contact-summary="true"] {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 0.9rem;
    background: rgba(2, 6, 23, 0.72);
    padding: 0.7rem 0.75rem;
  }

  [data-jride-takeout-contact-copy="true"] {
    min-width: 0;
    flex: 1 1 auto;
  }

  [data-jride-takeout-contact-eyebrow="true"] {
    color: #86efac;
    font-size: 0.62rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  [data-jride-takeout-contact-value="true"] {
    margin-top: 0.15rem;
    overflow: hidden;
    color: #f8fafc;
    font-size: 0.84rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  [data-jride-takeout-contact-note="true"] {
    margin-top: 0.1rem;
    color: #94a3b8;
    font-size: 0.64rem;
    font-weight: 600;
  }

  [data-jride-takeout-contact-toggle="true"] {
    min-height: 2.45rem;
    flex: 0 0 auto;
    border: 1px solid rgba(52, 211, 153, 0.42) !important;
    border-radius: 0.75rem !important;
    background: rgba(6, 20, 28, 0.9) !important;
    padding: 0.55rem 0.7rem !important;
    color: #d1fae5 !important;
    font-size: 0.72rem !important;
    font-weight: 900 !important;
    box-shadow: none !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"]:not([data-jride-takeout-contact-expanded="true"]) [data-jride-takeout-contact-field] {
    display: none !important;
  }

  .jride-takeout-page[data-jride-takeout-contact-expanded="true"] [data-jride-takeout-contact-summary="true"] {
    margin-bottom: 0.1rem;
  }

  [data-jride-takeout-address-header="true"] {
    margin-top: 0.1rem;
  }

  [data-jride-takeout-refresh-saved="true"] {
    min-height: 2.35rem !important;
    padding: 0.45rem 0.7rem !important;
    font-size: 0.7rem !important;
  }

  [data-jride-takeout-address-mode="true"] {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem !important;
    margin-top: 0.45rem !important;
  }

  [data-jride-takeout-address-mode-option="true"] {
    min-height: 2.75rem;
    justify-content: center;
    gap: 0.45rem !important;
    border: 1px solid rgba(148, 163, 184, 0.32);
    border-radius: 0.8rem;
    background: rgba(15, 23, 42, 0.64);
    padding: 0.55rem 0.6rem;
    color: #e2e8f0;
    font-size: 0.72rem !important;
    font-weight: 800;
  }

  [data-jride-takeout-address-mode-option="true"] input {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    accent-color: #22c55e;
  }

  [data-jride-takeout-primary-address="true"] {
    margin-top: 0.5rem !important;
    padding: 0.7rem 0.75rem !important;
    border-radius: 0.9rem !important;
  }

  [data-jride-takeout-pilot-text="true"],
  [data-jride-takeout-using-address="true"] {
    display: none !important;
  }

  [data-jride-takeout-pin-card="true"] {
    margin-top: 0.5rem !important;
  }

  [data-jride-takeout-pin-card="true"][data-jride-takeout-pin-confirmed="true"][data-jride-takeout-pin-open="false"] {
    padding: 0.65rem 0.75rem !important;
    border-color: rgba(34, 197, 94, 0.32) !important;
    background: rgba(6, 78, 59, 0.12) !important;
  }

  [data-jride-takeout-pin-card="true"][data-jride-takeout-pin-confirmed="true"][data-jride-takeout-pin-open="false"] [data-jride-takeout-pin-description="true"],
  [data-jride-takeout-pin-card="true"][data-jride-takeout-pin-confirmed="true"][data-jride-takeout-pin-open="false"] [data-jride-takeout-pin-status="true"] {
    display: none !important;
  }

  [data-jride-takeout-pin-badge="true"] {
    display: inline-flex;
    margin-top: 0.2rem;
    border: 1px solid rgba(52, 211, 153, 0.34);
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.12);
    padding: 0.18rem 0.45rem;
    color: #86efac;
    font-size: 0.62rem;
    font-weight: 900;
  }

  [data-jride-takeout-pin-card="true"][data-jride-takeout-pin-open="true"] [data-jride-takeout-pin-badge="true"] {
    display: none !important;
  }

  [data-jride-takeout-pin-toggle="true"] {
    min-height: 2.5rem !important;
    padding: 0.5rem 0.7rem !important;
    font-size: 0.7rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] {
    padding: 0.45rem 0.75rem calc(0.45rem + env(safe-area-inset-bottom, 0px)) !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"]::before {
    left: 0.75rem !important;
    top: 0.55rem !important;
    width: 1.85rem !important;
    height: 1.85rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"]::after {
    left: 1.18rem !important;
    top: 1.12rem !important;
    font-size: 0.55rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] > div:first-child {
    align-items: center !important;
    gap: 0.6rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] > div:first-child > div:first-child {
    padding-left: 2.45rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] [data-jride-takeout-primary-cta="true"] {
    min-height: 2.75rem !important;
    margin-top: 0.45rem !important;
    padding: 0.55rem 0.75rem !important;
    border-radius: 0.85rem !important;
    font-size: 0.82rem !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] [role="alert"] {
    margin-top: 0.4rem !important;
    padding: 0.45rem 0.6rem !important;
    font-size: 0.68rem !important;
    line-height: 1.25 !important;
  }

  .jride-takeout-page[data-jride-takeout-mobile-ready="true"] .jride-takeout-cart[data-jride-takeout-cart-compact="true"] > [data-jride-takeout-primary-cta="true"] + div {
    margin-top: 0.25rem !important;
    font-size: 0.62rem !important;
  }
}
`;

export default function TakeoutPassengerMobileAssist() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/takeout") return;

    let frame = 0;
    let timer: number | null = null;

    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applyMobileAssist();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    timer = window.setInterval(schedule, 1000);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearInterval(timer);
      observer.disconnect();
    };
  }, [pathname]);

  if (pathname !== "/takeout") return null;
  return <style>{MOBILE_STYLES}</style>;
}

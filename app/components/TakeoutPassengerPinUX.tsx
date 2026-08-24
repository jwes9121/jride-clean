"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function textOf(element: Element | null): string {
  return clean(element?.textContent);
}

function findExact<T extends Element>(
  root: ParentNode,
  selector: string,
  labels: string[],
): T | null {
  return (
    Array.from(root.querySelectorAll<T>(selector)).find((element) =>
      labels.includes(textOf(element)),
    ) || null
  );
}

function setText(element: HTMLElement | null, value: string) {
  if (element && textOf(element) !== value) element.textContent = value;
}

function applyPinUx() {
  const shell = document.querySelector<HTMLElement>(".jride-takeout-page");
  if (!shell) return;

  const title = findExact<HTMLElement>(shell, "div", ["Exact delivery location"]);
  const left = title?.parentElement;
  const row = left?.parentElement;
  const card = row?.parentElement;
  if (!(card instanceof HTMLElement) || !(row instanceof HTMLElement)) {
    delete shell.dataset.jrideTakeoutPinConfirmationRequired;
    return;
  }

  card.dataset.jrideTakeoutPinUx = "true";

  const status = Array.from(card.children).find((child) => {
    const value = textOf(child);
    return (
      value.startsWith("Exact delivery location selected") ||
      value.startsWith("Exact delivery location saved") ||
      value.startsWith("Exact delivery location confirmed")
    );
  });
  const statusText = textOf(status || null);
  const needsConfirmation = statusText.startsWith(
    "Exact delivery location selected",
  );

  shell.dataset.jrideTakeoutPinConfirmationRequired = needsConfirmation
    ? "true"
    : "false";

  const toggle = row.querySelector<HTMLButtonElement>("button");
  if (toggle) {
    const label = textOf(toggle);
    if (label === "Change exact location") setText(toggle, "Change pin");
    if (label === "Set exact location") setText(toggle, "Set pin");
  }

  const confirmButton = findExact<HTMLButtonElement>(card, "button", [
    "Confirm location",
    "Use this location",
  ]);
  if (confirmButton) {
    confirmButton.dataset.jrideTakeoutUseThisLocation = "true";
    setText(confirmButton, "Use this location");
  }

  const adjustButton = findExact<HTMLButtonElement>(card, "button", [
    "Adjust location",
  ]);
  if (adjustButton) {
    adjustButton.dataset.jrideTakeoutRedundantAdjustLocation = "true";
  }

  const cart = shell.querySelector<HTMLElement>(".jride-takeout-cart");
  if (!cart) return;

  const primaryButton =
    cart.querySelector<HTMLButtonElement>("[data-jride-takeout-primary-cta='true']") ||
    Array.from(cart.children).find(
      (child): child is HTMLButtonElement => child instanceof HTMLButtonElement,
    ) ||
    null;

  if (primaryButton) {
    primaryButton.dataset.jrideTakeoutPinAwareCartCta = "true";
    const helper = primaryButton.nextElementSibling;
    if (helper instanceof HTMLElement) {
      helper.dataset.jrideTakeoutPinAwareCartHelper = "true";
    }
  }
}

const STYLES = `
@media (max-width: 639px) {
  [data-jride-takeout-redundant-adjust-location="true"] {
    display: none !important;
  }

  [data-jride-takeout-use-this-location="true"] {
    width: 100% !important;
    min-height: 2.8rem !important;
    border-radius: 0.85rem !important;
    background: linear-gradient(135deg, #86efac 0%, #22c55e 48%, #14b8a6 100%) !important;
    color: #061014 !important;
    font-weight: 900 !important;
  }

  .jride-takeout-page[data-jride-takeout-pin-confirmation-required="true"]
    [data-jride-takeout-pin-aware-cart-cta="true"],
  .jride-takeout-page[data-jride-takeout-pin-confirmation-required="true"]
    [data-jride-takeout-pin-aware-cart-helper="true"] {
    display: none !important;
  }
}
`;

export default function TakeoutPassengerPinUX() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/takeout") return;

    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        applyPinUx();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  if (pathname !== "/takeout") return null;
  return <style>{STYLES}</style>;
}

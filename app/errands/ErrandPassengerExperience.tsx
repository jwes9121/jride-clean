"use client";

import * as React from "react";

const TEXT_REPLACEMENTS = new Map<string, string>([
  ["Errand pilot is not enabled yet", "Errand is temporarily unavailable"],
  [
    "The booking backend remains safely gated. This page will become active when the Errand pilot flag is enabled.",
    "Please try again later or contact JRide support.",
  ],
  ["New Errand", "Request an Errand"],
  ["final_recipient_met", "Recipient met - completing handoff"],
  ["Add task stop", "+ Add stop"],
  [
    "Task Stop 1 is included. Each confirmed task stop after Task Stop 1 currently adds PHP 40.",
    "Task Stop 1 is included. Each additional confirmed task stop adds PHP 40.",
  ],
  [
    "Pickup-distance surcharge is based on the driver's routed road distance to this pin.",
    "Your approach charge is based on the driver's road distance to this meeting point. The PHP 40 minimum is not added again when the pickup-distance charge is higher.",
  ],
  [
    "JRide will keep the Errand in matching; it will not silently pull a driver from another town.",
    "JRide is looking for an eligible driver from your meeting-point town.",
  ],
  [
    "Check the task stops, cargo and starting fare above. After confirmation there is no normal edit flow; exceptions require explicit handling.",
    "Check the task stops, cargo and starting fare above. After confirmation, changes must be arranged through JRide support.",
  ],
  [
    "51-100 kg is Extra Heavy, tricycle-only and optional to the driver.",
    "51-100 kg requires a tricycle and is subject to driver acceptance.",
  ],
  [
    "Above 25 kg requires a tricycle for the current working policy.",
    "Above 25 kg requires a tricycle.",
  ],
  [
    "16-25 kg is a working Heavy Load tier. Motorcycle still depends on safe fit and securing.",
    "16-25 kg is a heavy load. Motorcycle use still depends on safe fit and securing.",
  ],
  ["Working field-test pricing", "How your fare is calculated"],
  ["Base: PHP 40 candidate", "Minimum approach charge: PHP 40"],
  [
    "Confirmed Errand route: PHP 15/km candidate",
    "Route distance: PHP 15 per kilometer",
  ],
  [
    "Task Stop 1 included; +PHP 40 each additional task stop",
    "Task Stop 1 is included; PHP 40 for each additional task stop",
  ],
  [
    "Waiting: first 15 cumulative minutes free; then PHP 20 per started 15 minutes",
    "Waiting: first 15 total minutes are free; then PHP 20 per started 15-minute block",
  ],
  [
    "Pickup distance uses the existing JRide pickup surcharge separately",
    "Approach charge: PHP 40 minimum, or the driver's pickup-distance charge when that amount is higher. They are not added together.",
  ],
  [
    "The in-person task review determines the exact starting fare. Field-test rates can still be adjusted before public rollout.",
    "The driver reviews the task and confirms the starting fare with you before the Errand begins.",
  ],
  [
    "The driver is waiting for the final recipient or customer handoff.",
    "Waiting for the driver to confirm Recipient Met. Billable waiting continues until JRide records that checkpoint.",
  ],
]);

function normalizedText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function replaceVisibleText(): void {
  const root = document.body;
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const parent = node.parentElement;
    const tagName = parent?.tagName || "";

    if (
      parent &&
      !["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION"].includes(tagName)
    ) {
      const original = node.nodeValue || "";
      const clean = normalizedText(original);
      const replacement = TEXT_REPLACEMENTS.get(clean);

      if (replacement && replacement !== clean) {
        const leading = original.match(/^\s*/)?.[0] || "";
        const trailing = original.match(/\s*$/)?.[0] || "";
        node.nodeValue = `${leading}${replacement}${trailing}`;
      }
    }

    node = walker.nextNode();
  }
}

function hideUnavailableAccompaniedErrand(): void {
  const candidates = Array.from(document.querySelectorAll("div"));
  const heading = candidates.find(
    (element) => normalizedText(element.textContent) === "Accompanied Errand"
  );

  const card = heading?.parentElement;
  if (!card) return;

  const cardText = normalizedText(card.textContent);
  if (!cardText.includes("Not enabled in this test slice yet")) return;

  card.hidden = true;
  card.setAttribute("aria-hidden", "true");
  card.setAttribute("data-jride-hidden-unavailable-feature", "accompanied-errand");
}

function removeExitOnlyFetchError(): void {
  const candidates = Array.from(document.querySelectorAll("div"));
  for (const element of candidates) {
    if (normalizedText(element.textContent) !== "Failed to fetch") continue;
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
  }
}

function applyPassengerCleanup(): void {
  replaceVisibleText();
  hideUnavailableAccompaniedErrand();
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function syntheticCurrentErrandResponse(): Response {
  return new Response(JSON.stringify({ ok: true, errand: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export default function ErrandPassengerExperience() {
  React.useEffect(() => {
    let leaving = false;
    const originalFetch = window.fetch.bind(window);

    const markLeaving = () => {
      leaving = true;
      removeExitOnlyFetchError();
    };

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      try {
        return await originalFetch(input, init);
      } catch (error) {
        const url = requestUrl(input);
        if (leaving && url.includes("/api/passenger/errand/current")) {
          return syntheticCurrentErrandResponse();
        }
        throw error;
      }
    };

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const control = target.closest("button, a");
      if (!control) return;

      if (normalizedText(control.textContent) === "Back to Passenger") {
        markLeaving();
      }
    };

    window.fetch = wrappedFetch;
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("pagehide", markLeaving);

    const observer = new MutationObserver(() => {
      applyPassengerCleanup();
      if (leaving) removeExitOnlyFetchError();
    });

    applyPassengerCleanup();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      leaving = true;
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pagehide", markLeaving);
      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  return null;
}

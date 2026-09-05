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

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
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

function hideExactMapDebugElements(): void {
  for (const element of Array.from(document.querySelectorAll("div"))) {
    const content = normalizedText(element.textContent);
    if (/^GPS points:\s*\d+$/i.test(content) && element.children.length === 0) {
      (element as HTMLElement).style.display = "none";
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("data-jride-hidden-map-debug", "gps-points");
    }
  }

  for (const grid of Array.from(document.querySelectorAll("div"))) {
    if (grid.children.length !== 4) continue;
    const childTexts = Array.from(grid.children).map((child) =>
      normalizedText(child.textContent)
    );
    const exactLegend =
      childTexts[0]?.startsWith("Teal solid:") &&
      childTexts[1]?.startsWith("Gray dashed:") &&
      childTexts[2]?.startsWith("Green solid:") &&
      childTexts[3]?.startsWith("Blue dashed:");
    if (!exactLegend) continue;
    (grid as HTMLElement).style.display = "none";
    grid.setAttribute("aria-hidden", "true");
    grid.setAttribute("data-jride-hidden-map-debug", "route-legend");
  }
}

function removeExitOnlyFetchError(): void {
  const candidates = Array.from(document.querySelectorAll("div"));
  for (const element of candidates) {
    if (normalizedText(element.textContent) !== "Failed to fetch") continue;
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
  }
}

function dismissKeyboard(): void {
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    active.blur();
  }
}

function currentRequestStep(): number | null {
  const body = normalizedText(document.body?.innerText);
  if (body.includes("Where should the driver meet you?")) return 0;
  if (body.includes("What should the driver do?")) return 1;
  if (body.includes("Task stops") && body.includes("Where should the Errand end?")) return 2;
  if (body.includes("Errand type") && body.includes("Weight and vehicle")) return 3;
  if (body.includes("Review your Errand")) return 4;
  return null;
}

function visibleInputByPlaceholder(placeholder: string): HTMLInputElement | null {
  const input = Array.from(document.querySelectorAll("input")).find(
    (candidate) =>
      candidate.getAttribute("placeholder") === placeholder && isVisible(candidate)
  );
  return input instanceof HTMLInputElement ? input : null;
}

function locationFieldHasCommittedPin(input: HTMLInputElement | null): boolean {
  if (!input) return false;
  const field = input.closest("div.space-y-2") || input.parentElement?.parentElement;
  if (!field) return false;
  return Array.from(field.querySelectorAll("span")).some(
    (span) => isVisible(span) && normalizedText(span.textContent) === "Pin set"
  );
}

function missingForCurrentStep(step: number | null): string[] {
  if (step == null) return [];

  if (step === 0) {
    const meeting = visibleInputByPlaceholder("Search or pin your meeting point");
    return locationFieldHasCommittedPin(meeting)
      ? []
      : ["Customer meeting point (select a search result or set the map pin)"];
  }

  if (step === 1) {
    const textarea = Array.from(document.querySelectorAll("textarea")).find(isVisible);
    const task = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : "";
    return task.length >= 3 ? [] : ["Task description (at least 3 characters)"];
  }

  if (step === 2) {
    const missing: string[] = [];
    const stopInputs = Array.from(
      document.querySelectorAll('input[placeholder="Search store, office, house or destination"]')
    ).filter(isVisible) as HTMLInputElement[];

    stopInputs.forEach((input, index) => {
      if (!locationFieldHasCommittedPin(input)) {
        missing.push(`Task Stop ${index + 1} location (select or pin it)`);
      }
    });

    const finalInput = visibleInputByPlaceholder("Search final destination");
    if (finalInput && !locationFieldHasCommittedPin(finalInput)) {
      missing.push("Final destination (select or pin it)");
    }
    return missing;
  }

  if (step === 3) {
    const missing: string[] = [];
    const cargo = visibleInputByPlaceholder("0");
    const cargoText = cargo?.value.trim() || "";
    const cargoValue = cargoText === "" ? null : Number(cargoText);

    if (cargoValue == null || !Number.isFinite(cargoValue)) {
      missing.push("Cargo weight (enter 0 if there is no cargo)");
    } else if (cargoValue < 0) {
      missing.push("Cargo weight cannot be negative");
    } else if (cargoValue > 100) {
      missing.push("Cargo weight must be 100 kg or less");
    }

    const pabiliAmount = visibleInputByPlaceholder("PHP 0");
    if (pabiliAmount) {
      const amount = Number(pabiliAmount.value);
      if (!pabiliAmount.value.trim() || !Number.isFinite(amount) || amount <= 0) {
        missing.push("Estimated Pabili purchase amount (more than PHP 0)");
      }
    }

    return missing;
  }

  return [];
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
  const [validationItems, setValidationItems] = React.useState<string[]>([]);
  const [confirmLabel, setConfirmLabel] = React.useState("");
  const [confirmDisabled, setConfirmDisabled] = React.useState(false);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const validationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let leaving = false;
    const originalFetch = window.fetch.bind(window);

    const showValidation = (items: string[]) => {
      if (!items.length) return;
      setValidationItems(items);
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
      validationTimerRef.current = setTimeout(() => setValidationItems([]), 7000);
    };

    const syncActionState = () => {
      replaceVisibleText();
      hideUnavailableAccompaniedErrand();
      hideExactMapDebugElements();

      const buttons = Array.from(document.querySelectorAll("button"));
      const confirmButton = buttons.find((button) => {
        const label = normalizedText(button.textContent);
        return /^Confirm PHP\s+/i.test(label) || label === "Confirming...";
      });

      if (confirmButton instanceof HTMLButtonElement && isVisible(confirmButton)) {
        confirmButtonRef.current = confirmButton;
        setConfirmLabel(normalizedText(confirmButton.textContent));
        setConfirmDisabled(confirmButton.disabled);
      } else {
        confirmButtonRef.current = null;
        setConfirmLabel("");
        setConfirmDisabled(false);
      }

      const step = currentRequestStep();
      const missing = missingForCurrentStep(step);

      for (const button of buttons) {
        const label = normalizedText(button.textContent);
        if (label !== "Continue" && label !== "Request Errand") continue;

        if (button.disabled || missing.length > 0) {
          button.disabled = false;
          button.setAttribute("data-jride-explain-disabled", "1");
          button.setAttribute("aria-disabled", "true");
        } else {
          button.removeAttribute("data-jride-explain-disabled");
          button.removeAttribute("aria-disabled");
        }
      }
    };

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
      const label = normalizedText(control.textContent);

      if (label === "Back to Passenger") {
        markLeaving();
        return;
      }

      if (label === "Continue" || label === "Request Errand") {
        dismissKeyboard();
        const step = currentRequestStep();
        const missing = missingForCurrentStep(step);
        const wasOriginallyDisabled =
          control.getAttribute("data-jride-explain-disabled") === "1";

        if (missing.length || wasOriginallyDisabled) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          showValidation(
            missing.length
              ? missing
              : ["Complete the required information in this step before continuing"]
          );
        }
      }
    };

    window.fetch = wrappedFetch;
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("pagehide", markLeaving);

    const observer = new MutationObserver(syncActionState);

    syncActionState();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden", "style"],
    });

    return () => {
      leaving = true;
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pagehide", markLeaving);
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  return (
    <>
      {validationItems.length ? (
        <div className="fixed inset-x-3 bottom-24 z-[95] mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-4 shadow-2xl shadow-slate-950/20">
          <div className="text-xs font-black uppercase tracking-[0.14em] text-red-700">
            Please complete the following
          </div>
          <div className="mt-2 space-y-1.5 text-sm font-semibold text-slate-800">
            {validationItems.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {confirmLabel ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] px-3 pb-3">
          <div className="mx-auto max-w-xl rounded-[24px] border border-amber-300 bg-slate-950 p-3 shadow-[0_-12px_40px_rgba(15,23,42,0.28)]">
            <div className="mb-2 text-center text-[10px] font-black uppercase tracking-[0.14em] text-amber-300">
              Your confirmation is needed
            </div>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => confirmButtonRef.current?.click()}
              className="w-full rounded-2xl bg-emerald-400 py-3.5 text-sm font-black text-slate-950 disabled:opacity-60"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

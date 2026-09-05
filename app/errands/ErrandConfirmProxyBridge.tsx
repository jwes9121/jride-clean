"use client";

import * as React from "react";

function labelOf(element: Element | null): string {
  return String(element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isConfirmButton(element: Element | null): element is HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) return false;
  const label = labelOf(element);
  return /^Confirm PHP\s+/i.test(label) || label === "Confirming...";
}

function fixedAncestor(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement || null;
  while (current && current !== document.body) {
    if (window.getComputedStyle(current).position === "fixed") return current;
    current = current.parentElement;
  }
  return null;
}

function findRealConfirmButton(proxy?: HTMLButtonElement | null): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    if (!isConfirmButton(button)) continue;
    if (proxy && button === proxy) continue;
    if (fixedAncestor(button)) continue;
    return button;
  }
  return null;
}

function findStickyConfirmButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    if (!isConfirmButton(button)) continue;
    if (fixedAncestor(button)) return button;
  }
  return null;
}

export default function ErrandConfirmProxyBridge() {
  React.useEffect(() => {
    const sync = () => {
      const sticky = findStickyConfirmButton();
      if (!sticky) return;

      const wrapper = fixedAncestor(sticky);
      const real = findRealConfirmButton(sticky);

      if (wrapper) {
        const nextDisplay = real ? "" : "none";
        if (wrapper.style.display !== nextDisplay) {
          wrapper.style.display = nextDisplay;
        }
      }
    };

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest("button");
      if (!isConfirmButton(button)) return;
      if (!fixedAncestor(button)) return;

      const real = findRealConfirmButton(button);
      if (!real || real.disabled) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      real.click();
    };

    document.addEventListener("click", onClickCapture, true);

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden"],
    });

    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  return null;
}

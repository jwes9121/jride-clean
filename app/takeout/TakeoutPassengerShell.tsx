"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function TakeoutPassengerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOrderingPage = pathname === "/takeout";

  useEffect(() => {
    if (!isOrderingPage) return;

    document.documentElement.classList.add("jride-takeout-unified-v1");
    document.body.classList.add("jride-takeout-unified-v1");

    const syncPresentation = () => {
      const page = document.querySelector<HTMLElement>(".jride-takeout-page");
      if (!page) return;

      page.dataset.jrideUnifiedTakeout = "1";

      page.querySelectorAll<HTMLElement>("div").forEach((node) => {
        const value = (node.textContent || "").trim();
        if (/^Step [1-4]$/.test(value)) {
          node.dataset.jrideStepLabel = "1";
        }
      });

      const vendorSection = page.querySelector<HTMLElement>(".jride-vendor-menu-section");
      if (vendorSection) {
        const waitingForTown = (vendorSection.textContent || "").includes("Choose your town first.");
        vendorSection.dataset.jrideTownReady = waitingForTown ? "0" : "1";
      }

      const menuSection = page.querySelector<HTMLElement>(".jride-menu-section");
      if (menuSection) {
        const waitingForStore = (menuSection.textContent || "").includes("Choose a store first.");
        menuSection.dataset.jrideStoreReady = waitingForStore ? "0" : "1";
      }
    };

    syncPresentation();

    const observer = new MutationObserver(() => syncPresentation());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("jride-takeout-unified-v1");
      document.body.classList.remove("jride-takeout-unified-v1");
    };
  }, [isOrderingPage]);

  return (
    <div className="jride-takeout-route-shell">
      {isOrderingPage ? (
        <header className="jride-takeout-service-header">
          <div className="min-w-0">
            <div className="jride-takeout-eyebrow">JRIDE PASSENGER</div>
            <h1>Order Food</h1>
            <p>Choose a store, add items, and review your delivery.</p>
          </div>
          <nav aria-label="Takeout service navigation">
            <Link href="/passenger">Home</Link>
            <Link href="/takeout/orders">Orders</Link>
          </nav>
        </header>
      ) : null}
      {children}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function normalize(value: string | null | undefined) {
  return String(value || "").trim();
}

export default function TakeoutPassengerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOrderingPage = pathname === "/takeout";
  const isOrdersPage = pathname === "/takeout/orders";
  const isOrderDetailPage =
    pathname?.startsWith("/takeout/orders/") ||
    pathname?.startsWith("/takeout/track/");
  const showPassengerNavigation = isOrderingPage || isOrdersPage || isOrderDetailPage;
  const pageTitle = isOrderingPage ? "Order Food" : isOrdersPage ? "My orders" : "Order details";

  useEffect(() => {
    if (!isOrderingPage) return;

    document.documentElement.classList.add("jride-takeout-unified-v1");
    document.body.classList.add("jride-takeout-unified-v1");

    const syncPresentation = () => {
      const page = document.querySelector<HTMLElement>(".jride-takeout-page");
      if (!page) return;

      page.dataset.jrideUnifiedTakeout = "1";

      page.querySelectorAll<HTMLElement>("div").forEach((node) => {
        const value = normalize(node.textContent);
        if (/^Step [1-4]$/.test(value)) {
          node.dataset.jrideStepLabel = "1";
        }
      });

      const vendorSection = page.querySelector<HTMLElement>(".jride-vendor-menu-section");
      if (vendorSection) {
        const waitingForTown = normalize(vendorSection.textContent).includes(
          "Choose your town first.",
        );
        vendorSection.dataset.jrideTownReady = waitingForTown ? "0" : "1";
      }

      const menuSection = page.querySelector<HTMLElement>(".jride-menu-section");
      if (menuSection) {
        const waitingForStore = normalize(menuSection.textContent).includes(
          "Choose a store first.",
        );
        menuSection.dataset.jrideStoreReady = waitingForStore ? "0" : "1";
      }

      const cart = page.querySelector<HTMLElement>(".jride-takeout-cart");
      if (cart) {
        const empty = normalize(cart.textContent).includes("Cart empty");
        cart.dataset.jrideCartEmpty = empty ? "1" : "0";
        page.dataset.jrideCartEmpty = empty ? "1" : "0";
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
      {showPassengerNavigation ? (
        <header className="jride-takeout-service-header">
          <div className="min-w-0">
            <div className="jride-takeout-eyebrow">JRIDE PASSENGER</div>
            <h1>{pageTitle}</h1>
            {isOrderingPage ? (
              <p>Choose a store, add items, and review your delivery.</p>
            ) : null}
          </div>
          <nav aria-label="Takeout service navigation">
            {/* Full navigations let Android handle Home and refresh the service page. */}
            <a href="/passenger">Home</a>
            {isOrdersPage ? (
              <a href="/takeout">Order Food</a>
            ) : (
              <a href="/takeout/orders">Orders</a>
            )}
          </nav>
        </header>
      ) : null}
      {children}
    </div>
  );
}

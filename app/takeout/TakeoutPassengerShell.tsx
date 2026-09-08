"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

function normalize(value: string | null | undefined) {
  return String(value || "").trim();
}

export default function TakeoutPassengerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOrderingPage = pathname === "/takeout";

  useEffect(() => {
    if (!isOrderingPage) return;

    document.documentElement.classList.add("jride-takeout-unified-v1");
    document.body.classList.add("jride-takeout-unified-v1");

    const applyStoreSearch = (page: HTMLElement) => {
      const section = page.querySelector<HTMLElement>(".jride-vendor-menu-section");
      const grid = section?.querySelector<HTMLElement>(".jride-vendor-grid");
      if (!section || !grid) return;

      const selectedStore = Boolean(section.querySelector(".ring-2"));
      const vendorButtons = Array.from(
        grid.querySelectorAll<HTMLButtonElement>(":scope > button"),
      );

      let searchWrap = section.querySelector<HTMLElement>("[data-jride-store-search='1']");

      if (selectedStore || vendorButtons.length === 0) {
        searchWrap?.remove();
        vendorButtons.forEach((button) => {
          button.style.removeProperty("display");
        });
        return;
      }

      if (!searchWrap) {
        searchWrap = document.createElement("div");
        searchWrap.dataset.jrideStoreSearch = "1";
        searchWrap.className = "jride-takeout-store-search";
        searchWrap.innerHTML = `
          <label for="jride-takeout-store-search-input">Search stores</label>
          <div class="jride-takeout-store-search-row">
            <input
              id="jride-takeout-store-search-input"
              type="search"
              autocomplete="off"
              placeholder="Search restaurant or store"
            />
            <span data-jride-store-search-count></span>
          </div>
        `;
        grid.parentElement?.insertBefore(searchWrap, grid);

        const input = searchWrap.querySelector<HTMLInputElement>("input");
        input?.addEventListener("input", () => {
          const query = normalize(input.value).toLowerCase();
          let visible = 0;
          const latestGrid = section.querySelector<HTMLElement>(".jride-vendor-grid");
          const latestButtons = latestGrid
            ? Array.from(latestGrid.querySelectorAll<HTMLButtonElement>(":scope > button"))
            : [];
          latestButtons.forEach((button) => {
            const haystack = normalize(button.textContent).toLowerCase();
            const show = !query || haystack.includes(query);
            button.style.display = show ? "" : "none";
            if (show) visible += 1;
          });
          const count = searchWrap?.querySelector<HTMLElement>(
            "[data-jride-store-search-count]",
          );
          if (count) count.textContent = `${visible} ${visible === 1 ? "store" : "stores"}`;
        });
      }

      const input = searchWrap.querySelector<HTMLInputElement>("input");
      const query = normalize(input?.value).toLowerCase();
      let visible = 0;
      vendorButtons.forEach((button) => {
        button.dataset.jrideVendorCard = "1";
        const haystack = normalize(button.textContent).toLowerCase();
        const show = !query || haystack.includes(query);
        button.style.display = show ? "" : "none";
        if (show) visible += 1;
      });
      const count = searchWrap.querySelector<HTMLElement>(
        "[data-jride-store-search-count]",
      );
      if (count) count.textContent = `${visible} ${visible === 1 ? "store" : "stores"}`;
    };

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

      const townButtons = page.querySelectorAll<HTMLButtonElement>(
        ".jride-town-and-vendors > div:first-child .grid.grid-cols-5 button",
      );
      townButtons.forEach((button) => {
        const town = normalize(button.textContent);
        button.dataset.jrideTownCard = "1";
        button.dataset.jrideTown = town;
        button.dataset.jrideSelectedTown = button.className.includes("bg-emerald-600")
          ? "1"
          : "0";
        button.setAttribute("aria-label", `Browse Takeout stores in ${town}`);
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

      applyStoreSearch(page);
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

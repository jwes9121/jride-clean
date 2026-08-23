"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const MENU_CATEGORIES = [
  "Meals",
  "Rice Meals",
  "Noodles",
  "Drinks",
  "Coffee",
  "Bread",
  "Desserts",
  "Snacks",
  "Add-ons",
  "Others",
] as const;

function text(element: Element | null): string {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function directChildren(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}

function portalShell(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".jride-vendor-premium-shell");
}

function sections(): HTMLElement[] {
  const shell = portalShell();
  return shell ? Array.from(shell.querySelectorAll<HTMLElement>("section")) : [];
}

function sectionByHeading(label: string): HTMLElement | null {
  return sections().find((section) => text(section.querySelector("h2")) === label) || null;
}

function findButton(parent: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => text(button) === label,
    ) || null
  );
}

function findMenuEditor(section: HTMLElement): HTMLElement | null {
  return (
    directChildren(section).find((child) =>
      Boolean(child.querySelector('input[placeholder="Example: Chicken adobo"]')),
    ) || null
  );
}

function findMenuGrid(section: HTMLElement, editor: HTMLElement): HTMLElement | null {
  return (
    directChildren(section).find((child) => {
      if (child === editor) return false;
      return Array.from(child.querySelectorAll("button")).some(
        (button) => text(button) === "Edit",
      );
    }) || null
  );
}

function markHeader(shell: HTMLElement) {
  const heading = Array.from(shell.querySelectorAll<HTMLHeadingElement>("h1")).find(
    (node) => text(node) === "Vendor Portal",
  );
  const header = heading?.closest<HTMLElement>("div.rounded-2xl") || null;
  if (!header) return;

  header.dataset.jrideVendorPortalHeader = "true";

  const authCard = Array.from(header.querySelectorAll<HTMLElement>("div")).find(
    (node) => directChildren(node).some((child) => text(child) === "Authenticated vendor"),
  );
  if (authCard) {
    authCard.dataset.jrideVendorAuthCard = "true";
    if (text(authCard).includes("Town not set")) {
      authCard.dataset.jrideLoading = "true";
    } else {
      delete authCard.dataset.jrideLoading;
    }
  }
}

function ensureProfileToggle(profile: HTMLElement) {
  profile.dataset.jrideVendorProfileSection = "true";

  const children = directChildren(profile);
  const header = children.find((child) => text(child.querySelector("h2")) === "Vendor profile") || null;
  const summary = children.find((child) => Boolean(child.querySelector("img")) || text(child).includes("Logo is optional")) || null;
  const details = children.find((child) => text(child).includes("General profile details")) || null;
  const saveButton = Array.from(profile.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => text(button) === "Save profile details",
  ) || null;

  if (summary) {
    summary.dataset.jrideVendorProfileSummary = "true";
    if (text(summary).includes("Town not set")) {
      summary.dataset.jrideLoading = "true";
    } else {
      delete summary.dataset.jrideLoading;
    }
  }
  if (details) details.dataset.jrideVendorProfileDetails = "true";
  if (saveButton) saveButton.dataset.jrideVendorProfileSave = "true";

  if (!header) return;
  let toggle = header.querySelector<HTMLButtonElement>("[data-jride-profile-edit-toggle='true']");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.dataset.jrideProfileEditToggle = "true";
    toggle.className = "jride-profile-edit-toggle";
    toggle.addEventListener("click", () => {
      const expanded = profile.dataset.jrideProfileExpanded === "true";
      if (expanded) {
        delete profile.dataset.jrideProfileExpanded;
        toggle!.textContent = "Edit profile";
      } else {
        profile.dataset.jrideProfileExpanded = "true";
        toggle!.textContent = "Hide profile form";
        window.setTimeout(() => {
          details?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 30);
      }
    });
    header.appendChild(toggle);
  }
  toggle.textContent = profile.dataset.jrideProfileExpanded === "true" ? "Hide profile form" : "Edit profile";
  toggle.style.display = summary?.dataset.jrideLoading === "true" ? "none" : "";
}

function markMenuCards(grid: HTMLElement) {
  directChildren(grid).forEach((card) => {
    if (!Array.from(card.querySelectorAll("button")).some((button) => text(button) === "Edit")) return;
    card.dataset.jrideVendorMenuCard = "true";

    const children = directChildren(card);
    if (children[0]) children[0].dataset.jrideVendorMenuCardImage = "true";
    if (children[1]) {
      children[1].dataset.jrideVendorMenuCardBody = "true";
      directChildren(children[1]).forEach((row) => {
        const value = text(row);
        if (
          value.startsWith("Packaging:") ||
          value.startsWith("Premium packaging available") ||
          value.startsWith("This item is blocked from customer ordering")
        ) {
          row.dataset.jrideVendorMenuSecondary = "true";
        }
        if (row.className.includes("text-sm") && !row.querySelector("button")) {
          row.dataset.jrideVendorMenuDescription = "true";
        }
      });
    }
  });
}

function ensureAddItemToggle(menu: HTMLElement) {
  const editor = findMenuEditor(menu);
  if (!editor) return;
  const grid = findMenuGrid(menu, editor);
  if (!grid) return;

  menu.dataset.jrideVendorMenuSection = "true";
  editor.dataset.jrideMenuEditor = "true";
  grid.dataset.jrideMenuGrid = "true";

  const header = directChildren(menu).find((child) => child !== editor && child !== grid) || null;
  if (header) header.dataset.jrideMenuHeader = "true";

  const categoryPanel = Array.from(editor.querySelectorAll<HTMLElement>("div")).find((node) => {
    const labels = Array.from(node.querySelectorAll("button")).map((button) => text(button));
    const matches = labels.filter((label) => MENU_CATEGORIES.includes(label as any));
    return matches.length >= 5;
  });
  if (categoryPanel) categoryPanel.dataset.jrideMenuCategoryChips = "true";

  const pilotPanel = Array.from(editor.querySelectorAll<HTMLElement>("div")).find(
    (node) => text(node).startsWith("Pilot menu pricing rule"),
  );
  if (pilotPanel) pilotPanel.dataset.jrideMenuPilotRule = "true";

  markMenuCards(grid);

  if (!header) return;
  let addButton = header.querySelector<HTMLButtonElement>("[data-jride-add-item-toggle='true']");
  if (!addButton) {
    addButton = document.createElement("button");
    addButton.type = "button";
    addButton.dataset.jrideAddItemToggle = "true";
    addButton.className = "jride-add-item-toggle";
    addButton.addEventListener("click", () => {
      const adding = menu.dataset.jrideMenuAdding === "true";
      if (adding) {
        delete menu.dataset.jrideMenuAdding;
        findButton(editor, "Clear")?.click();
        addButton!.textContent = "+ Add item";
        return;
      }

      findButton(editor, "Clear")?.click();
      delete menu.dataset.jrideMenuEditing;
      menu.dataset.jrideMenuAdding = "true";
      addButton!.textContent = "Close add item";
      window.setTimeout(() => {
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    });
    header.appendChild(addButton);
  }
  addButton.textContent = menu.dataset.jrideMenuAdding === "true" ? "Close add item" : "+ Add item";
}

function applyCompression() {
  const shell = portalShell();
  if (!shell) return;
  markHeader(shell);

  const profile = sectionByHeading("Vendor profile");
  if (profile) ensureProfileToggle(profile);

  const menu = sectionByHeading("Menu manager");
  if (menu) ensureAddItemToggle(menu);
}

export default function VendorPortalDailyCompression() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/vendor-portal") return;

    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyCompression);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button) return;

      const menu = sectionByHeading("Menu manager");
      if (!menu) return;
      const editor = findMenuEditor(menu);
      const grid = editor ? findMenuGrid(menu, editor) : null;
      if (!editor || !grid) return;

      const label = text(button);
      if (label === "Edit" && grid.contains(button)) {
        delete menu.dataset.jrideMenuAdding;
      }
      if (label === "Clear" && editor.contains(button)) {
        delete menu.dataset.jrideMenuAdding;
      }
      schedule();
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onClick, true);
    schedule();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, [pathname]);

  return null;
}

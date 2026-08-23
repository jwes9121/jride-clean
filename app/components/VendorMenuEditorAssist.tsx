"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const CLOSE_EDITOR_EVENT = "jride:close-vendor-menu-editor";

function elementText(element: Element | null): string {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function findMenuSection(): HTMLElement | null {
  const shell = document.querySelector<HTMLElement>(".jride-vendor-premium-shell");
  if (!shell) return null;

  const sections = Array.from(shell.querySelectorAll<HTMLElement>("section"));
  return (
    sections.find((section) => {
      const heading = section.querySelector("h2");
      return elementText(heading) === "Menu manager";
    }) || null
  );
}

function findDirectChild(
  section: HTMLElement,
  predicate: (element: HTMLElement) => boolean
): HTMLElement | null {
  const children = Array.from(section.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  return children.find(predicate) || null;
}

function findEditor(section: HTMLElement): HTMLElement | null {
  return findDirectChild(section, (child) => {
    return Boolean(
      child.querySelector('input[placeholder="Example: Chicken adobo"]') &&
        child.querySelector("button")
    );
  });
}

function findMenuGrid(section: HTMLElement, editor: HTMLElement): HTMLElement | null {
  return findDirectChild(section, (child) => {
    if (child === editor) return false;
    return Array.from(child.querySelectorAll("button")).some(
      (button) => elementText(button) === "Edit"
    );
  });
}

function findMenuHeader(
  section: HTMLElement,
  editor: HTMLElement,
  menuGrid: HTMLElement
): HTMLElement | null {
  return findDirectChild(
    section,
    (child) => child !== editor && child !== menuGrid
  );
}

function findMenuCard(
  button: HTMLButtonElement,
  menuGrid: HTMLElement
): HTMLElement | null {
  let current: HTMLElement | null = button.parentElement;

  while (current && current.parentElement !== menuGrid) {
    current = current.parentElement;
  }

  return current && current.parentElement === menuGrid ? current : null;
}

function findMenuItemName(card: HTMLElement | null): string {
  if (!card) return "selected item";

  const candidates = Array.from(
    card.querySelectorAll<HTMLElement>("div, h3, h4")
  );

  const title = candidates.find((element) => {
    const text = elementText(element);
    if (!text) return false;
    return element.className.includes("text-lg") && !text.startsWith("PHP ");
  });

  return elementText(title || null) || "selected item";
}

function findButtonByLabel(
  editor: HTMLElement,
  label: string
): HTMLButtonElement | null {
  return (
    Array.from(editor.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => elementText(button) === label
    ) || null
  );
}

export default function VendorMenuEditorAssist() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/vendor-portal") {
      setMobileOpen(false);
      return;
    }

    let section: HTMLElement | null = null;
    let editor: HTMLElement | null = null;
    let menuGrid: HTMLElement | null = null;
    let sectionObserver: MutationObserver | null = null;
    let refreshTimer: number | null = null;
    let editStartedAt = 0;

    const clearVisualState = (resetReactState: boolean) => {
      if (resetReactState && editor) {
        const clearButton = findButtonByLabel(editor, "Clear");
        if (clearButton && !clearButton.disabled) clearButton.click();
      }

      if (section) delete section.dataset.jrideMenuEditing;
      if (editor) {
        editor.classList.remove("jride-menu-editor-mobile-open");
        delete editor.dataset.jrideMenuMode;
        delete editor.dataset.jrideMenuItem;
      }
      if (menuGrid) {
        menuGrid
          .querySelectorAll<HTMLElement>('[data-jride-menu-item-editing="true"]')
          .forEach((card) => delete card.dataset.jrideMenuItemEditing);
      }
      setMobileOpen(false);
    };

    const refreshStructure = () => {
      const nextSection = findMenuSection();
      if (!nextSection) return false;

      const nextEditor = findEditor(nextSection);
      if (!nextEditor) return false;

      const nextMenuGrid = findMenuGrid(nextSection, nextEditor);
      if (!nextMenuGrid) return false;

      const nextHeader = findMenuHeader(nextSection, nextEditor, nextMenuGrid);

      section = nextSection;
      editor = nextEditor;
      menuGrid = nextMenuGrid;

      section.dataset.jrideMenuEnhanced = "true";
      editor.dataset.jrideMenuEditor = "true";
      menuGrid.dataset.jrideMenuGrid = "true";
      if (nextHeader) nextHeader.dataset.jrideMenuHeader = "true";

      if (!sectionObserver) {
        sectionObserver = new MutationObserver(() => {
          if (!section || !editor) return;
          if (section.dataset.jrideMenuEditing !== "true") return;
          if (Date.now() - editStartedAt < 250) return;

          const updateButton = findButtonByLabel(editor, "Update item");
          if (!updateButton) clearVisualState(false);
        });

        sectionObserver.observe(section, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }

      return true;
    };

    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        refreshStructure();
      }, 40);
    };

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest<HTMLButtonElement>("button");
      if (!button) return;

      if (!section || !editor || !menuGrid) refreshStructure();
      if (!section || !editor || !menuGrid || !section.contains(button)) return;

      const label = elementText(button);

      if (label === "Edit" && menuGrid.contains(button)) {
        editStartedAt = Date.now();

        menuGrid
          .querySelectorAll<HTMLElement>('[data-jride-menu-item-editing="true"]')
          .forEach((card) => delete card.dataset.jrideMenuItemEditing);

        const card = findMenuCard(button, menuGrid);
        if (card) card.dataset.jrideMenuItemEditing = "true";

        section.dataset.jrideMenuEditing = "true";
        editor.dataset.jrideMenuMode = "edit";
        editor.dataset.jrideMenuItem = findMenuItemName(card);

        if (window.matchMedia("(max-width: 1023px)").matches) {
          editor.classList.add("jride-menu-editor-mobile-open");
          setMobileOpen(true);
        }

        scheduleRefresh();
        return;
      }

      if (label === "Clear" && editor.contains(button)) {
        clearVisualState(false);
      }
    };

    const onCloseRequest = () => clearVisualState(true);

    const bodyObserver = new MutationObserver(scheduleRefresh);
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener(CLOSE_EDITOR_EVENT, onCloseRequest);
    refreshStructure();

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      bodyObserver.disconnect();
      sectionObserver?.disconnect();
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener(CLOSE_EDITOR_EVENT, onCloseRequest);
      clearVisualState(false);
    };
  }, [pathname]);

  if (!mobileOpen) return null;

  return (
    <button
      type="button"
      className="jride-menu-editor-backdrop"
      aria-label="Close menu item editor"
      onClick={() => window.dispatchEvent(new Event(CLOSE_EDITOR_EVENT))}
    />
  );
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Hook for auto-scrolling a table row into view
 * when it becomes active.
 *
 * Usage:
 *   const rowRef = useActiveRowAutoScroll(isActive);
 *   <tr ref={rowRef} ...>
 */
export const useActiveRowAutoScroll = (isActive: boolean) => {
  const rowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!isActive || !rowRef.current) return;

    try {
      rowRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (error) {
      console.error("Failed to scroll active row into view", error);
    }
  }, [isActive]);

  return rowRef;
};

"use client";

import React from "react";
import { useRouter } from "next/navigation";

export type Props = {
  title?: string;
  /** Show a back button on the left */
  showBack?: boolean;
  /** Custom back handler; defaults to router.back() */
  onBack?: () => void;
  /** Optional right-side content (e.g., actions) */
  rightSlot?: React.ReactNode;
  className?: string;
};

export default function Header({
  title,
  showBack = false,
  onBack,
  rightSlot,
  className,
}: Props) {
  const router = useRouter();
  const handleBack = () => (onBack ? onBack() : router.back());

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 bg-white border-b ${className ?? ""}`}
    >
      <div className="h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {showBack ? (
            <button
              type="button"
              aria-label="Back"
              onClick={handleBack}
              className="rounded p-2 hover:bg-gray-100"
            >
              <span className="sr-only">Back</span>
              â†
            </button>
          ) : null}
          {title ? <h1 className="text-base font-semibold">{title}</h1> : null}
        </div>
        <div>{rightSlot}</div>
      </div>
    </header>
  );
}




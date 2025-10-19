"use client";

import { useMemo } from "react";
import type { RatingKey } from "@/types/survey";

export type StarRatingProps = {
  /** Which category this rating is for (kept so parent knows what changed) */
  category: RatingKey;
  /** Current value 0–5 */
  value: number;
  /** Notify parent when the value changes */
  onChange: (next: number) => void;
  /** Optional max stars, defaults to 5 */
  max?: number;
  /** Optional label for a11y */
  label?: string;
};

/** Clickable 0..N star control. Named export. */
export function StarRating({
  category, // not used internally, but handy for parent callbacks/debug
  value,
  onChange,
  max = 5,
  label = "rating",
}: StarRatingProps) {
  const stars = useMemo(() => Array.from({ length: max }, (_, i) => i + 1), [max]);

  return (
    <div className="flex items-center gap-2" aria-label={label}>
      {stars.map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${label}: ${n}`}
            onClick={() => onChange(n)}
            className={`text-2xl leading-none select-none ${
              filled ? "text-yellow-500" : "text-gray-300"
            } hover:text-yellow-600`}
          >
            ★
          </button>
        );
      })}

      {/* clear button */}
      {value > 0 && (
        <button
          type="button"
          className="ml-2 text-sm text-gray-500 hover:text-gray-700 underline"
          onClick={() => onChange(0)}
        >
          clear
        </button>
      )}
    </div>
  );
}

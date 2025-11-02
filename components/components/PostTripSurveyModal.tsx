"use client";

import { useState } from "react";
import type { RatingKey, Ratings, Question } from "@/types/survey";
import { StarRating } from "./StarRating";

type Props = {
  /** Questions to ask (each must have a RatingKey `key`) */
  questions: Question[];
  /** Optional title shown at the top */
  title?: string;
  /** Initial ratings (optional) */
  initial?: Ratings;
  /** Called when user submits */
  onSubmit?: (ratings: Ratings) => void;
};

/**
 * Simple survey modal that renders a StarRating for each question.
 * Strong typing ensures we only index Ratings by a `RatingKey`.
 */
export default function PostTripSurveyModal({
  questions,
  title = "Rate your trip",
  initial,
  onSubmit,
}: Props) {
  // Ratings is typically a Record<RatingKey, number>
  const [ratings, setRatings] = useState<Ratings>(
    initial ?? ({} as Ratings)
  );

  const handleChange = (key: RatingKey, value: number) => {
    setRatings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    onSubmit?.(ratings);
  };

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>

      <div className="space-y-4">
        {questions.map((q) => {
          // Ensure TypeScript knows this is the literal union type
          const key = q.key as RatingKey;
          const current = ratings[key] ?? 0;

          return (
            <div key={key} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center">
              <label className="font-medium">{q.label}</label>
              <div className="sm:col-span-2">
                <StarRating
                  category={key}
                  value={current}
                  onChange={(next) => handleChange(key, next)}
                  label={q.label}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setRatings({} as Ratings)}
        >
          Reset
        </button>
        <button
          type="button"
          className="rounded-md bg-black px-3 py-2 text-sm text-white"
          onClick={handleSubmit}
        >
          Submit
        </button>
      </div>
    </div>
  );
}




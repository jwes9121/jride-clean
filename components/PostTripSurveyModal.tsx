// components/PostTripSurveyModal.tsx
"use client";

import { useState } from "react";
import type { RatingKey, Ratings, Question } from "@/types/survey";
import StarRating from "./StarRating";

type Props = {
  questions: Question[];
  // if you already pass in initial ratings:
  initialRatings?: Ratings;
};

export default function PostTripSurveyModal({ questions, initialRatings }: Props) {
  const [ratings, setRatings] = useState<Ratings>(initialRatings ?? {});

  const handleStarClick = (key: RatingKey, value: number) => {
    setRatings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      {questions.map((question) => (
        <div key={question.key}>
          <div className="mb-2 font-medium">{question.label}</div>

          <StarRating
            category={question.key}
            value={ratings[question.key] ?? 0}  // ✅ key is now narrowed, TS is happy
            onChange={(rating) => handleStarClick(question.key, rating)}
          />
        </div>
      ))}
    </div>
  );
}

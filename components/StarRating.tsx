// components/StarRating.tsx
import type { RatingKey } from "@/types/survey";

type StarRatingProps = {
  category: RatingKey;
  value: number;
  onChange: (value: number) => void;
};

// ...existing StarRating implementation...

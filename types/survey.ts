// types/survey.ts
export type RatingKey =
  | "item_accuracy"
  | "timeliness"
  | "communication"
  | "vehicle_cleanliness"; // add/remove to match what you show

export type Ratings = Partial<Record<RatingKey, number>>;

export type Question = {
  key: RatingKey;
  label: string;
};

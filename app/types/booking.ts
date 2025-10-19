// app/types/booking.ts
// Single source of truth for the Booking shape across the app.

export type Booking = {
  id: string;
  passenger?: string;
  pickup?: string;
  dropoff?: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  createdAt?: string; // ISO string (optional)
};

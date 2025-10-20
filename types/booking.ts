// types/booking.ts
export type Booking = {
  id: string;
  passenger?: string;
  pickup?: string;
  dropoff?: string;
  status?: "new" | "assigned" | "completed" | "cancelled";
  createdAt?: string;  // ISO string is fine for now
};



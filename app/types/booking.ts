export type Booking = {
  id: string;
  passenger?: string;
  pickup?: string;
  dropoff?: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  createdAt?: string;
};



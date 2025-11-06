export type TownKey =
  | "Lagawe"
  | "Kiangan"
  | "Banaue"
  | "Lamut"
  | "Hingyon";

export type DriverStatus = "online" | "offline" | "busy";

export type DriverLocation = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  status: DriverStatus;
  town?: TownKey | null;
  updated_at?: string | null;
};

export type Ride = {
  id: string;
  status:
    | "pending"
    | "searching"
    | "assigned"
    | "accepted"
    | "picked_up"
    | "dropped_off"
    | "cancelled";
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  town?: TownKey | null;
  created_at?: string | null;
  driver_id?: string | null;
};

export type RealtimeEvent<T> = {
  type: "INSERT" | "UPDATE" | "DELETE";
  new?: T;
  old?: T;
};

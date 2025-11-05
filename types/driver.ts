export type LiveDriver = {
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  updated_at: string;
  // Optional UI fields (if you later join drivers): harmless if undefined
  name?: string | null;
  town?: string | null;
  vehicle_type?: string | null;
};

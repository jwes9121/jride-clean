-- ===============================
-- J-Ride Database Schema (Corrected)
-- ===============================

-- Passengers
CREATE TABLE IF NOT EXISTS passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE NOT NULL,
  email text,
  created_at timestamp DEFAULT now()
);

-- Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE NOT NULL,
  vehicle_type text CHECK (vehicle_type IN ('tricycle','motorcycle')) NOT NULL,
  plate_number text,
  is_active boolean DEFAULT true,
  rating numeric DEFAULT 5,
  created_at timestamp DEFAULT now()
);

-- Rides (main booking record)
CREATE TABLE IF NOT EXISTS rides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid REFERENCES passengers(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  pickup_point text NOT NULL,
  dropoff_point text NOT NULL,
  fare numeric, -- final fare once passenger accepts
  route jsonb,  -- to store actual route history if needed (coordinates, polyline, etc.)
  status text CHECK (status IN ('pending','accepted','declined','completed','cancelled')) DEFAULT 'pending',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Ride Offers (drivers propose fare before acceptance)
CREATE TABLE IF NOT EXISTS ride_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid REFERENCES rides(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
  proposed_fare numeric NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Complaints
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id uuid REFERENCES passengers(id),
  driver_id uuid REFERENCES drivers(id),
  description text NOT NULL,
  status text CHECK (status IN ('open','resolved')) DEFAULT 'open',
  created_at timestamp DEFAULT now()
);

-- Dispatcher logs
CREATE TABLE IF NOT EXISTS dispatcher_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  ride_id uuid REFERENCES rides(id),
  admin_id uuid,
  created_at timestamp DEFAULT now()
);

-- ===============================
-- RLS Policies (basic security)
-- ===============================
ALTER TABLE passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- Passenger can view only their rides
CREATE POLICY "Passenger can view own rides"
ON rides FOR SELECT
USING (auth.uid() = passenger_id);

-- Driver can view only assigned rides
CREATE POLICY "Driver can view assigned rides"
ON rides FOR SELECT
USING (auth.uid() = driver_id);

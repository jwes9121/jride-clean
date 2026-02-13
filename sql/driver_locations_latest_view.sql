-- Run this in Supabase SQL editor (for BOTH local and prod as needed)
-- This keeps only the latest location per driver_id

CREATE OR REPLACE VIEW public.driver_locations_latest AS
SELECT DISTINCT ON (driver_id)
  driver_id,
  latitude,
  longitude,
  updated_at
FROM public.driver_locations
ORDER BY driver_id, updated_at DESC;

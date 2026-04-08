-- ============================================
-- JRIDE ROOT CAUSE DIAGNOSTIC (BOOKING LEVEL)
-- TARGET BOOKING:
-- JR-UI-20260331182145-4820
-- ============================================

-- 1. CORE BOOKING DATA
SELECT
  b.id,
  b.booking_code,
  b.status,
  b.driver_id,
  b.assigned_driver_id,
  b.driver_to_pickup_km,
  b.pickup_distance_fee,
  b.proposed_fare,
  b.created_at,
  b.updated_at
FROM bookings b
WHERE b.booking_code = 'JR-UI-20260331182145-4820';


-- 2. RESOLVED DRIVER ID (CRITICAL)
WITH b AS (
  SELECT *
  FROM bookings
  WHERE booking_code = 'JR-UI-20260331182145-4820'
)
SELECT
  booking_code,
  driver_id,
  assigned_driver_id,
  COALESCE(assigned_driver_id, driver_id) AS resolved_driver_id
FROM b;


-- 3. DRIVER PROFILE CHECK (NAME SOURCE)
WITH b AS (
  SELECT COALESCE(assigned_driver_id, driver_id) AS driver_id
  FROM bookings
  WHERE booking_code = 'JR-UI-20260331182145-4820'
)
SELECT
  dp.id,
  dp.full_name,
  dp.display_name
FROM driver_profiles dp
JOIN b ON dp.id = b.driver_id;


-- 4. DRIVER LOCATION CHECK (MOST IMPORTANT)
WITH b AS (
  SELECT COALESCE(assigned_driver_id, driver_id) AS driver_id
  FROM bookings
  WHERE booking_code = 'JR-UI-20260331182145-4820'
)
SELECT
  dl.driver_id,
  dl.lat,
  dl.lng,
  dl.updated_at,
  EXTRACT(EPOCH FROM (NOW() - dl.updated_at)) AS seconds_since_update
FROM driver_locations_latest dl
JOIN b ON dl.driver_id = b.driver_id;


-- 5. LOCATION STALENESS FLAG
WITH b AS (
  SELECT COALESCE(assigned_driver_id, driver_id) AS driver_id
  FROM bookings
  WHERE booking_code = 'JR-UI-20260331182145-4820'
),
dl AS (
  SELECT *
  FROM driver_locations_latest
  WHERE driver_id = (SELECT driver_id FROM b)
)
SELECT
  driver_id,
  updated_at,
  CASE
    WHEN updated_at IS NULL THEN 'NO LOCATION'
    WHEN NOW() - dl.updated_at > INTERVAL '30 seconds' THEN 'STALE'
    ELSE 'FRESH'
  END AS location_status
FROM dl;


-- 6. FINAL ROOT CAUSE SUMMARY (AUTO DIAGNOSIS)
WITH b AS (
  SELECT *
  FROM bookings
  WHERE booking_code = 'JR-UI-20260331182145-4820'
),
drv AS (
  SELECT COALESCE(assigned_driver_id, driver_id) AS driver_id
  FROM b
),
dp AS (
  SELECT *
  FROM driver_profiles
  WHERE id = (SELECT driver_id FROM drv)
),
dl AS (
  SELECT *
  FROM driver_locations_latest
  WHERE driver_id = (SELECT driver_id FROM drv)
)
SELECT
  b.booking_code,
  b.status,
  (SELECT driver_id FROM drv) AS resolved_driver_id,

  CASE
    WHEN dp.id IS NULL THEN 'NO DRIVER PROFILE (driver_name will be null)'
    ELSE 'DRIVER PROFILE OK'
  END AS driver_profile_status,

  CASE
    WHEN dl.driver_id IS NULL THEN 'NO DRIVER LOCATION (ETA and pickup km will be null)'
    WHEN NOW() - dl.updated_at > INTERVAL '30 seconds' THEN 'STALE LOCATION'
    ELSE 'DRIVER LOCATION OK'
  END AS driver_location_status,

  CASE
    WHEN b.driver_to_pickup_km IS NULL THEN 'NOT STORED (fare propose issue)'
    ELSE 'STORED'
  END AS pickup_km_status,

  CASE
    WHEN b.pickup_distance_fee IS NULL THEN 'NOT COMPUTED'
    WHEN b.pickup_distance_fee = 0 THEN 'ZERO (likely no driver location at propose time or below free threshold)'
    ELSE 'HAS VALUE'
  END AS pickup_fee_status

FROM b
LEFT JOIN dp ON TRUE
LEFT JOIN dl ON TRUE;

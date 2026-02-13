-- CREATE TEST BOOKING WITH REAL DRIVER
-- Picks the first driver id from public.drivers
insert into public.bookings (
  booking_code,
  status,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  assigned_driver_id
)
values (
  'TEST-STATUS-DRIVER-001',
  'assigned',
  16.81234,
  121.11234,
  16.81300,
  121.11300,
  (
    select id
    from public.drivers
    order by created_at asc
    limit 1
  )
)
returning id, booking_code, status, assigned_driver_id;

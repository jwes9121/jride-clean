-- CREATE TEST BOOKING (NO passenger_phone COLUMN)
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
  'TEST-STATUS-001',
  'assigned',
  16.81234,
  121.11234,
  16.81300,
  121.11300,
  null
)
returning id, booking_code, status, assigned_driver_id;

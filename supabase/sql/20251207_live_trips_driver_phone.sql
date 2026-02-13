-- Extend admin_get_live_trips_page_data with driver_name + driver_phone
-- Assumes:
--   public.bookings (id, booking_code, passenger_name, town, status,
--                    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
--                    from_label, to_label, driver_id, ...)
--   public.driver_profiles (id, full_name, phone)

create or replace function public.admin_get_live_trips_page_data()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'booking_code', b.booking_code,
        'passenger_name', b.passenger_name,
        'pickup_label', b.from_label,
        'dropoff_label', b.to_label,
        'zone', b.town,
        'status', b.status,
        'pickup_lat', b.pickup_lat,
        'pickup_lng', b.pickup_lng,
        'dropoff_lat', b.dropoff_lat,
        'dropoff_lng', b.dropoff_lng,
        -- NEW pieces:
        'driver_id', b.driver_id,
        'driver_name', dp.full_name,
        'driver_phone', dp.phone
      )
      order by b.id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.bookings b
  left join public.driver_profiles dp
    on dp.id = b.driver_id
  where b.status in ('on_trip', 'on_the_way', 'assigned', 'pending');

  return v_result;
end;
$$;

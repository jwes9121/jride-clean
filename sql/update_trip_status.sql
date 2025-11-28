-- ###############################
-- TRIP STATUS UPDATE FUNCTION
-- ###############################
create or replace function public.update_trip_status(
  p_booking_id uuid,
  p_status text
)
returns void
language plpgsql
as $$
begin
  update public.bookings
  set status = p_status,
      updated_at = now()
  where id = p_booking_id;

  -- CLEAR DRIVER ASSIGNMENT WHEN COMPLETED
  if p_status = 'completed' then
    update public.bookings
    set assigned_driver_id = null
    where id = p_booking_id;
  end if;

end;
$$;

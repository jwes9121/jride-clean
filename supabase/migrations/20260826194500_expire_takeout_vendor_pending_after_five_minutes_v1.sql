create or replace function public.expire_takeout_vendor_pending_v1(
  p_now timestamptz default clock_timestamp()
)
returns table (
  booking_id uuid,
  booking_code text,
  expired_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select booking.id
    from public.bookings booking
    where lower(coalesce(booking.service_type, '')) = 'takeout'
      and lower(coalesce(booking.status, '')) not in ('completed', 'cancelled', 'canceled')
      and lower(coalesce(booking.vendor_status, 'vendor_pending')) in ('', 'requested', 'vendor_pending')
      and booking.created_at <= p_now - interval '5 minutes'
    order by booking.created_at
    limit 200
    for update skip locked
  ), expired as (
    update public.bookings booking
    set vendor_status = 'vendor_timeout',
        customer_status = 'vendor_timeout',
        status = 'cancelled',
        cancel_reason = 'Vendor did not respond within 5 minutes',
        vendor_cancel_reason = 'Vendor did not respond within 5 minutes',
        updated_at = p_now
    from candidates
    where booking.id = candidates.id
    returning booking.id, booking.booking_code
  )
  select expired.id, expired.booking_code, p_now
  from expired;
end;
$$;

revoke all on function public.expire_takeout_vendor_pending_v1(timestamptz) from public;
grant execute on function public.expire_takeout_vendor_pending_v1(timestamptz) to service_role;

comment on function public.expire_takeout_vendor_pending_v1(timestamptz) is
  'Expires pending Takeout vendor offers after exactly five minutes. The transition trigger records the exact vendor timeout timestamp.';

-- Close regular Ride searches that have remained unassigned for five minutes.
-- This is separate from driver acceptance and fare-response expiry windows.

create or replace function public.expire_stale_searching_ride_windows_v1(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 200
)
returns table (
  booking_id uuid,
  booking_code text,
  previous_status text,
  new_status text,
  expired_driver_id uuid,
  expires_at timestamptz,
  needs_reassignment boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  updated_id uuid;
  bounded_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  effective_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  for candidate in
    select
      booking.id,
      booking.booking_code,
      booking.created_by_user_id,
      booking.town,
      coalesce(
        booking.ride_reassignment_queued_at,
        booking.updated_at,
        booking.created_at
      ) + interval '5 minutes' as expires_at
    from public.bookings booking
    where lower(coalesce(booking.service_type, '')) in ('motorcycle', 'tricycle')
      and booking.status = 'searching'
      and booking.driver_id is null
      and booking.assigned_driver_id is null
      and coalesce(
        booking.ride_reassignment_queued_at,
        booking.updated_at,
        booking.created_at
      ) + interval '5 minutes' <= effective_now
    order by
      coalesce(
        booking.ride_reassignment_queued_at,
        booking.updated_at,
        booking.created_at
      ),
      booking.created_at,
      booking.id
    limit bounded_limit
    for update skip locked
  loop
    updated_id := null;

    update public.bookings booking
    set
      status = 'cancelled',
      cancel_reason = 'No driver found within 5 minutes',
      passenger_fare_response = null,
      driver_id = null,
      assigned_driver_id = null,
      assigned_at = null,
      driver_accept_expires_at = null,
      driver_fee_proposal_expires_at = null,
      driver_status = null,
      ride_reassignment_pending = false,
      ride_reassignment_queued_at = null,
      ride_reassignment_next_attempt_at = null,
      updated_at = effective_now
    where booking.id = candidate.id
      and booking.status = 'searching'
      and booking.driver_id is null
      and booking.assigned_driver_id is null
      and coalesce(
        booking.ride_reassignment_queued_at,
        booking.updated_at,
        booking.created_at
      ) + interval '5 minutes' = candidate.expires_at
      and coalesce(
        booking.ride_reassignment_queued_at,
        booking.updated_at,
        booking.created_at
      ) + interval '5 minutes' <= effective_now
    returning booking.id into updated_id;

    if updated_id is null then
      continue;
    end if;

    perform public.jride_promo_release_for_booking(
      candidate.id,
      'no_driver_found_timeout'
    );

    perform public.record_booking_lifecycle_event(
      candidate.id,
      candidate.booking_code,
      candidate.created_by_user_id,
      null,
      null,
      'search_expired',
      'searching',
      'cancelled',
      candidate.town,
      'system_cron',
      'system',
      null,
      jsonb_build_object(
        'reason', 'no_driver_found_timeout',
        'expires_at', candidate.expires_at,
        'timeout_owner', 'system',
        'reassign', false
      )
    );

    booking_id := candidate.id;
    booking_code := candidate.booking_code;
    previous_status := 'searching';
    new_status := 'cancelled';
    expired_driver_id := null;
    expires_at := candidate.expires_at;
    needs_reassignment := false;
    return next;
  end loop;
end;
$$;

revoke all
on function public.expire_stale_searching_ride_windows_v1(timestamptz, integer)
from public, anon, authenticated;

grant execute
on function public.expire_stale_searching_ride_windows_v1(timestamptz, integer)
to service_role;

comment on function public.expire_stale_searching_ride_windows_v1(timestamptz, integer) is
  'Atomically closes unassigned regular Ride searches after five minutes, including searches waiting for reassignment.';

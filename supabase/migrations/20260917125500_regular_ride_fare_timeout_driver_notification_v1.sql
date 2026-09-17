-- Keep Regular Ride passenger fare-response timeout cancellation and driver
-- notification in the same database transaction. A timed-out passenger-owned
-- fare proposal remains terminal and is never reopened for reassignment.

create or replace function public.expire_regular_ride_windows_v1(
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
  expiry_reason text;
begin
  for candidate in
    select
      booking.id,
      booking.booking_code,
      booking.created_by_user_id,
      booking.status,
      booking.town,
      coalesce(booking.assigned_driver_id, booking.driver_id) as assigned_driver,
      case
        when booking.status = 'assigned' then booking.driver_accept_expires_at
        else booking.driver_fee_proposal_expires_at
      end as deadline
    from public.bookings booking
    where lower(coalesce(booking.service_type, '')) in ('motorcycle', 'tricycle')
      and (
        (
          booking.status = 'assigned'
          and booking.driver_accept_expires_at is not null
          and booking.driver_accept_expires_at <= effective_now
        )
        or
        (
          booking.status = 'accepted'
          and booking.driver_fee_proposal_expires_at is not null
          and booking.driver_fee_proposal_expires_at <= effective_now
        )
        or
        (
          booking.status = 'fare_proposed'
          and booking.passenger_fare_response is null
          and booking.driver_fee_proposal_expires_at is not null
          and booking.driver_fee_proposal_expires_at <= effective_now
        )
      )
    order by
      case
        when booking.status = 'assigned' then booking.driver_accept_expires_at
        else booking.driver_fee_proposal_expires_at
      end,
      booking.created_at,
      booking.id
    limit bounded_limit
    for update skip locked
  loop
    updated_id := null;

    if candidate.status in ('assigned', 'accepted') then
      update public.bookings booking
      set
        status = 'searching',
        driver_id = null,
        assigned_driver_id = null,
        assigned_at = null,
        driver_accept_expires_at = null,
        driver_fee_proposal_expires_at = null,
        proposed_fare = null,
        submitted_regular_fare = null,
        verified_fare = null,
        pickup_distance_fee = null,
        driver_to_pickup_km = null,
        passenger_fare_response = null,
        driver_status = null,
        cancel_reason = null,
        last_expired_driver_id = candidate.assigned_driver,
        ride_reassignment_pending = true,
        ride_reassignment_queued_at = effective_now,
        ride_reassignment_next_attempt_at = effective_now,
        updated_at = effective_now
      where booking.id = candidate.id
        and booking.status = candidate.status
        and coalesce(booking.assigned_driver_id, booking.driver_id)
            is not distinct from candidate.assigned_driver
        and (
          (
            candidate.status = 'assigned'
            and booking.driver_accept_expires_at = candidate.deadline
            and booking.driver_accept_expires_at <= effective_now
          )
          or
          (
            candidate.status = 'accepted'
            and booking.driver_fee_proposal_expires_at = candidate.deadline
            and booking.driver_fee_proposal_expires_at <= effective_now
          )
        )
      returning booking.id into updated_id;

      if updated_id is null then
        continue;
      end if;

      expiry_reason := case
        when candidate.status = 'assigned' then 'driver_accept_timeout'
        else 'driver_fare_proposal_timeout'
      end;

      perform public.record_booking_lifecycle_event(
        candidate.id,
        candidate.booking_code,
        candidate.created_by_user_id,
        candidate.assigned_driver,
        candidate.assigned_driver,
        'assignment_expired',
        candidate.status,
        'searching',
        candidate.town,
        'system_cron',
        'system',
        null,
        jsonb_build_object(
          'reason', expiry_reason,
          'expires_at', candidate.deadline,
          'timeout_owner', 'driver',
          'reassign', true
        )
      );

      booking_id := candidate.id;
      booking_code := candidate.booking_code;
      previous_status := candidate.status;
      new_status := 'searching';
      expired_driver_id := candidate.assigned_driver;
      expires_at := candidate.deadline;
      needs_reassignment := true;
      return next;
    else
      update public.bookings booking
      set
        status = 'cancelled',
        cancel_reason = 'Passenger did not respond to the fare proposal within 5 minutes',
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
        and booking.status = 'fare_proposed'
        and booking.passenger_fare_response is null
        and booking.driver_fee_proposal_expires_at = candidate.deadline
        and booking.driver_fee_proposal_expires_at <= effective_now
      returning booking.id into updated_id;

      if updated_id is null then
        continue;
      end if;

      perform public.jride_promo_release_for_booking(
        candidate.id,
        'passenger_fare_response_timeout'
      );

      if candidate.assigned_driver is not null then
        insert into public.driver_notifications (
          driver_id,
          type,
          message
        )
        values (
          candidate.assigned_driver,
          'fare_response_timeout',
          format(
            'Ride booking %s was cancelled because the passenger did not respond to the fare proposal within 5 minutes. You may accept another booking.',
            coalesce(candidate.booking_code, candidate.id::text)
          )
        );
      end if;

      perform public.record_booking_lifecycle_event(
        candidate.id,
        candidate.booking_code,
        candidate.created_by_user_id,
        candidate.assigned_driver,
        null,
        'fare_response_expired',
        'fare_proposed',
        'cancelled',
        candidate.town,
        'system_cron',
        'system',
        null,
        jsonb_build_object(
          'reason', 'passenger_fare_response_timeout',
          'expires_at', candidate.deadline,
          'timeout_owner', 'passenger',
          'driver_penalty', false,
          'reassign', false
        )
      );

      booking_id := candidate.id;
      booking_code := candidate.booking_code;
      previous_status := 'fare_proposed';
      new_status := 'cancelled';
      expired_driver_id := candidate.assigned_driver;
      expires_at := candidate.deadline;
      needs_reassignment := false;
      return next;
    end if;
  end loop;
end;
$$;

revoke all
on function public.expire_regular_ride_windows_v1(timestamptz, integer)
from public, anon, authenticated;

grant execute
on function public.expire_regular_ride_windows_v1(timestamptz, integer)
to service_role;

comment on function public.expire_regular_ride_windows_v1(timestamptz, integer) is
  'Atomically expires bounded regular Ride driver and passenger response windows. Passenger fare-response timeout cancellation also notifies the released driver; only driver-owned windows are reopened for reassignment.';

-- Short Trip - Automatic Fare pilot.
-- The application is responsible for Mapbox and elevation validation. These
-- columns persist the validated inputs, outputs, provenance, and fallback
-- reason so Analytics V3 can audit the pilot without changing old pricing.

alter table public.bookings
  add column if not exists ride_fare_mode text,
  add column if not exists ride_fare_pricing_version text,
  add column if not exists ride_fare_provenance text,
  add column if not exists short_trip_road_distance_km numeric(12,6),
  add column if not exists short_trip_validated_elevation_gain_m numeric(12,3),
  add column if not exists short_trip_free_elevation_allowance_m numeric(12,3),
  add column if not exists short_trip_chargeable_elevation_gain_m numeric(12,3),
  add column if not exists short_trip_distance_component numeric(12,2),
  add column if not exists short_trip_elevation_premium numeric(12,2),
  add column if not exists short_trip_ride_minimum_applied boolean,
  add column if not exists short_trip_passenger_minimum_applied boolean,
  add column if not exists short_trip_automatic_ride_fare numeric(12,2),
  add column if not exists short_trip_convenience_fee numeric(12,2),
  add column if not exists short_trip_total numeric(12,2),
  add column if not exists short_trip_elevation_source text,
  add column if not exists short_trip_elevation_status text,
  add column if not exists short_trip_elevation_validation_reason text,
  add column if not exists short_trip_fare_evaluation jsonb;

comment on column public.bookings.ride_fare_mode is
  'Fare lifecycle mode. short_trip_automatic_v1 identifies a validated automatic pilot fare; null preserves the legacy Proposed Fare flow.';
comment on column public.bookings.ride_fare_pricing_version is
  'Immutable fare pricing version used for the booking outcome.';
comment on column public.bookings.ride_fare_provenance is
  'Route and elevation source provenance for the fare outcome.';
comment on column public.bookings.short_trip_fare_evaluation is
  'Audit snapshot of the short-trip pilot evaluation, including fallback reason and validated inputs/outputs.';

create index if not exists bookings_short_trip_fare_mode_v1_idx
  on public.bookings (ride_fare_mode, created_at, id)
  where ride_fare_mode is not null;

create or replace view public.analytics_v3_bookings_v1
with (security_invoker = true)
as
select b.*
from public.bookings b
where not exists (
  select 1
  from public.analytics_booking_exclusions e
  where e.booking_id = b.id
    and e.active = true
)
and not exists (
  select 1
  from public.analytics_test_identities t
  where t.active = true
    and t.entity_type = 'driver'
    and (t.entity_id = b.assigned_driver_id or t.entity_id = b.driver_id)
)
and not exists (
  select 1
  from public.analytics_test_identities t
  where t.active = true
    and t.entity_type = 'passenger'
    and t.entity_id = b.created_by_user_id
);

comment on view public.analytics_v3_bookings_v1 is
  'Production Analytics V3 booking source. Excludes manually excluded bookings plus role-scoped dummy driver and passenger identities without mixing the two ID namespaces; includes short-trip pilot audit fields.';

create or replace function public.jride_canonical_lifecycle_guard_v1()
returns trigger
language plpgsql
as $$
declare
  old_status text;
  new_status text;
  is_regular_ride boolean;
begin
  old_status := coalesce(old.status, '');
  new_status := coalesce(new.status, '');
  is_regular_ride := lower(coalesce(old.service_type, '')) in ('motorcycle', 'tricycle');

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old_status = new_status then
    return new;
  end if;

  if new_status in ('assigned', 'accepted', 'fare_proposed', 'ready', 'on_the_way', 'arrived', 'on_trip', 'completed') then
    if new.assigned_driver_id is null then
      raise exception 'INVALID_STATUS_TRANSITION: % -> % requires assigned_driver_id', old_status, new_status;
    end if;

    if new.driver_id is null then
      new.driver_id := new.assigned_driver_id;
    end if;

    if new_status = 'assigned' then
      new.ride_reassignment_pending := false;
      new.ride_reassignment_queued_at := null;
      new.ride_reassignment_next_attempt_at := null;
    end if;
  end if;

  if old_status in ('', 'requested') and new_status in ('pending', 'searching', 'assigned', 'cancelled') then
    return new;
  end if;

  if old_status in ('pending', 'searching') and new_status in ('assigned', 'cancelled') then
    return new;
  end if;

  if lower(coalesce(old.service_type, '')) = 'errand'
     and old_status in ('assigned', 'accepted')
     and new_status = 'searching'
     and new.assigned_driver_id is null
     and new.driver_id is null
     and old.proposed_fare is null
     and old.verified_fare is null
  then
    if not exists (
      select 1
      from public.errand_driver_offer_outcomes eo
      where eo.booking_id = old.id
        and eo.driver_id = coalesce(old.assigned_driver_id, old.driver_id)
    ) then
      raise exception 'ERRAND_RELEASE_REQUIRES_CONTROLLED_OUTCOME';
    end if;
    return new;
  end if;

  if old_status = 'assigned' and new_status = 'searching'
     and old.proposed_fare is null
     and old.verified_fare is null
     and coalesce(old.passenger_fare_response, '') = ''
     and old.driver_accept_expires_at is not null
     and old.driver_accept_expires_at <= clock_timestamp()
  then
    return new;
  end if;

  if old_status = 'assigned' and new_status = 'ready' then
    if not is_regular_ride
       or coalesce(new.ride_fare_mode, '') <> 'short_trip_automatic_v1'
       or coalesce(new.ride_fare_pricing_version, '') <> 'short_trip_automatic_v1'
       or coalesce(new.ride_fare_provenance, '') = ''
       or new.verified_fare is null
       or coalesce(new.passenger_fare_response, '') <> 'accepted'
       or coalesce(new.short_trip_elevation_status, '') <> 'validated'
       or new.short_trip_validated_elevation_gain_m is null
       or new.driver_accept_expires_at is not null
       or new.driver_fee_proposal_expires_at is not null
    then
      raise exception 'SHORT_TRIP_AUTOMATIC_FARE_REQUIRED';
    end if;

    if old.driver_accept_expires_at is null
       or old.driver_accept_expires_at <= clock_timestamp()
    then
      raise exception 'RIDE_DRIVER_ACCEPT_WINDOW_EXPIRED';
    end if;
    return new;
  end if;

  if old_status = 'assigned' and new_status in ('accepted', 'fare_proposed') then
    if is_regular_ride
       and (
         old.driver_accept_expires_at is null
         or old.driver_accept_expires_at <= clock_timestamp()
       )
    then
      raise exception 'RIDE_DRIVER_ACCEPT_WINDOW_EXPIRED';
    end if;
    return new;
  end if;

  if old_status = 'assigned' and new_status = 'cancelled' then
    return new;
  end if;

  if old_status = 'accepted' and new_status = 'searching'
     and old.proposed_fare is null
     and old.verified_fare is null
     and coalesce(old.passenger_fare_response, '') = ''
     and (
       (
         is_regular_ride
         and old.driver_fee_proposal_expires_at is not null
         and old.driver_fee_proposal_expires_at <= clock_timestamp()
       )
       or
       (
         not is_regular_ride
         and coalesce(old.updated_at, old.assigned_at, old.created_at)
             <= clock_timestamp() - interval '5 minutes'
       )
     )
  then
    return new;
  end if;

  if old_status = 'accepted' and new_status = 'fare_proposed' then
    if is_regular_ride
       and (
         old.driver_fee_proposal_expires_at is null
         or old.driver_fee_proposal_expires_at <= clock_timestamp()
       )
    then
      raise exception 'RIDE_DRIVER_FARE_PROPOSAL_WINDOW_EXPIRED';
    end if;
    return new;
  end if;

  if old_status = 'accepted' and new_status = 'cancelled' then
    return new;
  end if;

  if old_status = 'fare_proposed' and new_status in ('ready', 'searching') then
    if is_regular_ride
       and (
         old.driver_fee_proposal_expires_at is null
         or old.driver_fee_proposal_expires_at <= clock_timestamp()
       )
    then
      raise exception 'RIDE_PASSENGER_FARE_RESPONSE_WINDOW_EXPIRED';
    end if;
    if is_regular_ride
       and new_status = 'ready'
       and coalesce(new.passenger_fare_response, '') <> 'accepted'
    then
      raise exception 'RIDE_PASSENGER_FARE_ACCEPTANCE_REQUIRED';
    end if;
    if is_regular_ride
       and new_status = 'searching'
       and coalesce(new.passenger_fare_response, '') <> 'rejected'
    then
      raise exception 'RIDE_PASSENGER_FARE_REJECTION_REQUIRED';
    end if;
    return new;
  end if;

  if old_status = 'fare_proposed' and new_status = 'cancelled' then
    return new;
  end if;

  if old_status = 'ready' and new_status in ('on_the_way', 'cancelled') then
    return new;
  end if;

  if old_status = 'on_the_way' and new_status in ('arrived', 'cancelled') then
    return new;
  end if;

  if old_status = 'arrived' and new_status in ('on_trip', 'cancelled') then
    return new;
  end if;

  if old_status = 'on_trip' and new_status in ('completed', 'cancelled') then
    return new;
  end if;

  if old_status in ('completed', 'cancelled') then
    raise exception 'INVALID_STATUS_TRANSITION: terminal % -> %', old_status, new_status;
  end if;

  raise exception 'INVALID_STATUS_TRANSITION: % -> %', old_status, new_status;
end;
$$;

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
      and coalesce(booking.ride_fare_mode, '') <> 'short_trip_automatic_v1'
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
  'Atomically expires bounded regular Ride driver and passenger response windows. Short Trip automatic fare rows are never treated as proposed-fare windows.';

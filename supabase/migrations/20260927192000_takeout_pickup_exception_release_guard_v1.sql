-- JRIDE_TAKEOUT_PICKUP_DISTANCE_EXCEPTION_RELEASE_V1
-- Narrow lifecycle exception for Customer Cash First >10 km pickup release.
-- Preserves all existing canonical lifecycle rules.
CREATE OR REPLACE FUNCTION public.jride_canonical_lifecycle_guard_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

  -- JRIDE_TAKEOUT_PICKUP_DISTANCE_EXCEPTION_RELEASE_V1
  -- Allow only the explicit Takeout >10 km pickup exception to release an
  -- assigned/accepted driver before the normal accept/proposal expiry window.
  -- The API must clear both driver links, preserve an unconfirmed/unpriced
  -- order, record the released driver, and stamp the exception snapshot.
  if lower(coalesce(old.service_type, '')) = 'takeout'
     and old_status in ('assigned', 'accepted')
     and new_status = 'searching'
     and new.assigned_driver_id is null
     and new.driver_id is null
     and old.takeout_customer_confirmed_at is null
     and old.takeout_fee_proposed_at is null
     and old.takeout_delivery_fee is null
     and new.last_expired_driver_id = coalesce(old.assigned_driver_id, old.driver_id)
     and lower(coalesce(new.takeout_pricing_snapshot->>'takeout_pickup_distance_exception_required', 'false')) = 'true'
     and coalesce(new.takeout_pricing_snapshot->>'takeout_pickup_distance_exception_status', '') = 'reassignment_requested'
  then
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
$function$


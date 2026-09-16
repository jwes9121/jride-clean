-- JRIDE_ERRAND_15M_MATCHING_WINDOW_V1
-- The customer request remains matchable for strictly less than 15 minutes
-- from bookings.created_at. At exactly 15 minutes it is expired.

create or replace function public.errand_enforce_matching_window_v1()
returns trigger
language plpgsql
as $function$
declare
  v_new_status text;
  v_old_status text;
begin
  if lower(coalesce(new.service_type, '')) <> 'errand' then
    return new;
  end if;

  v_new_status := lower(trim(coalesce(new.status, '')));

  if tg_op = 'INSERT' then
    if v_new_status in ('assigned', 'accepted') then
      if new.created_at is null then
        raise exception 'ERRAND_MATCHING_CREATED_AT_REQUIRED' using errcode = 'P0001';
      end if;

      if clock_timestamp() >= new.created_at + interval '15 minutes' then
        raise exception 'ERRAND_MATCHING_WINDOW_EXPIRED' using errcode = 'P0001';
      end if;
    end if;

    return new;
  end if;

  v_old_status := lower(trim(coalesce(old.status, '')));

  if v_new_status in ('assigned', 'accepted')
     and (
       v_old_status is distinct from v_new_status
       or old.assigned_driver_id is distinct from new.assigned_driver_id
       or old.driver_id is distinct from new.driver_id
     ) then
    if new.created_at is null then
      raise exception 'ERRAND_MATCHING_CREATED_AT_REQUIRED' using errcode = 'P0001';
    end if;

    if clock_timestamp() >= new.created_at + interval '15 minutes' then
      raise exception 'ERRAND_MATCHING_WINDOW_EXPIRED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_errand_matching_window_guard on public.bookings;
create trigger trg_errand_matching_window_guard
before insert or update of status, assigned_driver_id, driver_id
on public.bookings
for each row
execute function public.errand_enforce_matching_window_v1();

create or replace function public.expire_errand_matching_windows_v1(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 200
)
returns table(
  booking_id uuid,
  booking_code text,
  previous_status text,
  expired_driver_id uuid,
  request_created_at timestamptz,
  expired_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      booking.status,
      booking.created_at,
      coalesce(booking.assigned_driver_id, booking.driver_id) as assigned_driver
    from public.bookings booking
    where lower(coalesce(booking.service_type, '')) = 'errand'
      and booking.status in ('requested', 'pending', 'searching', 'assigned')
      and booking.created_at is not null
      and booking.created_at + interval '15 minutes' <= effective_now
    order by booking.created_at, booking.id
    limit bounded_limit
    for update skip locked
  loop
    updated_id := null;

    if candidate.assigned_driver is not null then
      insert into public.errand_driver_offer_outcomes (
        booking_id,
        driver_id,
        outcome,
        reason_code,
        created_at
      ) values (
        candidate.id,
        candidate.assigned_driver,
        'expired',
        'matching_window_expired',
        effective_now
      )
      on conflict (booking_id, driver_id)
      do update set
        outcome = 'expired',
        reason_code = 'matching_window_expired',
        created_at = excluded.created_at;
    end if;

    update public.bookings booking
    set
      status = 'cancelled',
      cancel_reason = 'Errand matching expired after 15 minutes',
      last_expired_driver_id = coalesce(candidate.assigned_driver, booking.last_expired_driver_id),
      driver_id = null,
      assigned_driver_id = null,
      assigned_at = null,
      driver_accept_expires_at = null,
      driver_fee_proposal_expires_at = null,
      driver_status = null,
      driver_to_pickup_km = null,
      pickup_distance_fee = 0,
      ride_reassignment_pending = false,
      ride_reassignment_queued_at = null,
      ride_reassignment_next_attempt_at = null,
      updated_at = effective_now
    where booking.id = candidate.id
      and booking.status = candidate.status
      and booking.created_at is not null
      and booking.created_at + interval '15 minutes' <= effective_now
    returning booking.id into updated_id;

    if updated_id is null then
      continue;
    end if;

    booking_id := candidate.id;
    booking_code := candidate.booking_code;
    previous_status := candidate.status;
    expired_driver_id := candidate.assigned_driver;
    request_created_at := candidate.created_at;
    expired_at := effective_now;
    return next;
  end loop;
end;
$function$;

revoke all on function public.expire_errand_matching_windows_v1(timestamptz, integer) from public;
revoke all on function public.expire_errand_matching_windows_v1(timestamptz, integer) from anon;
revoke all on function public.expire_errand_matching_windows_v1(timestamptz, integer) from authenticated;
grant execute on function public.expire_errand_matching_windows_v1(timestamptz, integer) to service_role;
grant execute on function public.expire_errand_matching_windows_v1(timestamptz, integer) to postgres;

create or replace function public.errand_driver_accept_v1(
  p_booking_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_stage text;
  v_now timestamptz := clock_timestamp();
begin
  if p_booking_id is null or p_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_REQUIRED_ID');
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'BOOKING_NOT_FOUND');
  end if;

  if lower(coalesce(v_booking.service_type, '')) <> 'errand' then
    return jsonb_build_object('ok', false, 'error', 'NOT_ERRAND_BOOKING');
  end if;

  if coalesce(v_booking.assigned_driver_id, v_booking.driver_id) is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_ASSIGNED');
  end if;

  if v_booking.status = 'accepted' then
    select errand_stage into v_stage
    from public.errand_jobs
    where booking_id = p_booking_id;

    return jsonb_build_object(
      'ok', true,
      'already_accepted', true,
      'booking_id', p_booking_id,
      'status', v_booking.status,
      'errand_stage', coalesce(v_stage, 'going_to_customer')
    );
  end if;

  if v_booking.status <> 'assigned' then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_NOT_ACCEPTABLE',
      'status', v_booking.status
    );
  end if;

  if v_booking.created_at is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_MATCHING_CREATED_AT_REQUIRED',
      'booking_id', p_booking_id
    );
  end if;

  if v_now >= v_booking.created_at + interval '15 minutes' then
    insert into public.errand_driver_offer_outcomes (
      booking_id,
      driver_id,
      outcome,
      reason_code,
      created_at
    ) values (
      p_booking_id,
      p_driver_id,
      'expired',
      'matching_window_expired',
      v_now
    )
    on conflict (booking_id, driver_id)
    do update set
      outcome = 'expired',
      reason_code = 'matching_window_expired',
      created_at = excluded.created_at;

    update public.bookings
    set
      status = 'cancelled',
      cancel_reason = 'Errand matching expired after 15 minutes',
      last_expired_driver_id = p_driver_id,
      driver_id = null,
      assigned_driver_id = null,
      assigned_at = null,
      driver_accept_expires_at = null,
      driver_fee_proposal_expires_at = null,
      driver_status = null,
      driver_to_pickup_km = null,
      pickup_distance_fee = 0,
      ride_reassignment_pending = false,
      ride_reassignment_queued_at = null,
      ride_reassignment_next_attempt_at = null,
      updated_at = v_now
    where id = p_booking_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_MATCHING_WINDOW_EXPIRED',
      'booking_id', p_booking_id,
      'expired_at', v_now
    );
  end if;

  if v_booking.driver_accept_expires_at is not null
     and v_booking.driver_accept_expires_at <= v_now then
    insert into public.errand_driver_offer_outcomes (
      booking_id, driver_id, outcome, reason_code, created_at
    ) values (
      p_booking_id, p_driver_id, 'expired', 'offer_timeout', v_now
    )
    on conflict (booking_id, driver_id)
    do update set
      outcome = 'expired',
      reason_code = 'offer_timeout',
      created_at = excluded.created_at;

    update public.bookings
    set driver_id = null,
        assigned_driver_id = null,
        status = 'searching',
        assigned_at = null,
        driver_accept_expires_at = null,
        driver_to_pickup_km = null,
        pickup_distance_fee = 0,
        updated_at = v_now
    where id = p_booking_id;

    update public.errand_jobs
    set errand_stage = 'matching',
        updated_at = v_now
    where booking_id = p_booking_id;

    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_OFFER_EXPIRED',
      'released', true,
      'booking_id', p_booking_id
    );
  end if;

  update public.bookings
  set status = 'accepted',
      driver_id = p_driver_id,
      assigned_driver_id = p_driver_id,
      driver_accept_expires_at = null,
      driver_fee_proposal_expires_at = null,
      updated_at = v_now
  where id = p_booking_id;

  update public.errand_jobs
  set errand_stage = 'going_to_customer',
      updated_at = v_now
  where booking_id = p_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'status', 'accepted',
    'errand_stage', 'going_to_customer'
  );
end;
$function$;

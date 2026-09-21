-- JFleet in-trip additional route / side-trip commercial flow.

create or replace function public.jfleet_owner_propose_addon_v1(
  p_booking_id uuid,
  p_owner_user_id uuid,
  p_requested_by text,
  p_description text,
  p_additional_route jsonb,
  p_fuel_vehicle_fee numeric,
  p_driver_fee numeric,
  p_other_fee numeric,
  p_notes text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_booking public.jfleet_bookings%rowtype;
  v_partner public.jfleet_partners%rowtype;
  v_addon public.jfleet_addons%rowtype;
  v_requested_by text := lower(trim(coalesce(p_requested_by,'customer')));
begin
  if v_requested_by not in ('customer','driver','owner') then
    raise exception 'JFLEET_ADDON_REQUESTER_INVALID';
  end if;

  if length(trim(coalesce(p_description,''))) < 2 then
    raise exception 'JFLEET_ADDON_DESCRIPTION_REQUIRED';
  end if;

  if coalesce(p_fuel_vehicle_fee,0) < 0
     or coalesce(p_driver_fee,0) < 0
     or coalesce(p_other_fee,0) < 0
     or coalesce(p_fuel_vehicle_fee,0)
        + coalesce(p_driver_fee,0)
        + coalesce(p_other_fee,0) <= 0 then
    raise exception 'JFLEET_ADDON_AMOUNT_INVALID';
  end if;

  if p_additional_route is null
     or jsonb_typeof(p_additional_route) not in ('object','array') then
    raise exception 'JFLEET_ADDON_ROUTE_REQUIRED';
  end if;

  select *
    into v_booking
  from public.jfleet_bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status <> 'on_trip' then
    raise exception 'JFLEET_ADDON_REQUIRES_ACTIVE_TRIP';
  end if;

  select *
    into v_partner
  from public.jfleet_partners
  where id = v_booking.partner_id
    and owner_user_id = p_owner_user_id
    and status = 'active'
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_OWNER_NOT_AUTHORIZED';
  end if;

  if exists (
    select 1
    from public.jfleet_addons a
    where a.booking_id = v_booking.id
      and a.status in ('proposed','accepted')
  ) then
    raise exception 'JFLEET_ADDON_PENDING_EXISTS';
  end if;

  insert into public.jfleet_addons(
    booking_id,
    requested_by,
    description,
    additional_route,
    fuel_vehicle_fee,
    driver_fee,
    other_fee,
    status,
    proposed_at,
    notes,
    created_at,
    updated_at
  ) values (
    v_booking.id,
    v_requested_by,
    trim(p_description),
    p_additional_route,
    round(coalesce(p_fuel_vehicle_fee,0),2),
    round(coalesce(p_driver_fee,0),2),
    round(coalesce(p_other_fee,0),2),
    'proposed',
    p_now,
    nullif(trim(coalesce(p_notes,'')),''),
    p_now,
    p_now
  )
  returning * into v_addon;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'owner',
    p_owner_user_id::text,
    'addon_proposed',
    jsonb_build_object(
      'addon_id', v_addon.id,
      'requested_by', v_addon.requested_by,
      'description', v_addon.description,
      'total_amount', v_addon.total_amount,
      'additional_route', v_addon.additional_route
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'addon_id', v_addon.id,
    'booking_id', v_booking.id,
    'status', v_addon.status,
    'total_amount', v_addon.total_amount
  );
end;
$$;

create or replace function public.jfleet_customer_respond_addon_v1(
  p_addon_id uuid,
  p_passenger_user_id uuid,
  p_response text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_addon public.jfleet_addons%rowtype;
  v_booking public.jfleet_bookings%rowtype;
  v_response text := lower(trim(coalesce(p_response,'')));
begin
  if v_response not in ('accept','decline') then
    raise exception 'JFLEET_ADDON_RESPONSE_INVALID';
  end if;

  select *
    into v_addon
  from public.jfleet_addons
  where id = p_addon_id
  for update;

  if v_addon.id is null then
    raise exception 'JFLEET_ADDON_NOT_FOUND';
  end if;

  select *
    into v_booking
  from public.jfleet_bookings
  where id = v_addon.booking_id
    and passenger_user_id = p_passenger_user_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status <> 'on_trip' then
    raise exception 'JFLEET_ADDON_REQUIRES_ACTIVE_TRIP';
  end if;

  if v_addon.status <> 'proposed' then
    if (v_response = 'accept' and v_addon.status in ('accepted','paid'))
       or (v_response = 'decline' and v_addon.status = 'declined') then
      return jsonb_build_object(
        'ok', true,
        'addon_id', v_addon.id,
        'status', v_addon.status,
        'total_amount', v_addon.total_amount
      );
    end if;
    raise exception 'JFLEET_ADDON_NOT_PENDING';
  end if;

  update public.jfleet_addons
  set status = case when v_response = 'accept' then 'accepted' else 'declined' end,
      accepted_at = case when v_response = 'accept' then p_now else null end,
      updated_at = p_now
  where id = v_addon.id
  returning * into v_addon;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'customer',
    p_passenger_user_id::text,
    'addon_' || v_response,
    jsonb_build_object(
      'addon_id', v_addon.id,
      'total_amount', v_addon.total_amount,
      'description', v_addon.description
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'addon_id', v_addon.id,
    'status', v_addon.status,
    'total_amount', v_addon.total_amount
  );
end;
$$;

create or replace function public.jfleet_owner_confirm_addon_payment_v1(
  p_addon_id uuid,
  p_owner_user_id uuid,
  p_payment_channel text,
  p_payment_reference text,
  p_idempotency_key text,
  p_notes text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_addon public.jfleet_addons%rowtype;
  v_booking public.jfleet_bookings%rowtype;
  v_partner public.jfleet_partners%rowtype;
  v_existing public.jfleet_payments%rowtype;
begin
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then
    raise exception 'JFLEET_PAYMENT_IDEMPOTENCY_REQUIRED';
  end if;

  select *
    into v_addon
  from public.jfleet_addons
  where id = p_addon_id
  for update;

  if v_addon.id is null then
    raise exception 'JFLEET_ADDON_NOT_FOUND';
  end if;

  select *
    into v_booking
  from public.jfleet_bookings
  where id = v_addon.booking_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  select *
    into v_partner
  from public.jfleet_partners
  where id = v_booking.partner_id
    and owner_user_id = p_owner_user_id
    and status = 'active'
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_OWNER_NOT_AUTHORIZED';
  end if;

  if v_booking.status <> 'on_trip' then
    raise exception 'JFLEET_ADDON_REQUIRES_ACTIVE_TRIP';
  end if;

  if v_addon.status = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'addon_id', v_addon.id,
      'booking_id', v_booking.id,
      'status', v_addon.status,
      'addon_total', v_booking.addon_total,
      'final_trip_value', v_booking.final_trip_value,
      'jride_commission_amount', v_booking.jride_commission_amount
    );
  end if;

  if v_addon.status <> 'accepted' then
    raise exception 'JFLEET_ADDON_NOT_ACCEPTED';
  end if;

  select *
    into v_existing
  from public.jfleet_payments
  where idempotency_key = trim(p_idempotency_key);

  if v_existing.id is not null then
    if v_existing.booking_id is distinct from v_booking.id
       or v_existing.amount is distinct from v_addon.total_amount
       or v_existing.payment_kind is distinct from 'addon' then
      raise exception 'JFLEET_PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into public.jfleet_payments(
      booking_id,
      payment_kind,
      amount,
      status,
      payment_channel,
      payment_reference,
      idempotency_key,
      received_by,
      confirmed_by_owner_user_id,
      paid_at,
      confirmed_at,
      notes,
      created_at,
      updated_at
    ) values (
      v_booking.id,
      'addon',
      v_addon.total_amount,
      'confirmed',
      nullif(trim(coalesce(p_payment_channel,'')),''),
      nullif(trim(coalesce(p_payment_reference,'')),''),
      trim(p_idempotency_key),
      'transport_partner_owner',
      p_owner_user_id,
      p_now,
      p_now,
      nullif(trim(coalesce(p_notes,'')),''),
      p_now,
      p_now
    );
  end if;

  update public.jfleet_addons
  set status = 'paid',
      payment_confirmed_at = p_now,
      updated_at = p_now
  where id = v_addon.id
  returning * into v_addon;

  update public.jfleet_bookings
  set addon_total = addon_total + v_addon.total_amount,
      updated_at = p_now
  where id = v_booking.id
  returning * into v_booking;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'owner',
    p_owner_user_id::text,
    'addon_payment_confirmed',
    jsonb_build_object(
      'addon_id', v_addon.id,
      'addon_amount', v_addon.total_amount,
      'addon_total', v_booking.addon_total,
      'final_trip_value', v_booking.final_trip_value,
      'jride_commission_amount', v_booking.jride_commission_amount
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'addon_id', v_addon.id,
    'booking_id', v_booking.id,
    'status', v_addon.status,
    'addon_total', v_booking.addon_total,
    'final_trip_value', v_booking.final_trip_value,
    'jride_commission_amount', v_booking.jride_commission_amount,
    'partner_net_amount', v_booking.partner_net_amount
  );
end;
$$;

revoke all on function public.jfleet_owner_propose_addon_v1(
  uuid, uuid, text, text, jsonb, numeric, numeric, numeric, text, timestamptz
) from public, anon, authenticated;

revoke all on function public.jfleet_customer_respond_addon_v1(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;

revoke all on function public.jfleet_owner_confirm_addon_payment_v1(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;

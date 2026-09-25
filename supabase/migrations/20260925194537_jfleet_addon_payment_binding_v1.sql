-- JFleet add-on payment binding and retry-safe receipt recovery.
-- Additive only. JFleet remains feature-gated.

alter table public.jfleet_payments
  add column addon_id uuid references public.jfleet_addons(id) on delete restrict;

create unique index jfleet_payments_addon_unique_idx
  on public.jfleet_payments(addon_id)
  where addon_id is not null;

create index jfleet_payments_addon_booking_idx
  on public.jfleet_payments(addon_id, booking_id)
  where addon_id is not null;

alter table public.jfleet_payments
  add constraint jfleet_payments_addon_kind_binding_chk
  check (
    (payment_kind = 'addon' and addon_id is not null)
    or
    (payment_kind <> 'addon' and addon_id is null)
  );

create or replace function public.jfleet_owner_confirm_addon_payment_v2(
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
  v_addon_payment public.jfleet_payments%rowtype;
  v_key text := trim(coalesce(p_idempotency_key,''));
  v_channel text := nullif(trim(coalesce(p_payment_channel,'')),'');
  v_reference text := nullif(trim(coalesce(p_payment_reference,'')),'');
  v_notes text := nullif(trim(coalesce(p_notes,'')),'');
begin
  if v_key !~ '^[A-Za-z0-9_-]{8,120}$' then
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

  select *
    into v_existing
  from public.jfleet_payments
  where idempotency_key = v_key
  for update;

  if v_existing.id is not null then
    if v_existing.addon_id is distinct from v_addon.id
       or v_existing.booking_id is distinct from v_booking.id
       or v_existing.payment_kind is distinct from 'addon'
       or v_existing.amount is distinct from v_addon.total_amount
       or v_existing.status is distinct from 'confirmed'
       or v_existing.confirmed_by_owner_user_id is distinct from p_owner_user_id
       or coalesce(v_existing.payment_channel,'') is distinct from coalesce(v_channel,'')
       or coalesce(v_existing.payment_reference,'') is distinct from coalesce(v_reference,'')
       or coalesce(v_existing.notes,'') is distinct from coalesce(v_notes,'') then
      raise exception 'JFLEET_ADDON_PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'payment_id', v_existing.id,
      'addon_id', v_addon.id,
      'booking_id', v_booking.id,
      'partner_id', v_partner.id,
      'owner_user_id', p_owner_user_id,
      'amount', v_existing.amount,
      'payment_channel', coalesce(v_existing.payment_channel,''),
      'payment_reference', coalesce(v_existing.payment_reference,''),
      'notes', coalesce(v_existing.notes,''),
      'idempotency_key', v_existing.idempotency_key,
      'confirmed_at', v_existing.confirmed_at,
      'status', v_addon.status,
      'addon_total', v_booking.addon_total,
      'final_trip_value', v_booking.final_trip_value,
      'jride_commission_amount', v_booking.jride_commission_amount,
      'partner_net_amount', v_booking.partner_net_amount
    );
  end if;

  select *
    into v_addon_payment
  from public.jfleet_payments
  where addon_id = v_addon.id
  for update;

  if v_addon_payment.id is not null then
    raise exception 'JFLEET_ADDON_PAYMENT_ALREADY_RECORDED';
  end if;

  if v_addon.status = 'paid' then
    raise exception 'JFLEET_ADDON_PAYMENT_REVIEW_REQUIRED';
  end if;

  if v_addon.status <> 'accepted' then
    raise exception 'JFLEET_ADDON_NOT_ACCEPTED';
  end if;

  if v_booking.status <> 'on_trip' then
    raise exception 'JFLEET_ADDON_REQUIRES_ACTIVE_TRIP';
  end if;

  insert into public.jfleet_payments(
    booking_id,
    addon_id,
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
    v_addon.id,
    'addon',
    v_addon.total_amount,
    'confirmed',
    v_channel,
    v_reference,
    v_key,
    'transport_partner_owner',
    p_owner_user_id,
    p_now,
    p_now,
    v_notes,
    p_now,
    p_now
  )
  returning * into v_existing;

  update public.jfleet_addons
  set status = 'paid',
      payment_confirmed_at = p_now,
      updated_at = p_now
  where id = v_addon.id
    and status = 'accepted'
  returning * into v_addon;

  if v_addon.id is null then
    raise exception 'JFLEET_ADDON_PAYMENT_STATE_CHANGED';
  end if;

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
      'payment_id', v_existing.id,
      'addon_id', v_addon.id,
      'idempotency_key', v_key,
      'addon_amount', v_addon.total_amount,
      'addon_total', v_booking.addon_total,
      'final_trip_value', v_booking.final_trip_value,
      'jride_commission_amount', v_booking.jride_commission_amount
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'payment_id', v_existing.id,
    'addon_id', v_addon.id,
    'booking_id', v_booking.id,
    'partner_id', v_partner.id,
    'owner_user_id', p_owner_user_id,
    'amount', v_existing.amount,
    'payment_channel', coalesce(v_existing.payment_channel,''),
    'payment_reference', coalesce(v_existing.payment_reference,''),
    'notes', coalesce(v_existing.notes,''),
    'idempotency_key', v_existing.idempotency_key,
    'confirmed_at', v_existing.confirmed_at,
    'status', v_addon.status,
    'addon_total', v_booking.addon_total,
    'final_trip_value', v_booking.final_trip_value,
    'jride_commission_amount', v_booking.jride_commission_amount,
    'partner_net_amount', v_booking.partner_net_amount
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
begin
  return public.jfleet_owner_confirm_addon_payment_v2(
    p_addon_id,
    p_owner_user_id,
    p_payment_channel,
    p_payment_reference,
    p_idempotency_key,
    p_notes,
    p_now
  );
end;
$$;

revoke all on function public.jfleet_owner_confirm_addon_payment_v2(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.jfleet_owner_confirm_addon_payment_v2(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.jfleet_owner_confirm_addon_payment_v1(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.jfleet_owner_confirm_addon_payment_v1(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

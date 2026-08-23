create or replace function public.admin_onboard_driver_v1(
  p_driver_id uuid,
  p_full_name text,
  p_callsign text,
  p_municipality text,
  p_vehicle_type text,
  p_plate_number text,
  p_phone text,
  p_toda_org text,
  p_is_toda_member boolean,
  p_toda_share_per_ride numeric,
  p_initial_wallet numeric default 300,
  p_min_wallet_required numeric default 250
)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_zone_id uuid;
  v_existing_tx_count int;
begin
  select id
  into v_zone_id
  from public.zones
  where lower(zone_name) = lower(p_municipality)
  limit 1;

  if v_zone_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ZONE_NOT_FOUND',
      'municipality', p_municipality
    );
  end if;

  insert into public.driver_profiles (
    driver_id,
    full_name,
    callsign,
    municipality,
    vehicle_type,
    plate_number,
    phone,
    toda_org,
    is_toda_member,
    toda_share_per_ride,
    email
  )
  values (
    p_driver_id,
    p_full_name,
    p_callsign,
    p_municipality,
    p_vehicle_type,
    p_plate_number,
    p_phone,
    p_toda_org,
    coalesce(p_is_toda_member, false),
    coalesce(p_toda_share_per_ride, 0),
    null
  )
  on conflict (driver_id) do update set
    full_name = excluded.full_name,
    callsign = excluded.callsign,
    municipality = excluded.municipality,
    vehicle_type = excluded.vehicle_type,
    plate_number = excluded.plate_number,
    phone = excluded.phone,
    toda_org = excluded.toda_org,
    is_toda_member = excluded.is_toda_member,
    toda_share_per_ride = excluded.toda_share_per_ride;

  insert into public.drivers (
    id,
    driver_status,
    zone_id,
    updated_at,
    driver_name,
    wallet_balance,
    min_wallet_required,
    wallet_locked,
    is_toda_member,
    toda_name,
    roster_status,
    roster_status_changed_at,
    roster_status_reason
  )
  values (
    p_driver_id,
    'offline',
    v_zone_id,
    now(),
    p_full_name,
    coalesce(p_initial_wallet, 0),
    coalesce(p_min_wallet_required, 250),
    false,
    coalesce(p_is_toda_member, false),
    p_toda_org,
    'active',
    now(),
    'Approved by admin onboarding'
  )
  on conflict (id) do update set
    zone_id = excluded.zone_id,
    updated_at = now(),
    driver_name = excluded.driver_name,
    wallet_balance = excluded.wallet_balance,
    min_wallet_required = excluded.min_wallet_required,
    wallet_locked = false,
    is_toda_member = excluded.is_toda_member,
    toda_name = excluded.toda_name,
    roster_status = case
      when lower(coalesce(public.drivers.roster_status, 'pending')) = 'pending'
        then 'active'
      else public.drivers.roster_status
    end,
    roster_status_changed_at = case
      when lower(coalesce(public.drivers.roster_status, 'pending')) = 'pending'
        then now()
      else public.drivers.roster_status_changed_at
    end,
    roster_status_reason = case
      when lower(coalesce(public.drivers.roster_status, 'pending')) = 'pending'
        then 'Approved by admin onboarding'
      else public.drivers.roster_status_reason
    end;

  select count(*)
  into v_existing_tx_count
  from public.driver_wallet_transactions
  where driver_id = p_driver_id;

  if v_existing_tx_count = 0 and coalesce(p_initial_wallet, 0) > 0 then
    insert into public.driver_wallet_transactions (
      driver_id,
      amount,
      balance_after,
      reason,
      booking_id
    )
    values (
      p_driver_id,
      p_initial_wallet,
      p_initial_wallet,
      'driver_onboarding_wallet_bootstrap',
      null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'driver_id', p_driver_id,
    'full_name', p_full_name,
    'zone_id', v_zone_id,
    'municipality', p_municipality,
    'roster_status', (
      select roster_status from public.drivers where id = p_driver_id
    ),
    'wallet_bootstrapped', v_existing_tx_count = 0 and coalesce(p_initial_wallet, 0) > 0
  );
end;
$function$;

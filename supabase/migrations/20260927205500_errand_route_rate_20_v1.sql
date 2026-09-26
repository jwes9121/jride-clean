-- JRIDE_ERRAND_ROUTE_RATE_20_V1
-- Align Errand service-route pricing with the approved AgriMarket route rate.
-- Existing Errand base/company/waiting/stop/cargo rules are unchanged.
-- Guard against changing the rate while an Errand is active.

do $$
declare
  v_active_count integer;
  v_current_rate numeric;
begin
  select count(*)::integer
    into v_active_count
  from public.bookings
  where lower(coalesce(service_type, '')) = 'errand'
    and status in (
      'requested','pending','searching','assigned','accepted',
      'fare_proposed','ready','on_the_way','arrived','on_trip'
    );

  if v_active_count > 0 then
    raise exception 'ERRAND_ROUTE_RATE_CHANGE_REQUIRES_NO_ACTIVE_ERRANDS: % active', v_active_count;
  end if;

  select route_rate_per_km
    into v_current_rate
  from public.errand_pricing_settings
  where singleton = true
  for update;

  if not found then
    raise exception 'ERRAND_PRICING_SETTINGS_MISSING';
  end if;

  if v_current_rate not in (15, 20) then
    raise exception 'ERRAND_ROUTE_RATE_UNEXPECTED_CURRENT_VALUE: %', v_current_rate;
  end if;

  update public.errand_pricing_settings
  set route_rate_per_km = 20,
      updated_at = now()
  where singleton = true;
end;
$$;

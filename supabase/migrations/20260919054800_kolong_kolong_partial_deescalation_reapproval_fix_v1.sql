-- Preserve AgriMarket reapproval semantics across three vehicle levels.
-- If a confirmed load partially de-escalates (Kolong-Kolong -> Tricycle),
-- keep approval at the new current requirement rather than leaving stale
-- Kolong-Kolong approval. A later Tricycle -> Kolong-Kolong escalation must
-- therefore require fresh customer approval.

create or replace function public.agrimarket_apply_weight_aware_vehicle_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_motorcycle_weight_max_kg numeric(10,3);
  v_checkout text;
  v_approved text;
  v_required_rank integer;
  v_old_required_rank integer;
  v_checkout_rank integer;
  v_approved_rank integer;
  v_deescalated_approval text;
begin
  if new.confirmed_cargo_weight_basis is null then
    new.required_vehicle_type := new.product_required_vehicle_type;
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
    new.customer_approved_vehicle_type := new.checkout_preferred_vehicle_type;
    return new;
  end if;

  select heavy_load_exact_tier2_max_kg
  into v_motorcycle_weight_max_kg
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_motorcycle_weight_max_kg is null then
    raise exception 'AGRIMARKET_STEP7_WEIGHT_SETTINGS_UNAVAILABLE' using errcode='P0001';
  end if;

  new.required_vehicle_type := public.agrimarket_compute_required_vehicle_v1(
    new.product_required_vehicle_type,
    new.confirmed_cargo_weight_basis,
    new.confirmed_cargo_weight_kg,
    new.confirmed_cargo_weight_band,
    new.confirmed_handling_tier,
    v_motorcycle_weight_max_kg
  );

  v_checkout := coalesce(
    new.checkout_preferred_vehicle_type,
    new.preferred_vehicle_type,
    'motorcycle'
  );
  v_approved := coalesce(new.customer_approved_vehicle_type,v_checkout);

  v_required_rank := public.jride_vehicle_rank_v1(new.required_vehicle_type);
  v_old_required_rank := public.jride_vehicle_rank_v1(old.required_vehicle_type);
  v_checkout_rank := public.jride_vehicle_rank_v1(v_checkout);
  v_approved_rank := public.jride_vehicle_rank_v1(v_approved);

  -- Three-level policy:
  -- A partial de-escalation from Kolong-Kolong to Tricycle must not leave
  -- historical Kolong-Kolong approval in place. Keep the current minimum
  -- requirement approved, so a later escalation back to Kolong-Kolong is
  -- evaluated as a fresh vehicle escalation by the reapproval trigger.
  if v_old_required_rank > v_required_rank then
    if v_required_rank <= v_checkout_rank then
      v_deescalated_approval := v_checkout;
    else
      v_deescalated_approval := new.required_vehicle_type;
    end if;

    new.preferred_vehicle_type := v_deescalated_approval;
    new.customer_approved_vehicle_type := v_deescalated_approval;
  elsif v_required_rank <= v_checkout_rank then
    new.preferred_vehicle_type := v_checkout;
    new.customer_approved_vehicle_type := v_checkout;
  elsif v_approved_rank >= v_required_rank then
    new.preferred_vehicle_type := v_approved;
  else
    new.preferred_vehicle_type := v_checkout;
  end if;

  return new;
end;
$function$;

do $postcondition$
declare
  v_row record;
begin
  create temporary table _kolong_vehicle_reapproval_test (
    required_vehicle_type text,
    product_required_vehicle_type text,
    checkout_preferred_vehicle_type text,
    preferred_vehicle_type text,
    customer_approved_vehicle_type text,
    confirmed_cargo_weight_basis text,
    confirmed_cargo_weight_kg numeric,
    confirmed_cargo_weight_band text,
    confirmed_handling_tier text
  ) on commit drop;

  create trigger _kolong_vehicle_reapproval_test_trg
  before update of
    confirmed_cargo_weight_basis,
    confirmed_cargo_weight_kg,
    confirmed_cargo_weight_band,
    confirmed_handling_tier,
    product_required_vehicle_type,
    checkout_preferred_vehicle_type
  on _kolong_vehicle_reapproval_test
  for each row
  execute function public.agrimarket_apply_weight_aware_vehicle_v1();

  insert into _kolong_vehicle_reapproval_test (
    required_vehicle_type,
    product_required_vehicle_type,
    checkout_preferred_vehicle_type,
    preferred_vehicle_type,
    customer_approved_vehicle_type,
    confirmed_cargo_weight_basis,
    confirmed_cargo_weight_kg,
    confirmed_cargo_weight_band,
    confirmed_handling_tier
  ) values (
    'kolong_kolong',
    'either',
    'motorcycle',
    'kolong_kolong',
    'kolong_kolong',
    'exact',
    150,
    null,
    'standard'
  );

  update _kolong_vehicle_reapproval_test
  set confirmed_cargo_weight_kg=75;

  select * into v_row from _kolong_vehicle_reapproval_test limit 1;

  if v_row.required_vehicle_type <> 'tricycle'
     or v_row.preferred_vehicle_type <> 'tricycle'
     or v_row.customer_approved_vehicle_type <> 'tricycle' then
    raise exception 'KOLONG_PARTIAL_DEESCALATION_RESET_FAILED';
  end if;

  update _kolong_vehicle_reapproval_test
  set confirmed_cargo_weight_kg=150;

  select * into v_row from _kolong_vehicle_reapproval_test limit 1;

  if v_row.required_vehicle_type <> 'kolong_kolong'
     or v_row.preferred_vehicle_type <> 'motorcycle'
     or v_row.customer_approved_vehicle_type <> 'tricycle' then
    raise exception 'KOLONG_REESCALATION_FRESH_APPROVAL_BASELINE_FAILED';
  end if;
end;
$postcondition$;

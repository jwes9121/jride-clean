-- JRIDE_AGRIMARKET_STEP1B_RPC_HARDENING_V1
-- Step 1B closure only. No pricing, fee, status, vehicle, or customer-flow change.
-- Retire superseded exact-only service-role entry points and keep the
-- order-weight trigger helper internal to the database trigger path.

do $$
begin
  if to_regprocedure('public.agrimarket_confirm_order_cargo_v2(text,uuid,text,numeric,text,text,timestamptz)') is null then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_REQUIRES_CONFIRM_ORDER_CARGO_V2';
  end if;

  if to_regprocedure('public.agrimarket_producer_decide_order_v6(text,uuid,text,integer,text,text,numeric,text,text,timestamptz)') is null then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_REQUIRES_PRODUCER_DECIDE_ORDER_V6';
  end if;

  if to_regprocedure('public.agrimarket_producer_harvest_action_v3(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,text,numeric,text,text,timestamptz)') is null then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_REQUIRES_PRODUCER_HARVEST_ACTION_V3';
  end if;
end;
$$;

revoke all on function public.agrimarket_confirm_order_cargo_v1(text,uuid,numeric,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.agrimarket_producer_decide_order_v5(text,uuid,text,integer,text,numeric,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.agrimarket_producer_harvest_action_v2(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,numeric,text,timestamptz)
  from public, anon, authenticated, service_role;

revoke all on function public.agrimarket_refresh_order_estimated_cargo_weight_v1()
  from public, anon, authenticated, service_role;

comment on function public.agrimarket_confirm_order_cargo_v1(text,uuid,numeric,text,timestamptz) is
  'Legacy Step 1 exact-only cargo confirmation. App-role execution revoked; superseded by agrimarket_confirm_order_cargo_v2.';
comment on function public.agrimarket_producer_decide_order_v5(text,uuid,text,integer,text,numeric,text,timestamptz) is
  'Legacy Step 1 exact-only producer decision wrapper. App-role execution revoked; superseded by agrimarket_producer_decide_order_v6.';
comment on function public.agrimarket_producer_harvest_action_v2(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,numeric,text,timestamptz) is
  'Legacy Step 1 exact-only harvest wrapper. App-role execution revoked; superseded by agrimarket_producer_harvest_action_v3.';
comment on function public.agrimarket_refresh_order_estimated_cargo_weight_v1() is
  'Internal trigger helper for Agrimarket order estimated cargo-weight snapshots. Direct app-role execution is revoked.';

do $$
begin
  if has_function_privilege('service_role', 'public.agrimarket_confirm_order_cargo_v1(text,uuid,numeric,text,timestamptz)', 'EXECUTE') then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_OLD_CONFIRM_RPC_STILL_EXECUTABLE';
  end if;

  if has_function_privilege('service_role', 'public.agrimarket_producer_decide_order_v5(text,uuid,text,integer,text,numeric,text,timestamptz)', 'EXECUTE') then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_OLD_DECISION_RPC_STILL_EXECUTABLE';
  end if;

  if has_function_privilege('service_role', 'public.agrimarket_producer_harvest_action_v2(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,numeric,text,timestamptz)', 'EXECUTE') then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_OLD_HARVEST_RPC_STILL_EXECUTABLE';
  end if;

  if has_function_privilege('anon', 'public.agrimarket_refresh_order_estimated_cargo_weight_v1()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.agrimarket_refresh_order_estimated_cargo_weight_v1()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.agrimarket_refresh_order_estimated_cargo_weight_v1()', 'EXECUTE') then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_TRIGGER_HELPER_STILL_APP_EXECUTABLE';
  end if;

  if not has_function_privilege('service_role', 'public.agrimarket_confirm_order_cargo_v2(text,uuid,text,numeric,text,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.agrimarket_producer_decide_order_v6(text,uuid,text,integer,text,text,numeric,text,text,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.agrimarket_producer_harvest_action_v3(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,text,numeric,text,text,timestamptz)', 'EXECUTE') then
    raise exception 'AGRIMARKET_STEP1B_HARDENING_CURRENT_RPC_PERMISSION_MISSING';
  end if;
end;
$$;

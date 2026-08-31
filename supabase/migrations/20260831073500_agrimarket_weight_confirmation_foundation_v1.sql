-- JRIDE_AGRIMARKET_WEIGHT_CONFIRMATION_FOUNDATION_V1
-- Step 1 only. No fee calculation, re-approval status, approach-fee change,
-- or weight-based vehicle escalation is introduced here.

alter table public.agrimarket_products
  add column unit_weight_kg numeric(12,3);

alter table public.agrimarket_products
  add constraint agrimarket_products_unit_weight_kg_chk
    check (unit_weight_kg is null or unit_weight_kg > 0);

comment on column public.agrimarket_products.unit_weight_kg is
  'Farmer-declared estimated kilograms per selling unit. For kg-based listings, one selling unit is one kilogram.';

update public.agrimarket_products
set unit_weight_kg = 1,
    updated_at = clock_timestamp()
where unit_weight_kg is null
  and lower(trim(selling_unit)) in ('kg','kgs','kilo','kilos','kilogram','kilograms');

alter table public.agrimarket_orders
  add column estimated_cargo_weight_kg numeric(12,3),
  add column confirmed_cargo_weight_kg numeric(12,3),
  add column confirmed_handling_tier text;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_estimated_cargo_weight_kg_chk
    check (estimated_cargo_weight_kg is null or estimated_cargo_weight_kg > 0),
  add constraint agrimarket_orders_confirmed_cargo_weight_kg_chk
    check (confirmed_cargo_weight_kg is null or confirmed_cargo_weight_kg > 0),
  add constraint agrimarket_orders_confirmed_handling_tier_chk
    check (
      confirmed_handling_tier is null
      or confirmed_handling_tier in ('standard','bulky','live_single','live_difficult')
    );

comment on column public.agrimarket_orders.estimated_cargo_weight_kg is
  'Checkout-time cargo-weight estimate. Null means at least one ordered product had no unit-weight estimate.';
comment on column public.agrimarket_orders.confirmed_cargo_weight_kg is
  'Farmer-confirmed actual total cargo weight before dispatch.';
comment on column public.agrimarket_orders.confirmed_handling_tier is
  'Farmer-confirmed order handling tier. It may not be below the minimum implied by ordered cargo classes.';

create or replace function public.agrimarket_refresh_order_estimated_cargo_weight_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_missing_weight_count integer;
  v_estimated_weight numeric(12,3);
begin
  select
    count(*) filter (where oi.product_id is null or p.unit_weight_kg is null),
    round(sum(p.unit_weight_kg * oi.quantity), 3)
  into v_missing_weight_count, v_estimated_weight
  from public.agrimarket_order_items oi
  left join public.agrimarket_products p on p.id = oi.product_id
  where oi.order_id = new.order_id;

  update public.agrimarket_orders
  set estimated_cargo_weight_kg =
        case
          when coalesce(v_missing_weight_count, 0) > 0 then null
          else v_estimated_weight
        end
  where id = new.order_id;

  return new;
end;
$$;

drop trigger if exists agrimarket_order_item_weight_snapshot_trg
  on public.agrimarket_order_items;

create trigger agrimarket_order_item_weight_snapshot_trg
after insert on public.agrimarket_order_items
for each row
execute function public.agrimarket_refresh_order_estimated_cargo_weight_v1();

with weight_rollup as (
  select
    oi.order_id,
    count(*) filter (where oi.product_id is null or p.unit_weight_kg is null) as missing_weight_count,
    round(sum(p.unit_weight_kg * oi.quantity), 3) as estimated_weight
  from public.agrimarket_order_items oi
  left join public.agrimarket_products p on p.id = oi.product_id
  group by oi.order_id
)
update public.agrimarket_orders o
set estimated_cargo_weight_kg =
      case
        when wr.missing_weight_count > 0 then null
        else wr.estimated_weight
      end
from weight_rollup wr
where o.id = wr.order_id;

create or replace function public.agrimarket_confirm_order_cargo_v1(
  p_order_code text,
  p_producer_id uuid,
  p_confirmed_cargo_weight_kg numeric,
  p_confirmed_handling_tier text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_tier text := lower(trim(coalesce(p_confirmed_handling_tier,'')));
  v_min_rank integer := 0;
  v_selected_rank integer := -1;
  v_min_tier text := 'standard';
begin
  if trim(coalesce(p_order_code,'')) = '' or p_producer_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PRODUCER_AUTH_REQUIRED');
  end if;

  if p_confirmed_cargo_weight_kg is null or p_confirmed_cargo_weight_kg <= 0 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CONFIRMED_CARGO_WEIGHT_REQUIRED');
  end if;

  v_selected_rank := case v_tier
    when 'standard' then 0
    when 'bulky' then 1
    when 'live_single' then 2
    when 'live_difficult' then 3
    else -1
  end;

  if v_selected_rank < 0 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_HANDLING_TIER');
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code = trim(p_order_code)
  for update;

  if v_order.id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND');
  end if;

  if v_order.producer_id <> p_producer_id
     or not exists (
       select 1
       from public.agrimarket_producers p
       where p.id = p_producer_id
         and p.status = 'active'
     ) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER');
  end if;

  if v_order.status not in ('awaiting_producer','awaiting_harvest','producer_accepted','preparing') then
    return jsonb_build_object(
      'ok',false,
      'error','AGRIMARKET_CARGO_CONFIRMATION_WRONG_STATUS',
      'status',v_order.status
    );
  end if;

  select coalesce(
           max(
             case
               when oi.cargo_class = 'live_livestock' then 2
               when oi.cargo_class in ('crate','bulk_sack','live_poultry') then 1
               else 0
             end
           ),
           0
         )
  into v_min_rank
  from public.agrimarket_order_items oi
  where oi.order_id = v_order.id;

  v_min_tier := case v_min_rank
    when 2 then 'live_single'
    when 1 then 'bulky'
    else 'standard'
  end;

  if v_selected_rank < v_min_rank then
    return jsonb_build_object(
      'ok',false,
      'error','AGRIMARKET_HANDLING_TIER_BELOW_MINIMUM',
      'minimum_handling_tier',v_min_tier
    );
  end if;

  update public.agrimarket_orders
  set confirmed_cargo_weight_kg = round(p_confirmed_cargo_weight_kg, 3),
      confirmed_handling_tier = v_tier,
      updated_at = p_now
  where id = v_order.id;

  insert into public.agrimarket_order_events(
    order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
  )
  values(
    v_order.id,
    v_order.status,
    v_order.status,
    'producer',
    p_producer_id,
    'cargo_confirmation_recorded',
    jsonb_build_object(
      'estimated_cargo_weight_kg',v_order.estimated_cargo_weight_kg,
      'confirmed_cargo_weight_kg',round(p_confirmed_cargo_weight_kg,3),
      'minimum_handling_tier',v_min_tier,
      'confirmed_handling_tier',v_tier
    ),
    p_now
  );

  return jsonb_build_object(
    'ok',true,
    'order_code',v_order.order_code,
    'estimated_cargo_weight_kg',v_order.estimated_cargo_weight_kg,
    'confirmed_cargo_weight_kg',round(p_confirmed_cargo_weight_kg,3),
    'minimum_handling_tier',v_min_tier,
    'confirmed_handling_tier',v_tier
  );
end;
$$;

create or replace function public.agrimarket_producer_decide_order_v5(
  p_order_code text,
  p_producer_id uuid,
  p_decision text,
  p_preparation_minutes integer default null,
  p_reason text default null,
  p_confirmed_cargo_weight_kg numeric default null,
  p_confirmed_handling_tier text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_result jsonb;
  v_confirmation jsonb;
begin
  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code = trim(coalesce(p_order_code,''));

  if v_decision = 'accept'
     and v_order.id is not null
     and v_order.status = 'awaiting_producer'
     and v_order.fulfillment_mode = 'always_available'
     and (
       p_confirmed_cargo_weight_kg is null
       or p_confirmed_cargo_weight_kg <= 0
       or trim(coalesce(p_confirmed_handling_tier,'')) = ''
     ) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_CONFIRMATION_REQUIRED');
  end if;

  begin
    v_result := public.agrimarket_producer_decide_order_v4(
      p_order_code,
      p_producer_id,
      p_decision,
      p_preparation_minutes,
      p_reason,
      p_now
    );

    if coalesce((v_result->>'ok')::boolean,false) is false then
      return v_result;
    end if;

    if v_decision = 'accept'
       and v_order.id is not null
       and v_order.status = 'awaiting_producer'
       and v_order.fulfillment_mode = 'always_available'
       and coalesce((v_result->>'already_done')::boolean,false) is false then
      v_confirmation := public.agrimarket_confirm_order_cargo_v1(
        p_order_code,
        p_producer_id,
        p_confirmed_cargo_weight_kg,
        p_confirmed_handling_tier,
        p_now
      );

      if coalesce((v_confirmation->>'ok')::boolean,false) is false then
        raise exception '%',
          coalesce(v_confirmation->>'error','AGRIMARKET_CARGO_CONFIRMATION_FAILED')
          using errcode = 'P0001';
      end if;

      return v_result || jsonb_build_object('cargo_confirmation',v_confirmation);
    end if;

    return v_result;
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('ok',false,'error',sqlerrm);
  end;
end;
$$;

create or replace function public.agrimarket_producer_harvest_action_v2(
  p_order_code text,
  p_producer_id uuid,
  p_action text,
  p_preparation_minutes integer default null,
  p_proposed_start_at timestamptz default null,
  p_proposed_end_at timestamptz default null,
  p_proposed_items jsonb default '[]'::jsonb,
  p_reason text default null,
  p_confirmed_cargo_weight_kg numeric default null,
  p_confirmed_handling_tier text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_result jsonb;
  v_confirmation jsonb;
begin
  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code = trim(coalesce(p_order_code,''));

  if v_action = 'ready'
     and v_order.id is not null
     and v_order.status = 'awaiting_harvest'
     and (
       p_confirmed_cargo_weight_kg is null
       or p_confirmed_cargo_weight_kg <= 0
       or trim(coalesce(p_confirmed_handling_tier,'')) = ''
     ) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_CONFIRMATION_REQUIRED');
  end if;

  begin
    v_result := public.agrimarket_producer_harvest_action_v1(
      p_order_code,
      p_producer_id,
      p_action,
      p_preparation_minutes,
      p_proposed_start_at,
      p_proposed_end_at,
      p_proposed_items,
      p_reason,
      p_now
    );

    if coalesce((v_result->>'ok')::boolean,false) is false then
      return v_result;
    end if;

    if v_action = 'ready'
       and v_order.id is not null
       and v_order.status = 'awaiting_harvest' then
      v_confirmation := public.agrimarket_confirm_order_cargo_v1(
        p_order_code,
        p_producer_id,
        p_confirmed_cargo_weight_kg,
        p_confirmed_handling_tier,
        p_now
      );

      if coalesce((v_confirmation->>'ok')::boolean,false) is false then
        raise exception '%',
          coalesce(v_confirmation->>'error','AGRIMARKET_CARGO_CONFIRMATION_FAILED')
          using errcode = 'P0001';
      end if;

      return v_result || jsonb_build_object('cargo_confirmation',v_confirmation);
    end if;

    return v_result;
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('ok',false,'error',sqlerrm);
  end;
end;
$$;

revoke all on function public.agrimarket_confirm_order_cargo_v1(text,uuid,numeric,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.agrimarket_producer_decide_order_v5(text,uuid,text,integer,text,numeric,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.agrimarket_producer_harvest_action_v2(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,numeric,text,timestamptz)
  from public, anon, authenticated;

grant execute on function public.agrimarket_confirm_order_cargo_v1(text,uuid,numeric,text,timestamptz)
  to service_role;
grant execute on function public.agrimarket_producer_decide_order_v5(text,uuid,text,integer,text,numeric,text,timestamptz)
  to service_role;
grant execute on function public.agrimarket_producer_harvest_action_v2(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,numeric,text,timestamptz)
  to service_role;
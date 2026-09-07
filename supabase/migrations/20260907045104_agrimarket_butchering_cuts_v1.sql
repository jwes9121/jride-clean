-- Internal retry receipt: the farmer API creates all cuts in one transaction.
create table public.agrimarket_butchering_batches (
  request_id uuid primary key,
  producer_id uuid not null references public.agrimarket_producers(id),
  request_payload jsonb not null check (jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=65536),
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 30),
  created_at timestamptz not null default clock_timestamp()
);
create index agrimarket_butchering_batches_producer_idx on public.agrimarket_butchering_batches(producer_id);
alter table public.agrimarket_butchering_batches enable row level security;
revoke all on public.agrimarket_butchering_batches from public,anon,authenticated;
grant all on public.agrimarket_butchering_batches to service_role;

create function public.agrimarket_create_butchering_batch_v1(p_producer_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  saved agrimarket_butchering_batches%rowtype;
  cut jsonb; cut_name text; names text[] := '{}'; ids uuid[] := '{}'; product_id uuid;
  starts timestamptz; ends timestamptz; cutoff timestamptz; price numeric; quantity numeric; prep integer;
begin
  if p_producer_id is null or p_request_id is null or coalesce(jsonb_typeof(p_payload),'')<>'object' or octet_length(p_payload::text)>65536 then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
  if not exists(select 1 from agrimarket_producers where id=p_producer_id and status='active') then raise exception 'BUTCHERING_PRODUCER_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_butchering:'||p_request_id::text,0));
  select * into saved from agrimarket_butchering_batches where request_id=p_request_id;
  if found then
    if saved.producer_id<>p_producer_id or saved.request_payload<>p_payload then raise exception 'BUTCHERING_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('request_id',p_request_id,'product_ids',saved.product_ids,'replayed',true);
  end if;
  if coalesce(length(btrim(p_payload->>'species')),0) not between 2 and 60
    or length(coalesce(p_payload->>'breed',''))>80 or length(coalesce(p_payload->>'description',''))>2000
    or coalesce(p_payload->>'condition','') not in ('fresh','chilled')
    or coalesce(p_payload->>'vehicle_requirement','') not in ('either','motorcycle','tricycle')
    or coalesce(jsonb_typeof(p_payload->'is_active'),'')<>'boolean'
    or coalesce(jsonb_typeof(p_payload->'cuts'),'')<>'array' then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
  if jsonb_array_length(p_payload->'cuts') not between 1 and 30 then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
  begin
    starts := (p_payload->>'butcher_start_at')::timestamptz;
    ends := (p_payload->>'butcher_end_at')::timestamptz;
    cutoff := (p_payload->>'order_cutoff_at')::timestamptz;
    prep := (p_payload->>'default_prep_minutes')::integer;
  exception when others then raise exception 'BUTCHERING_INPUT_INVALID'; end;
  if starts is null or cutoff is null or not isfinite(starts) or not isfinite(cutoff)
    or (ends is not null and (not isfinite(ends) or ends<starts))
    or cutoff<=clock_timestamp() or cutoff>=starts then raise exception 'BUTCHERING_SCHEDULE_INVALID'; end if;
  if prep is null or prep not between 0 and 1440 then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
  for cut in select value from jsonb_array_elements(p_payload->'cuts') loop
    cut_name := btrim(cut->>'name');
    if coalesce(length(cut_name),0) not between 2 and 80 or lower(cut_name)=any(names)
      or coalesce(cut->>'price_per_kg','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(cut->>'available_kg','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
    price := (cut->>'price_per_kg')::numeric; quantity := (cut->>'available_kg')::numeric;
    if price<=0 or price>999999.99 or quantity<=0 or quantity>100000 then raise exception 'BUTCHERING_INPUT_INVALID'; end if;
    names := array_append(names,lower(cut_name));
    insert into agrimarket_products(producer_id,name,description,product_group,species,breed,meat_cut,condition,cargo_class,selling_unit,unit_weight_kg,unit_price,listed_quantity,availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,vehicle_requirement,is_active)
    values(p_producer_id,(p_payload->>'species')||' - '||cut_name,p_payload->>'description','meat',p_payload->>'species',p_payload->>'breed',cut_name,p_payload->>'condition',case p_payload->>'condition' when 'chilled' then 'chilled_meat' else 'fresh_meat' end,'kg',1,price,quantity,'scheduled_harvest',starts,ends,cutoff,prep,p_payload->>'vehicle_requirement',(p_payload->>'is_active')::boolean)
    returning id into product_id;
    ids := array_append(ids,product_id);
  end loop;
  insert into agrimarket_butchering_batches(request_id,producer_id,request_payload,product_ids) values(p_request_id,p_producer_id,p_payload,ids);
  return jsonb_build_object('request_id',p_request_id,'product_ids',ids,'replayed',false);
end; $$;
revoke all on function public.agrimarket_create_butchering_batch_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agrimarket_create_butchering_batch_v1(uuid,uuid,jsonb) to service_role;

create table public.agrimarket_producer_access_events (
  id bigint generated always as identity primary key,
  producer_id uuid not null references public.agrimarket_producers(id) on delete cascade,
  event_type text not null,
  actor text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agrimarket_producer_access_events_type_chk check (
    event_type in ('pin_reset','access_revoked','farmer_suspended','farmer_reactivated')
  )
);

create index agrimarket_producer_access_events_producer_idx
  on public.agrimarket_producer_access_events(producer_id, created_at desc);

alter table public.agrimarket_producer_access_events enable row level security;
revoke all on table public.agrimarket_producer_access_events from public, anon, authenticated;
grant all privileges on table public.agrimarket_producer_access_events to service_role;

create or replace function public.agrimarket_admin_manage_farmer_access_v1(
  p_producer_id uuid,
  p_action text,
  p_actor text,
  p_reason text default null,
  p_new_pin text default null,
  p_now timestamptz default clock_timestamp()
)
returns table(
  producer_id uuid,
  producer_status text,
  accepting_orders boolean,
  credential_status text,
  access_code text,
  action text,
  active_order_count integer
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_producer public.agrimarket_producers%rowtype;
  v_credential public.agrimarket_producer_credentials%rowtype;
  v_active_orders integer := 0;
begin
  if p_producer_id is null then
    raise exception 'AGRIMARKET_PRODUCER_ID_REQUIRED' using errcode='P0001';
  end if;

  if v_action not in ('reset_pin','revoke_access','suspend_farmer','reactivate_farmer') then
    raise exception 'AGRIMARKET_FARMER_ACCESS_ACTION_INVALID' using errcode='P0001';
  end if;

  if v_action in ('revoke_access','suspend_farmer') and v_reason is null then
    raise exception 'AGRIMARKET_FARMER_ACCESS_REASON_REQUIRED' using errcode='P0001';
  end if;

  if v_action = 'reset_pin' and (p_new_pin is null or p_new_pin !~ '^[0-9]{6}$') then
    raise exception 'AGRIMARKET_NEW_PIN_INVALID' using errcode='P0001';
  end if;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id = p_producer_id
  for update;

  if v_producer.id is null then
    raise exception 'AGRIMARKET_PRODUCER_NOT_FOUND' using errcode='P0001';
  end if;

  select c.* into v_credential
  from public.agrimarket_producer_credentials c
  where c.producer_id = p_producer_id
  for update;

  if v_credential.id is null then
    raise exception 'AGRIMARKET_PRODUCER_CREDENTIAL_NOT_FOUND' using errcode='P0001';
  end if;

  select count(*)::integer into v_active_orders
  from public.agrimarket_orders o
  where o.producer_id = p_producer_id
    and o.status not in ('completed','cancelled','producer_rejected','producer_timeout');

  if v_action = 'reset_pin' then
    update public.agrimarket_producer_credentials c
    set pin_hash = crypt(p_new_pin, gen_salt('bf')),
        status = 'active',
        failed_attempts = 0,
        locked_until = null,
        updated_at = p_now
    where c.id = v_credential.id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'pin_reset',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('access_code',v_credential.access_code),p_now
    );

  elsif v_action = 'revoke_access' then
    update public.agrimarket_producer_credentials c
    set status = 'revoked',
        failed_attempts = 0,
        locked_until = null,
        updated_at = p_now
    where c.id = v_credential.id;

    update public.agrimarket_producers p
    set status = 'suspended',
        accepting_orders = false,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'access_revoked',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('active_order_count',v_active_orders),p_now
    );

  elsif v_action = 'suspend_farmer' then
    update public.agrimarket_producers p
    set status = 'suspended',
        accepting_orders = false,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'farmer_suspended',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('credential_status',v_credential.status,'active_order_count',v_active_orders),p_now
    );

  else
    if v_credential.status <> 'active' then
      raise exception 'AGRIMARKET_CREDENTIAL_NOT_ACTIVE_RESET_PIN_REQUIRED' using errcode='P0001';
    end if;

    update public.agrimarket_producers p
    set status = 'active',
        accepting_orders = true,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'farmer_reactivated',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('credential_status',v_credential.status),p_now
    );
  end if;

  return query
  select p.id,
         p.status,
         p.accepting_orders,
         c.status,
         c.access_code,
         v_action,
         v_active_orders
  from public.agrimarket_producers p
  join public.agrimarket_producer_credentials c on c.producer_id=p.id
  where p.id=p_producer_id;
end;
$$;

revoke all on function public.agrimarket_admin_manage_farmer_access_v1(uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.agrimarket_admin_manage_farmer_access_v1(uuid,text,text,text,text,timestamptz)
  to service_role;

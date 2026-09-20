-- Farmer trading hours are separate from Admin readiness and existing delivery work.
-- Default true preserves the current availability of every existing store.
alter table public.agrimarket_producers
  add column store_open boolean not null default true;

comment on column public.agrimarket_producers.store_open is
  'Farmer-controlled new-order switch. Requires active status and Admin accepting_orders readiness. Does not stop existing orders.';

create function public.agrimarket_guard_store_open_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_open boolean;
begin
  -- Serialize checkout against a concurrent store closure. Updates to existing
  -- orders are intentionally excluded so dispatch and fulfillment can continue.
  select store_open into v_open from public.agrimarket_producers
  where id = new.producer_id for share;
  if v_open is distinct from true then
    raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE_STORE_CLOSED';
  end if;
  return new;
end;
$$;

create trigger agrimarket_guard_store_open_trg
before insert on public.agrimarket_orders
for each row execute function public.agrimarket_guard_store_open_v1();

revoke all on function public.agrimarket_guard_store_open_v1() from public, anon, authenticated;

create or replace function public.agrimarket_guard_driver_offer_while_cash_unsettled_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.agrimarket_orders o
    where o.id <> new.order_id
      and o.assigned_driver_id = new.driver_id
      and (
        o.status in ('driver_assigned','picked_up','delivering')
        or (o.status='delivered' and o.wallet_settlement_status in ('pending','failed'))
      )
  ) then
    raise exception 'AGRIMARKET_DRIVER_HAS_ACTIVE_OR_UNSETTLED_ORDER' using errcode='P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists agrimarket_driver_offer_cash_unsettled_guard on public.agrimarket_driver_offers;
create trigger agrimarket_driver_offer_cash_unsettled_guard
before insert on public.agrimarket_driver_offers
for each row
execute function public.agrimarket_guard_driver_offer_while_cash_unsettled_v1();

revoke all on function public.agrimarket_guard_driver_offer_while_cash_unsettled_v1() from public,anon,authenticated;
grant execute on function public.agrimarket_guard_driver_offer_while_cash_unsettled_v1() to service_role;

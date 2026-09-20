-- Store names are customer-visible only when opening a store profile.
comment on column public.agrimarket_producers.vendor_name is
  'Required store identity before publishing or accepting orders. Public on store profile, omitted from search results. Contact and pickup details remain private.';
alter table public.agrimarket_producers add constraint agrimarket_accepting_store_name_required
check (not accepting_orders or (vendor_name is not null and length(trim(vendor_name)) between 2 and 60));

create or replace function public.agrimarket_require_product_store_name_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.is_active and not exists(select 1 from public.agrimarket_producers where id=new.producer_id and length(trim(vendor_name)) between 2 and 60) then
    raise exception 'AGRIMARKET_STORE_NAME_REQUIRED' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger agrimarket_require_product_store_name_trg before insert or update of is_active on public.agrimarket_products
for each row execute function public.agrimarket_require_product_store_name_v1();
revoke all on function public.agrimarket_require_product_store_name_v1() from public,anon,authenticated;

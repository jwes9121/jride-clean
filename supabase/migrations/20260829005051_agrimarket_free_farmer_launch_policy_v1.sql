update public.agrimarket_producers
set joining_fee = 0,
    listing_fee = 0,
    marketplace_fee_percent = 0,
    updated_at = clock_timestamp()
where joining_fee <> 0
   or listing_fee <> 0
   or marketplace_fee_percent <> 0;

alter table public.agrimarket_producers
  alter column joining_fee set default 0,
  alter column listing_fee set default 0,
  alter column marketplace_fee_percent set default 0;

alter table public.agrimarket_producers
  drop constraint if exists agrimarket_free_launch_joining_fee_chk,
  drop constraint if exists agrimarket_free_launch_listing_fee_chk,
  drop constraint if exists agrimarket_free_launch_marketplace_fee_chk;

alter table public.agrimarket_producers
  add constraint agrimarket_free_launch_joining_fee_chk check (joining_fee = 0),
  add constraint agrimarket_free_launch_listing_fee_chk check (listing_fee = 0),
  add constraint agrimarket_free_launch_marketplace_fee_chk check (marketplace_fee_percent = 0);

create or replace function public.agrimarket_enforce_free_farmer_launch_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.marketplace_fee := 0;
  new.pricing_snapshot := coalesce(new.pricing_snapshot, '{}'::jsonb) || jsonb_build_object(
    'marketplace_fee_percent', 0,
    'farmer_fee_policy', 'free_launch_v1'
  );
  return new;
end;
$$;

revoke all on function public.agrimarket_enforce_free_farmer_launch_v1() from public, anon, authenticated;
grant execute on function public.agrimarket_enforce_free_farmer_launch_v1() to service_role;

drop trigger if exists agrimarket_enforce_free_farmer_launch_v1 on public.agrimarket_orders;
create trigger agrimarket_enforce_free_farmer_launch_v1
before insert or update of marketplace_fee, pricing_snapshot
on public.agrimarket_orders
for each row
execute function public.agrimarket_enforce_free_farmer_launch_v1();

update public.agrimarket_orders
set marketplace_fee = 0,
    pricing_snapshot = coalesce(pricing_snapshot, '{}'::jsonb) || jsonb_build_object(
      'marketplace_fee_percent', 0,
      'farmer_fee_policy', 'free_launch_v1'
    ),
    updated_at = clock_timestamp()
where marketplace_fee <> 0
   or coalesce(pricing_snapshot->>'farmer_fee_policy','') <> 'free_launch_v1';

comment on column public.agrimarket_producers.marketplace_fee_percent is
  'Agrimarket launch policy: 0 percent. Farmer participation and selling are free until a future policy migration explicitly changes this.';

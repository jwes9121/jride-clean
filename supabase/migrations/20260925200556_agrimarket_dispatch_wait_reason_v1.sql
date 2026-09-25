-- Latest dispatcher check for the customer tracker. No driver identities or
-- precise locations are exposed; these fields are written by the cron only.
alter table public.agrimarket_orders
  add column dispatch_wait_code text,
  add column dispatch_wait_vehicle_type text,
  add column dispatch_checked_at timestamptz;

alter table public.agrimarket_orders
  add constraint agrimarket_dispatch_wait_code_chk check (
    dispatch_wait_code is null or dispatch_wait_code in (
      'no_online_vehicle','no_approved_driver','no_eligible_driver',
      'outside_pickup_range','route_unavailable','search_unavailable'
    )
  );

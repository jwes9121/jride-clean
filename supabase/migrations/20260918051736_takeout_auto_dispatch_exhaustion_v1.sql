alter table public.bookings
  add column if not exists takeout_auto_dispatch_exhausted boolean not null default false,
  add column if not exists takeout_auto_dispatch_exhausted_at timestamptz null;

update public.bookings
set
  takeout_auto_dispatch_exhausted = true,
  takeout_auto_dispatch_exhausted_at = coalesce(
    takeout_auto_dispatch_exhausted_at,
    updated_at,
    now()
  )
where service_type = 'takeout'
  and (
    takeout_pricing_status = 'driver_unavailable'
    or vendor_status = 'driver_unavailable'
    or customer_status = 'driver_unavailable'
  );

comment on column public.bookings.takeout_auto_dispatch_exhausted is
  'True once automatic Takeout driver dispatch is exhausted. Manual recovery may assign a driver but must not clear this flag.';

comment on column public.bookings.takeout_auto_dispatch_exhausted_at is
  'Timestamp when automatic Takeout driver dispatch was first exhausted.';

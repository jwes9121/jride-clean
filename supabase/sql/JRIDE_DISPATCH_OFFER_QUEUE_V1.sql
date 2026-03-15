begin;

create table if not exists public.dispatch_driver_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_code text not null,
  driver_id uuid not null,
  offer_rank integer not null,
  status text not null check (status in ('offered','accepted','rejected','expired','cancelled','skipped')),
  offered_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  responded_at timestamp with time zone null,
  response_source text null,
  source text null,
  town text null,
  pickup_lat double precision null,
  pickup_lng double precision null,
  score numeric null,
  note text null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_dispatch_driver_offers_booking_rank
  on public.dispatch_driver_offers (booking_id, offer_rank);

create index if not exists idx_dispatch_driver_offers_driver
  on public.dispatch_driver_offers (driver_id, offered_at desc);

create index if not exists idx_dispatch_driver_offers_status
  on public.dispatch_driver_offers (status, expires_at);

create unique index if not exists uq_dispatch_driver_offers_booking_rank
  on public.dispatch_driver_offers (booking_id, offer_rank);

commit;
-- JRIDE Vendor Phase 2A/2D Schema
-- Creates:
--   vendor_menu_items (stable catalog)
--   vendor_menu_item_day_state (daily availability + last_updated)
--   order_menu_snapshots + order_menu_snapshot_items (order lock)
--
-- NOTE:
-- - Assumes vendor accounts table is: public.vendor_accounts(id uuid)
-- - Does NOT enable RLS here (keep behavior consistent with your current pilot mode).
-- - You can add RLS later when vendor auth exists.

begin;

-- 1) Stable vendor menu catalog
create table if not exists public.vendor_menu_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  sort_order int not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_menu_items_vendor_id_idx
  on public.vendor_menu_items(vendor_id);

create index if not exists vendor_menu_items_vendor_sort_idx
  on public.vendor_menu_items(vendor_id, sort_order, created_at);

-- 2) Daily state (availability + sold out + responsibility timestamp)
create table if not exists public.vendor_menu_item_day_state (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  menu_item_id uuid not null references public.vendor_menu_items(id) on delete cascade,

  service_date date not null,
  is_available_today boolean not null default true,
  is_sold_out_today boolean not null default false,
  last_updated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vendor_menu_item_day_state_unique unique(menu_item_id, service_date)
);

create index if not exists vendor_menu_item_day_state_vendor_date_idx
  on public.vendor_menu_item_day_state(vendor_id, service_date);

create index if not exists vendor_menu_item_day_state_item_date_idx
  on public.vendor_menu_item_day_state(menu_item_id, service_date);

-- 3) Order snapshot header (Phase 2D foundation)
create table if not exists public.order_menu_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  vendor_id uuid not null references public.vendor_accounts(id) on delete restrict,

  created_at timestamptz not null default now()
);

create index if not exists order_menu_snapshots_order_id_idx
  on public.order_menu_snapshots(order_id);

create index if not exists order_menu_snapshots_vendor_id_idx
  on public.order_menu_snapshots(vendor_id);

-- 4) Snapshot line items (frozen name/price)
create table if not exists public.order_menu_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.order_menu_snapshots(id) on delete cascade,

  menu_item_id uuid references public.vendor_menu_items(id) on delete set null, -- keep snapshot even if item changes/deactivates
  name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  qty int not null check (qty > 0),
  line_total numeric(12,2) not null check (line_total >= 0),

  notes text,

  created_at timestamptz not null default now()
);

create index if not exists order_menu_snapshot_items_snapshot_idx
  on public.order_menu_snapshot_items(snapshot_id);

-- 5) Updated-at trigger helper
create or replace function public._touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_vendor_menu_items_touch on public.vendor_menu_items;
create trigger trg_vendor_menu_items_touch
before update on public.vendor_menu_items
for each row execute function public._touch_updated_at();

drop trigger if exists trg_vendor_menu_item_day_state_touch on public.vendor_menu_item_day_state;
create trigger trg_vendor_menu_item_day_state_touch
before update on public.vendor_menu_item_day_state
for each row execute function public._touch_updated_at();

-- 6) Convenience view: today's menu state (server should still filter by vendor_id)
-- NOTE: "today" uses the DB timezone; app can pass service_date explicitly if needed.
create or replace view public.vendor_menu_today as
select
  i.id as menu_item_id,
  i.vendor_id,
  i.name,
  i.description,
  i.price,
  i.sort_order,
  i.is_active,
  coalesce(s.service_date, current_date) as service_date,
  coalesce(s.is_available_today, true) as is_available_today,
  coalesce(s.is_sold_out_today, false) as is_sold_out_today,
  coalesce(s.last_updated_at, i.updated_at) as last_updated_at
from public.vendor_menu_items i
left join public.vendor_menu_item_day_state s
  on s.menu_item_id = i.id
 and s.service_date = current_date
where i.is_active = true;

commit;
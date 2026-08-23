begin;

create table if not exists public.vendor_performance_settings (
  vendor_id uuid primary key references public.vendor_accounts(id) on delete cascade,
  metrics_started_at timestamptz not null default clock_timestamp(),
  public_acceptance_min_decisions integer not null default 10 check (public_acceptance_min_decisions >= 1),
  public_rating_min_surveys integer not null default 5 check (public_rating_min_surveys >= 1),
  recent_decision_limit integer not null default 20 check (recent_decision_limit between 10 and 100),
  recent_rating_limit integer not null default 20 check (recent_rating_limit between 5 and 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

with baseline as (
  select clock_timestamp() as started_at
)
insert into public.vendor_performance_settings (
  vendor_id,
  metrics_started_at
)
select va.id, baseline.started_at
from public.vendor_accounts va
cross join baseline
on conflict (vendor_id) do nothing;

create or replace function public.ensure_vendor_performance_settings_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vendor_performance_settings (vendor_id, metrics_started_at)
  values (new.id, clock_timestamp())
  on conflict (vendor_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_vendor_performance_settings_v1 on public.vendor_accounts;
create trigger trg_vendor_performance_settings_v1
after insert on public.vendor_accounts
for each row execute function public.ensure_vendor_performance_settings_v1();

create table if not exists public.analytics_test_subjects (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('passenger', 'vendor')),
  subject_id uuid not null,
  reason text not null,
  active boolean not null default true,
  marked_by text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (subject_type, subject_id)
);

create index if not exists idx_analytics_test_subjects_active
  on public.analytics_test_subjects(subject_type, subject_id)
  where active = true;

create table if not exists public.analytics_booking_exclusions (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  reason text not null,
  active boolean not null default true,
  marked_by text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_analytics_booking_exclusions_active
  on public.analytics_booking_exclusions(booking_id)
  where active = true;

create table if not exists public.vendor_presence_current (
  vendor_id uuid primary key references public.vendor_accounts(id) on delete cascade,
  last_seen_at timestamptz not null,
  surface text not null default 'web',
  user_agent text null,
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_vendor_presence_current_last_seen
  on public.vendor_presence_current(last_seen_at desc);

create table if not exists public.vendor_presence_buckets (
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  bucket_start timestamptz not null,
  surface text not null default 'web',
  created_at timestamptz not null default clock_timestamp(),
  primary key (vendor_id, bucket_start)
);

create index if not exists idx_vendor_presence_buckets_range
  on public.vendor_presence_buckets(vendor_id, bucket_start desc);

alter table public.bookings
  add column if not exists vendor_responded_at timestamptz,
  add column if not exists vendor_accepted_at timestamptz,
  add column if not exists vendor_rejected_at timestamptz,
  add column if not exists vendor_timeout_at timestamptz;

create index if not exists idx_bookings_vendor_metrics_window
  on public.bookings(vendor_id, created_at desc)
  where service_type = 'takeout';

create or replace function public.capture_takeout_vendor_response_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_vendor_status text := lower(trim(coalesce(old.vendor_status, '')));
  new_vendor_status text := lower(trim(coalesce(new.vendor_status, '')));
  had_acceptance boolean := false;
begin
  if lower(trim(coalesce(new.service_type, ''))) <> 'takeout' then
    return new;
  end if;

  had_acceptance :=
    old.vendor_accepted_at is not null
    or old_vendor_status in (
      'vendor_accepted', 'accepted', 'preparing', 'preparing_order',
      'driver_assigned', 'driver_accepted', 'pickup_ready', 'ready',
      'rider_arrived_vendor', 'arrived_vendor', 'picked_up',
      'delivering', 'completed'
    )
    or old.assigned_driver_id is not null
    or old.driver_id is not null
    or old.takeout_fee_proposed_at is not null
    or old.takeout_customer_confirmed_at is not null
    or old.completed_at is not null;

  if new_vendor_status is distinct from old_vendor_status then
    if new_vendor_status in (
      'vendor_accepted', 'accepted', 'preparing', 'preparing_order',
      'driver_assigned', 'driver_accepted', 'pickup_ready', 'ready',
      'rider_arrived_vendor', 'arrived_vendor', 'picked_up',
      'delivering', 'completed'
    ) then
      if new.vendor_accepted_at is null then
        new.vendor_accepted_at := clock_timestamp();
      end if;
      if new.vendor_responded_at is null then
        new.vendor_responded_at := new.vendor_accepted_at;
      end if;
    elsif new_vendor_status = 'vendor_timeout' then
      if new.vendor_timeout_at is null then
        new.vendor_timeout_at := clock_timestamp();
      end if;
      if new.vendor_responded_at is null then
        new.vendor_responded_at := new.vendor_timeout_at;
      end if;
    elsif new_vendor_status in ('cancelled', 'canceled', 'rejected', 'vendor_rejected') and not had_acceptance then
      if new.vendor_rejected_at is null then
        new.vendor_rejected_at := clock_timestamp();
      end if;
      if new.vendor_responded_at is null then
        new.vendor_responded_at := new.vendor_rejected_at;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_capture_takeout_vendor_response_v1 on public.bookings;
create trigger trg_capture_takeout_vendor_response_v1
before update of vendor_status on public.bookings
for each row execute function public.capture_takeout_vendor_response_v1();

create or replace function public.touch_vendor_metrics_updated_at_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_vendor_performance_settings_touch_v1 on public.vendor_performance_settings;
create trigger trg_vendor_performance_settings_touch_v1
before update on public.vendor_performance_settings
for each row execute function public.touch_vendor_metrics_updated_at_v1();

drop trigger if exists trg_analytics_test_subjects_touch_v1 on public.analytics_test_subjects;
create trigger trg_analytics_test_subjects_touch_v1
before update on public.analytics_test_subjects
for each row execute function public.touch_vendor_metrics_updated_at_v1();

drop trigger if exists trg_analytics_booking_exclusions_touch_v1 on public.analytics_booking_exclusions;
create trigger trg_analytics_booking_exclusions_touch_v1
before update on public.analytics_booking_exclusions
for each row execute function public.touch_vendor_metrics_updated_at_v1();

alter table public.vendor_performance_settings enable row level security;
alter table public.analytics_test_subjects enable row level security;
alter table public.analytics_booking_exclusions enable row level security;
alter table public.vendor_presence_current enable row level security;
alter table public.vendor_presence_buckets enable row level security;

comment on table public.vendor_performance_settings is
  'Per-vendor public performance cutoff and display thresholds. Historical orders remain intact but are not counted before metrics_started_at.';
comment on table public.analytics_test_subjects is
  'Explicit audit registry for passenger or vendor test accounts. Never infer dummy status from names.';
comment on table public.analytics_booking_exclusions is
  'Explicit booking-level metric exclusions. Records remain in operational history.';
comment on table public.vendor_presence_buckets is
  'Five-minute vendor portal heartbeat buckets used for online-hour analytics.';

commit;

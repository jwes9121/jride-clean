begin;

alter table public.vendor_accounts
  add column if not exists vendor_compliance_started_on date,
  add column if not exists consecutive_vendor_timeouts integer not null default 0,
  add column if not exists consecutive_offline_days integer not null default 0,
  add column if not exists public_response_warning_until timestamptz,
  add column if not exists public_response_warning_reason text,
  add column if not exists suspended_until timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists last_vendor_decision_at timestamptz;

create table if not exists public.vendor_daily_attendance (
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  attendance_date date not null,
  opened_at timestamptz,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  online_minutes integer not null default 0,
  source text not null default 'vendor_portal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vendor_id, attendance_date)
);

create table if not exists public.vendor_compliance_exemptions (
  id uuid primary key default gen_random_uuid(),
  exemption_date date not null,
  vendor_id uuid references public.vendor_accounts(id) on delete cascade,
  reason text not null,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  review_type text not null check (review_type in ('response_warning','suspension_timeout','suspension_offline')),
  status text not null default 'pending' check (status in ('pending','approved','dismissed')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
);

create table if not exists public.vendor_sanctions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  sanction_type text not null check (sanction_type in ('public_response_warning','suspension_7_days','manual')),
  status text not null default 'active' check (status in ('active','expired','revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);

create index if not exists vendor_daily_attendance_date_idx
  on public.vendor_daily_attendance(attendance_date desc, vendor_id);
create index if not exists vendor_compliance_reviews_status_idx
  on public.vendor_compliance_reviews(status, created_at desc, vendor_id);
create index if not exists vendor_sanctions_status_idx
  on public.vendor_sanctions(status, ends_at desc, vendor_id);

alter table public.vendor_daily_attendance enable row level security;
alter table public.vendor_compliance_exemptions enable row level security;
alter table public.vendor_compliance_reviews enable row level security;
alter table public.vendor_sanctions enable row level security;

create or replace function public.record_vendor_daily_presence_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (new.minute_started_at at time zone 'Asia/Manila')::date;
begin
  insert into public.vendor_daily_attendance(
    vendor_id,
    attendance_date,
    first_seen_at,
    last_seen_at,
    online_minutes,
    source,
    created_at,
    updated_at
  ) values (
    new.vendor_id,
    v_date,
    new.last_seen_at,
    new.last_seen_at,
    1,
    coalesce(new.client, 'vendor_portal'),
    now(),
    now()
  )
  on conflict (vendor_id, attendance_date)
  do update set
    first_seen_at = least(coalesce(public.vendor_daily_attendance.first_seen_at, excluded.first_seen_at), excluded.first_seen_at),
    last_seen_at = greatest(coalesce(public.vendor_daily_attendance.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
    online_minutes = public.vendor_daily_attendance.online_minutes + 1,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_record_vendor_daily_presence_v1 on public.vendor_presence_minutes;
create trigger trg_record_vendor_daily_presence_v1
after insert on public.vendor_presence_minutes
for each row execute function public.record_vendor_daily_presence_v1();

create or replace function public.record_vendor_daily_open_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.daily_open_date is not null
     and (
       new.daily_open_date is distinct from old.daily_open_date
       or new.daily_opened_at is distinct from old.daily_opened_at
     ) then
    insert into public.vendor_daily_attendance(
      vendor_id,
      attendance_date,
      opened_at,
      source,
      created_at,
      updated_at
    ) values (
      new.id,
      new.daily_open_date,
      new.daily_opened_at,
      'open_today',
      now(),
      now()
    )
    on conflict (vendor_id, attendance_date)
    do update set
      opened_at = coalesce(public.vendor_daily_attendance.opened_at, excluded.opened_at),
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_record_vendor_daily_open_v1 on public.vendor_accounts;
create trigger trg_record_vendor_daily_open_v1
after update of daily_open_date, daily_opened_at on public.vendor_accounts
for each row execute function public.record_vendor_daily_open_v1();

create or replace function public.track_vendor_compliance_review_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text := lower(btrim(coalesce(old.vendor_status, '')));
  v_new_status text := lower(btrim(coalesce(new.vendor_status, '')));
  v_old_reason text := lower(btrim(coalesce(old.vendor_cancel_reason, old.cancel_reason, '')));
  v_new_reason text := lower(btrim(coalesce(new.vendor_cancel_reason, new.cancel_reason, '')));
  v_old_timeout boolean;
  v_new_timeout boolean;
  v_started_on date;
  v_new_streak integer;
begin
  if lower(coalesce(new.service_type, old.service_type, '')) <> 'takeout'
     or new.vendor_id is null then
    return new;
  end if;

  select vendor_compliance_started_on
  into v_started_on
  from public.vendor_accounts
  where id = new.vendor_id;

  if v_started_on is null
     or (clock_timestamp() at time zone 'Asia/Manila')::date < v_started_on then
    return new;
  end if;

  v_old_timeout :=
    v_old_status = 'vendor_timeout'
    or v_old_reason like '%did not respond within%'
    or v_old_reason like '%vendor timeout%';

  v_new_timeout :=
    v_new_status = 'vendor_timeout'
    or v_new_reason like '%did not respond within%'
    or v_new_reason like '%vendor timeout%';

  if v_new_timeout and not v_old_timeout then
    update public.vendor_accounts
    set consecutive_vendor_timeouts = consecutive_vendor_timeouts + 1,
        last_vendor_decision_at = clock_timestamp()
    where id = new.vendor_id
    returning consecutive_vendor_timeouts into v_new_streak;

    if v_new_streak = 2 then
      if not exists (
        select 1 from public.vendor_compliance_reviews r
        where r.vendor_id = new.vendor_id
          and r.review_type = 'response_warning'
          and r.status = 'pending'
      ) then
        insert into public.vendor_compliance_reviews(
          vendor_id, review_type, reason, evidence
        ) values (
          new.vendor_id,
          'response_warning',
          '2 consecutive expired Takeout orders',
          jsonb_build_object(
            'streak', v_new_streak,
            'booking_id', new.id,
            'booking_code', new.booking_code,
            'cancel_reason', coalesce(new.vendor_cancel_reason, new.cancel_reason)
          )
        );
      end if;
    elsif v_new_streak >= 3 then
      if not exists (
        select 1 from public.vendor_compliance_reviews r
        where r.vendor_id = new.vendor_id
          and r.review_type = 'suspension_timeout'
          and r.status = 'pending'
      ) then
        insert into public.vendor_compliance_reviews(
          vendor_id, review_type, reason, evidence
        ) values (
          new.vendor_id,
          'suspension_timeout',
          '3 consecutive expired Takeout orders - 7-day suspension recommended',
          jsonb_build_object(
            'streak', v_new_streak,
            'booking_id', new.id,
            'booking_code', new.booking_code,
            'cancel_reason', coalesce(new.vendor_cancel_reason, new.cancel_reason)
          )
        );
      end if;
    end if;

    return new;
  end if;

  if v_old_status in ('', 'requested', 'vendor_pending')
     and not v_new_timeout
     and v_new_status in (
       'vendor_accepted', 'accepted', 'driver_assigned', 'driver_accepted',
       'preparing', 'pickup_ready', 'completed', 'cancelled', 'canceled'
     ) then
    update public.vendor_accounts
    set consecutive_vendor_timeouts = 0,
        last_vendor_decision_at = clock_timestamp()
    where id = new.vendor_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_track_vendor_compliance_review_v1 on public.bookings;
create trigger trg_track_vendor_compliance_review_v1
after update of vendor_status, vendor_cancel_reason, cancel_reason on public.bookings
for each row execute function public.track_vendor_compliance_review_v1();

create or replace function public.evaluate_vendor_offline_review_v1(
  p_target_date date default ((clock_timestamp() at time zone 'Asia/Manila')::date - 1)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor record;
  v_is_exempt boolean;
  v_has_attendance boolean;
  v_new_streak integer;
  v_reviews integer := 0;
  v_absent integer := 0;
  v_present integer := 0;
  v_exempt integer := 0;
  v_skipped integer := 0;
begin
  for v_vendor in
    select va.*,
           coalesce(voc.status, '') as onboarding_status
    from public.vendor_accounts va
    left join public.vendor_onboarding_credentials voc on voc.vendor_id = va.id
    where va.vendor_compliance_started_on is not null
      and va.vendor_compliance_started_on <= p_target_date
      and va.hours_enforced = true
      and va.normal_open_time is not null
      and va.normal_close_time is not null
      and va.id <> '11111111-1111-1111-1111-111111111111'::uuid
      and coalesce(voc.status, '') not in ('batch2', 'removed_from_pilot')
  loop
    if v_vendor.suspended_until is not null
       and v_vendor.suspended_until > clock_timestamp() then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select exists(
      select 1
      from public.vendor_compliance_exemptions e
      where e.exemption_date = p_target_date
        and e.active = true
        and (e.vendor_id is null or e.vendor_id = v_vendor.id)
    ) into v_is_exempt;

    if v_is_exempt then
      v_exempt := v_exempt + 1;
      continue;
    end if;

    select exists(
      select 1
      from public.vendor_daily_attendance a
      where a.vendor_id = v_vendor.id
        and a.attendance_date = p_target_date
        and (
          a.opened_at is not null
          or a.online_minutes > 0
          or a.first_seen_at is not null
        )
    ) into v_has_attendance;

    if v_has_attendance then
      update public.vendor_accounts
      set consecutive_offline_days = 0
      where id = v_vendor.id;
      v_present := v_present + 1;
      continue;
    end if;

    update public.vendor_accounts
    set consecutive_offline_days = consecutive_offline_days + 1
    where id = v_vendor.id
    returning consecutive_offline_days into v_new_streak;

    v_absent := v_absent + 1;

    if v_new_streak >= 3 then
      if not exists (
        select 1 from public.vendor_compliance_reviews r
        where r.vendor_id = v_vendor.id
          and r.review_type = 'suspension_offline'
          and r.status = 'pending'
      ) then
        insert into public.vendor_compliance_reviews(
          vendor_id, review_type, reason, evidence
        ) values (
          v_vendor.id,
          'suspension_offline',
          'Offline for 3 consecutive non-exempt operating days - 7-day suspension recommended',
          jsonb_build_object('trigger_date', p_target_date, 'streak', v_new_streak)
        );
        v_reviews := v_reviews + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'target_date', p_target_date,
    'present', v_present,
    'absent', v_absent,
    'exempt', v_exempt,
    'skipped_suspended', v_skipped,
    'new_reviews', v_reviews
  );
end;
$$;

create or replace function public.vendor_effective_availability(
  p_vendor_id uuid,
  p_at timestamp with time zone default now()
)
returns table (
  effective_accepting_orders boolean,
  manual_accepting_orders boolean,
  hours_enforced boolean,
  hours_configured boolean,
  normal_open_time time without time zone,
  normal_close_time time without time zone,
  extended_from timestamp with time zone,
  extended_until timestamp with time zone,
  extension_active boolean,
  scheduled_open_at timestamp with time zone,
  scheduled_close_at timestamp with time zone,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.vendor_accounts%rowtype;
  v_local timestamp without time zone;
  v_date date;
  v_time time without time zone;
  v_open_local timestamp without time zone;
  v_close_local timestamp without time zone;
  v_in_window boolean := false;
  v_extension_active boolean := false;
  v_configured boolean := false;
  v_daily_opened boolean := false;
  v_suspended boolean := false;
begin
  select * into v
  from public.vendor_accounts va
  where va.id = p_vendor_id;

  if not found then
    return;
  end if;

  v_local := p_at at time zone 'Asia/Manila';
  v_date := v_local::date;
  v_time := v_local::time;
  v_configured :=
    v.normal_open_time is not null
    and v.normal_close_time is not null
    and v.normal_open_time < v.normal_close_time;
  v_daily_opened := v.daily_open_date = v_date;
  v_suspended := v.suspended_until is not null and v.suspended_until > p_at;

  if v_configured then
    v_open_local := v_date + v.normal_open_time;
    v_close_local := v_date + v.normal_close_time;
    v_in_window := v_time >= v.normal_open_time and v_time < v.normal_close_time;
  end if;

  v_extension_active :=
    v.extended_from is not null
    and v.extended_until is not null
    and p_at >= v.extended_from
    and p_at < v.extended_until
    and v_daily_opened;

  return query
  select
    case
      when v_suspended then false
      when v.accepting_orders is not true then false
      when v.hours_enforced is not true then true
      when not v_configured then false
      when not v_daily_opened then false
      when v_in_window then true
      when v_extension_active then true
      else false
    end,
    v.accepting_orders is true,
    v.hours_enforced is true,
    v_configured,
    v.normal_open_time,
    v.normal_close_time,
    v.extended_from,
    v.extended_until,
    v_extension_active,
    case when v_open_local is null then null else v_open_local at time zone 'Asia/Manila' end,
    case when v_close_local is null then null else v_close_local at time zone 'Asia/Manila' end,
    case
      when v_suspended then 'suspended'
      when v.accepting_orders is not true then 'manual_closed'
      when v.hours_enforced is not true then 'hours_not_enforced'
      when not v_configured then 'hours_required'
      when not v_daily_opened then 'daily_open_required'
      when v_in_window then 'within_hours'
      when v_extension_active then 'extended'
      else 'outside_hours'
    end;
end;
$$;

revoke all on function public.vendor_effective_availability(uuid, timestamp with time zone) from public;
grant execute on function public.vendor_effective_availability(uuid, timestamp with time zone) to service_role;

insert into public.vendor_daily_attendance(
  vendor_id,
  attendance_date,
  first_seen_at,
  last_seen_at,
  online_minutes,
  source,
  created_at,
  updated_at
)
select
  p.vendor_id,
  (p.minute_started_at at time zone 'Asia/Manila')::date,
  min(p.last_seen_at),
  max(p.last_seen_at),
  count(distinct p.minute_started_at)::integer,
  'presence_backfill',
  now(),
  now()
from public.vendor_presence_minutes p
group by p.vendor_id, (p.minute_started_at at time zone 'Asia/Manila')::date
on conflict (vendor_id, attendance_date)
do update set
  first_seen_at = coalesce(public.vendor_daily_attendance.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(coalesce(public.vendor_daily_attendance.last_seen_at, excluded.last_seen_at), excluded.last_seen_at),
  online_minutes = greatest(public.vendor_daily_attendance.online_minutes, excluded.online_minutes),
  updated_at = now();

update public.vendor_accounts va
set vendor_compliance_started_on = (clock_timestamp() at time zone 'Asia/Manila')::date + 1
where va.vendor_compliance_started_on is null
  and va.id <> '11111111-1111-1111-1111-111111111111'::uuid
  and exists (
    select 1
    from public.vendor_onboarding_credentials voc
    where voc.vendor_id = va.id
      and voc.status in ('active','pilot','pilot_lagawe')
  );

comment on table public.vendor_compliance_reviews is
  'System-generated vendor compliance cases requiring human admin review before any public warning or suspension is applied.';
comment on table public.vendor_sanctions is
  'Admin-approved vendor warnings and suspensions with auditable start/end and reason.';
comment on table public.vendor_compliance_exemptions is
  'Holiday or approved vendor-closure dates excluded from offline-day compliance evaluation.';

commit;

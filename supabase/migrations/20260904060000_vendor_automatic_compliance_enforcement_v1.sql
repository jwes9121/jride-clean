-- JRide automatic vendor compliance enforcement v1.
-- 3 accumulated unanswered/expired Takeout orders = suspension.
-- 3 consecutive days without manual Open for Orders Today = suspension.
-- First same-offense threshold = 7 days; later same-offense thresholds = 30 days.

begin;

alter table public.vendor_accounts
  add column if not exists accumulated_unanswered_orders integer not null default 0,
  add column if not exists daily_open_compliance_started_on date,
  add column if not exists last_offline_compliance_date date;

alter table public.vendor_sanctions
  add column if not exists enforcement_source text,
  add column if not exists rule_version text,
  add column if not exists threshold_count integer,
  add column if not exists repeat_offense boolean not null default false;

alter table public.vendor_sanctions
  alter column enforcement_source set default 'admin_manual';

update public.vendor_sanctions
set enforcement_source = 'admin_manual'
where enforcement_source is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vendor_accounts'::regclass
      and conname = 'vendor_accounts_accumulated_unanswered_orders_check'
  ) then
    alter table public.vendor_accounts
      add constraint vendor_accounts_accumulated_unanswered_orders_check
      check (accumulated_unanswered_orders >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vendor_sanctions'::regclass
      and conname = 'vendor_sanctions_enforcement_source_check'
  ) then
    alter table public.vendor_sanctions
      add constraint vendor_sanctions_enforcement_source_check
      check (
        enforcement_source is null
        or enforcement_source in ('admin_manual', 'system_automatic')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vendor_sanctions'::regclass
      and conname = 'vendor_sanctions_threshold_count_check'
  ) then
    alter table public.vendor_sanctions
      add constraint vendor_sanctions_threshold_count_check
      check (threshold_count is null or threshold_count > 0);
  end if;
end
$$;

create table if not exists public.vendor_compliance_events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_accounts(id) on delete cascade,
  violation_code text not null,
  event_type text not null,
  event_key text not null unique,
  event_at timestamptz not null,
  source_booking_id uuid references public.bookings(id) on delete set null,
  source_date date,
  status text not null default 'counted',
  sanction_id uuid references public.vendor_sanctions(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  constraint vendor_compliance_events_violation_code_check
    check (violation_code in (
      'REPEATED_ORDER_TIMEOUTS',
      'REPEATED_UNEXCUSED_OFFLINE_DAYS'
    )),
  constraint vendor_compliance_events_event_type_check
    check (event_type in ('takeout_timeout', 'daily_open_missed')),
  constraint vendor_compliance_events_status_check
    check (status in ('counted', 'consumed', 'voided'))
);

create index if not exists vendor_compliance_events_counter_idx
  on public.vendor_compliance_events(vendor_id, violation_code, status, event_at, id);

create index if not exists vendor_compliance_events_sanction_idx
  on public.vendor_compliance_events(sanction_id)
  where sanction_id is not null;

alter table public.vendor_compliance_events enable row level security;
revoke all on table public.vendor_compliance_events from public, anon, authenticated;
grant select, insert, update, delete on table public.vendor_compliance_events to service_role;

create or replace function public.enforce_vendor_automatic_rule_source_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.violation_code in (
    'REPEATED_ORDER_TIMEOUTS',
    'REPEATED_UNEXCUSED_OFFLINE_DAYS'
  ) and coalesce(new.enforcement_source, 'admin_manual') <> 'system_automatic' then
    raise exception 'AUTOMATIC_RULE_ONLY' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_vendor_automatic_rule_source_v1
  on public.vendor_sanctions;

create trigger trg_enforce_vendor_automatic_rule_source_v1
before insert or update of violation_code, enforcement_source
on public.vendor_sanctions
for each row execute function public.enforce_vendor_automatic_rule_source_v1();

create or replace function public.apply_vendor_automatic_suspension_v1(
  p_vendor_id uuid,
  p_violation_code text,
  p_evidence jsonb default '{}'::jsonb,
  p_source_review_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_code text := upper(btrim(coalesce(p_violation_code, '')));
  v_count integer := 0;
  v_prior integer := 0;
  v_repeat boolean := false;
  v_days integer := 7;
  v_message text;
  v_vendor_name text;
  v_sanction public.vendor_sanctions%rowtype;
  v_cancelled integer := 0;
begin
  if p_vendor_id is null then
    raise exception 'VENDOR_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_code not in (
    'REPEATED_ORDER_TIMEOUTS',
    'REPEATED_UNEXCUSED_OFFLINE_DAYS'
  ) then
    raise exception 'INVALID_AUTOMATIC_VIOLATION_CODE' using errcode = 'P0001';
  end if;

  perform public.expire_vendor_sanctions_v1();

  select coalesce(nullif(btrim(display_name), ''), nullif(btrim(email), ''), id::text)
  into v_vendor_name
  from public.vendor_accounts
  where id = p_vendor_id
  for update;

  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.vendor_sanctions s
    where s.vendor_id = p_vendor_id
      and s.status = 'active'
      and s.sanction_type in ('suspension_7_days', 'manual')
      and s.ends_at > v_now
  ) then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'ACTIVE_SUSPENSION_EXISTS',
      'vendor_id', p_vendor_id
    );
  end if;

  select count(*)::integer
  into v_count
  from public.vendor_compliance_events e
  where e.vendor_id = p_vendor_id
    and e.violation_code = v_code
    and e.status = 'counted';

  if (
    v_code = 'REPEATED_ORDER_TIMEOUTS' and v_count < 3
  ) or (
    v_code = 'REPEATED_UNEXCUSED_OFFLINE_DAYS'
    and p_source_review_id is null
    and v_count < 3
  ) then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'THRESHOLD_NOT_REACHED',
      'vendor_id', p_vendor_id,
      'violation_code', v_code,
      'counted_events', v_count
    );
  end if;

  select count(*)::integer
  into v_prior
  from public.vendor_sanctions s
  where s.vendor_id = p_vendor_id
    and s.violation_code = v_code
    and s.sanction_type in ('suspension_7_days', 'manual')
    and s.status in ('active', 'expired')
    and s.revoked_at is null;

  v_repeat := v_prior > 0;
  v_days := case when v_repeat then 30 else 7 end;

  if v_code = 'REPEATED_ORDER_TIMEOUTS' then
    v_message := case when v_repeat then
      'JRide''s compliance system automatically applied a 30-day repeat suspension after recording another 3 accumulated unanswered or expired Takeout orders.'
    else
      'JRide''s compliance system automatically applied a 7-day suspension after recording 3 accumulated unanswered or expired Takeout orders.'
    end;
  else
    v_message := case when v_repeat then
      'JRide''s compliance system automatically applied a 30-day repeat suspension after recording another 3 consecutive operating days without a manual store opening and without an approved exception.'
    else
      'JRide''s compliance system automatically applied a 7-day suspension after recording 3 consecutive operating days without a manual store opening and without an approved exception.'
    end;
  end if;

  insert into public.vendor_sanctions(
    vendor_id, sanction_type, status, starts_at, ends_at, reason, evidence,
    created_by, violation_code, vendor_message, internal_note,
    suspension_scope, source_review_id, request_id, actor_user_id,
    actor_email, pending_orders_cancelled, enforcement_source,
    rule_version, threshold_count, repeat_offense
  ) values (
    p_vendor_id,
    'suspension_7_days',
    'active',
    v_now,
    v_now + make_interval(days => v_days),
    v_message,
    coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object(
      'source', 'JRIDE_AUTOMATED_ENFORCEMENT',
      'rule_version', 'vendor_automatic_compliance_v1',
      'threshold_count', 3,
      'duration_days', v_days,
      'repeat_offense', v_repeat,
      'prior_valid_same_offense_suspensions', v_prior,
      'counted_events_at_trigger', v_count
    ),
    'JRIDE_AUTOMATED_ENFORCEMENT',
    v_code,
    v_message,
    'Applied automatically from recorded platform activity.',
    'new_orders_only',
    p_source_review_id,
    gen_random_uuid(),
    'JRIDE_AUTOMATED_ENFORCEMENT',
    null,
    0,
    'system_automatic',
    'vendor_automatic_compliance_v1',
    3,
    v_repeat
  ) returning * into v_sanction;

  update public.vendor_accounts
  set
    suspended_until = v_sanction.ends_at,
    suspension_reason = v_message,
    accepting_orders = false,
    daily_open_date = null,
    daily_opened_at = null,
    extended_from = null,
    extended_until = null,
    accumulated_unanswered_orders = case
      when v_code = 'REPEATED_ORDER_TIMEOUTS' then 0
      else accumulated_unanswered_orders
    end,
    consecutive_vendor_timeouts = case
      when v_code = 'REPEATED_ORDER_TIMEOUTS' then 0
      else accumulated_unanswered_orders
    end,
    consecutive_offline_days = 0
  where id = p_vendor_id;

  update public.vendor_sanctions
  set status = 'expired', ends_at = least(ends_at, v_now)
  where vendor_id = p_vendor_id
    and status = 'active'
    and sanction_type = 'public_response_warning';

  update public.vendor_accounts
  set public_response_warning_until = null,
      public_response_warning_reason = null
  where id = p_vendor_id;

  update public.bookings
  set
    status = 'cancelled',
    vendor_status = 'cancelled',
    vendor_responded_at = coalesce(vendor_responded_at, v_now),
    vendor_rejected_at = coalesce(vendor_rejected_at, v_now),
    vendor_cancel_reason = 'Store automatically suspended by JRide compliance rules',
    cancel_reason = 'Store automatically suspended by JRide compliance rules',
    updated_at = v_now
  where lower(coalesce(service_type, '')) = 'takeout'
    and vendor_id = p_vendor_id
    and lower(btrim(coalesce(vendor_status, ''))) in ('', 'requested', 'vendor_pending')
    and lower(btrim(coalesce(status, ''))) not in ('completed', 'cancelled');

  get diagnostics v_cancelled = row_count;

  update public.vendor_sanctions
  set pending_orders_cancelled = v_cancelled
  where id = v_sanction.id;

  update public.vendor_compliance_events
  set status = 'consumed',
      sanction_id = v_sanction.id,
      consumed_at = v_now,
      voided_at = null,
      voided_by = null,
      void_reason = null
  where vendor_id = p_vendor_id
    and violation_code = v_code
    and status = 'counted';

  if v_code = 'REPEATED_ORDER_TIMEOUTS' then
    update public.vendor_compliance_events
    set status = 'voided',
        voided_at = v_now,
        voided_by = 'JRIDE_AUTOMATED_ENFORCEMENT',
        void_reason = 'automatic_suspension_breaks_offline_streak'
    where vendor_id = p_vendor_id
      and violation_code = 'REPEATED_UNEXCUSED_OFFLINE_DAYS'
      and status = 'counted';
  end if;

  if p_source_review_id is not null then
    update public.vendor_compliance_reviews
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = 'JRIDE_AUTOMATED_ENFORCEMENT',
        review_note = 'Converted to automatic enforcement under vendor_automatic_compliance_v1.'
    where id = p_source_review_id
      and status = 'pending';
  end if;

  update public.vendor_compliance_reviews
  set status = 'dismissed',
      reviewed_at = v_now,
      reviewed_by = 'JRIDE_AUTOMATED_ENFORCEMENT',
      review_note = 'Superseded by automatic sanction ' || v_sanction.id::text || '.'
  where vendor_id = p_vendor_id
    and status = 'pending'
    and id is distinct from p_source_review_id;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'sanction_id', v_sanction.id,
    'vendor_id', p_vendor_id,
    'vendor_name', v_vendor_name,
    'violation_code', v_code,
    'repeat_offense', v_repeat,
    'duration_days', v_days,
    'starts_at', v_sanction.starts_at,
    'ends_at', v_sanction.ends_at,
    'pending_orders_cancelled', v_cancelled
  );
end;
$$;

create or replace function public.track_vendor_compliance_review_v1()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_old_status text := lower(btrim(coalesce(old.vendor_status, '')));
  v_new_status text := lower(btrim(coalesce(new.vendor_status, '')));
  v_old_reason text := lower(btrim(coalesce(old.vendor_cancel_reason, old.cancel_reason, '')));
  v_new_reason text := lower(btrim(coalesce(new.vendor_cancel_reason, new.cancel_reason, '')));
  v_old_timeout boolean;
  v_new_timeout boolean;
  v_vendor public.vendor_accounts%rowtype;
  v_onboarding_status text := '';
  v_event_id uuid;
  v_count integer := 0;
  v_result jsonb;
begin
  if lower(coalesce(new.service_type, old.service_type, '')) <> 'takeout'
     or new.vendor_id is null
     or new.vendor_id = '11111111-1111-1111-1111-111111111111'::uuid then
    return new;
  end if;

  select * into v_vendor
  from public.vendor_accounts
  where id = new.vendor_id
  for update;

  if not found then return new; end if;

  select coalesce(status, '') into v_onboarding_status
  from public.vendor_onboarding_credentials
  where vendor_id = new.vendor_id
  limit 1;

  if v_vendor.vendor_compliance_started_on is null
     or (clock_timestamp() at time zone 'Asia/Manila')::date < v_vendor.vendor_compliance_started_on
     or coalesce(v_onboarding_status, '') not in ('active', 'pilot', 'pilot_lagawe')
     or (v_vendor.suspended_until is not null and v_vendor.suspended_until > clock_timestamp()) then
    return new;
  end if;

  v_old_timeout := v_old_status = 'vendor_timeout'
    or v_old_reason like '%did not respond within%'
    or v_old_reason like '%vendor timeout%';
  v_new_timeout := v_new_status = 'vendor_timeout'
    or v_new_reason like '%did not respond within%'
    or v_new_reason like '%vendor timeout%';

  if v_new_timeout and not v_old_timeout then
    insert into public.vendor_compliance_events(
      vendor_id, violation_code, event_type, event_key, event_at,
      source_booking_id, evidence
    ) values (
      new.vendor_id,
      'REPEATED_ORDER_TIMEOUTS',
      'takeout_timeout',
      'TAKEOUT_TIMEOUT:' || new.id::text,
      coalesce(new.updated_at, new.created_at, clock_timestamp()),
      new.id,
      jsonb_build_object(
        'booking_id', new.id,
        'booking_code', new.booking_code,
        'vendor_status', new.vendor_status,
        'cancel_reason', coalesce(new.vendor_cancel_reason, new.cancel_reason)
      )
    ) on conflict (event_key) do nothing
    returning id into v_event_id;

    if v_event_id is null then return new; end if;

    select count(*)::integer into v_count
    from public.vendor_compliance_events e
    where e.vendor_id = new.vendor_id
      and e.violation_code = 'REPEATED_ORDER_TIMEOUTS'
      and e.status = 'counted';

    update public.vendor_accounts
    set accumulated_unanswered_orders = v_count,
        consecutive_vendor_timeouts = v_count,
        last_vendor_decision_at = clock_timestamp()
    where id = new.vendor_id;

    if v_count >= 3 then
      v_result := public.apply_vendor_automatic_suspension_v1(
        new.vendor_id,
        'REPEATED_ORDER_TIMEOUTS',
        jsonb_build_object(
          'trigger', 'takeout_timeout',
          'trigger_booking_id', new.id,
          'trigger_booking_code', new.booking_code,
          'accumulated_unanswered_orders', v_count
        ),
        null
      );
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
    set last_vendor_decision_at = clock_timestamp()
    where id = new.vendor_id;
  end if;

  return new;
end;
$$;

create or replace function public.evaluate_vendor_offline_review_v1(
  p_target_date date default ((clock_timestamp() at time zone 'Asia/Manila')::date - 1)
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Asia/Manila')::date;
  v_vendor record;
  v_date date;
  v_start date;
  v_exempt boolean;
  v_opened boolean;
  v_suspended boolean;
  v_event_id uuid;
  v_result jsonb;
  v_streak integer := 0;
  v_processed integer := 0;
  v_missed integer := 0;
  v_opened_count integer := 0;
  v_exempt_count integer := 0;
  v_suspended_count integer := 0;
  v_applied integer := 0;
begin
  if p_target_date is null or p_target_date >= v_today then
    raise exception 'INVALID_OFFLINE_TARGET_DATE' using errcode = 'P0001';
  end if;

  for v_vendor in
    select va.id, va.vendor_compliance_started_on,
           va.daily_open_compliance_started_on,
           va.last_offline_compliance_date
    from public.vendor_accounts va
    join public.vendor_onboarding_credentials voc on voc.vendor_id = va.id
    where va.vendor_compliance_started_on is not null
      and va.hours_enforced = true
      and va.normal_open_time is not null
      and va.normal_close_time is not null
      and va.id <> '11111111-1111-1111-1111-111111111111'::uuid
      and voc.status in ('active', 'pilot', 'pilot_lagawe')
    order by va.id
  loop
    v_start := greatest(
      v_vendor.vendor_compliance_started_on,
      coalesce(v_vendor.daily_open_compliance_started_on, v_vendor.vendor_compliance_started_on),
      coalesce(v_vendor.last_offline_compliance_date + 1,
        greatest(v_vendor.vendor_compliance_started_on,
          coalesce(v_vendor.daily_open_compliance_started_on, v_vendor.vendor_compliance_started_on)))
    );

    if v_start > p_target_date then continue; end if;
    v_date := v_start;

    while v_date <= p_target_date loop
      select exists(
        select 1 from public.vendor_compliance_exemptions e
        where e.exemption_date = v_date
          and e.active = true
          and (e.vendor_id is null or e.vendor_id = v_vendor.id)
      ) into v_exempt;

      select exists(
        select 1 from public.vendor_daily_attendance a
        where a.vendor_id = v_vendor.id
          and a.attendance_date = v_date
          and a.opened_at is not null
      ) into v_opened;

      select exists(
        select 1 from public.vendor_sanctions s
        where s.vendor_id = v_vendor.id
          and s.sanction_type in ('suspension_7_days', 'manual')
          and s.starts_at < ((v_date + 1)::timestamp at time zone 'Asia/Manila')
          and least(s.ends_at, coalesce(s.revoked_at, s.ends_at))
              > (v_date::timestamp at time zone 'Asia/Manila')
      ) into v_suspended;

      if v_exempt or v_opened or v_suspended then
        update public.vendor_compliance_events
        set status = 'voided',
            voided_at = clock_timestamp(),
            voided_by = 'JRIDE_AUTOMATED_ENFORCEMENT',
            void_reason = case
              when v_exempt then 'approved_closure'
              when v_opened then 'manual_daily_open'
              else 'active_suspension'
            end
        where vendor_id = v_vendor.id
          and violation_code = 'REPEATED_UNEXCUSED_OFFLINE_DAYS'
          and status = 'counted';

        update public.vendor_accounts
        set consecutive_offline_days = 0,
            last_offline_compliance_date = v_date
        where id = v_vendor.id;

        if v_exempt then v_exempt_count := v_exempt_count + 1;
        elsif v_opened then v_opened_count := v_opened_count + 1;
        else v_suspended_count := v_suspended_count + 1;
        end if;
      else
        v_event_id := null;
        insert into public.vendor_compliance_events(
          vendor_id, violation_code, event_type, event_key,
          event_at, source_date, evidence
        ) values (
          v_vendor.id,
          'REPEATED_UNEXCUSED_OFFLINE_DAYS',
          'daily_open_missed',
          'DAILY_OPEN_MISSED:' || v_vendor.id::text || ':' || v_date::text,
          ((v_date + 1)::timestamp at time zone 'Asia/Manila'),
          v_date,
          jsonb_build_object(
            'activity_date', v_date,
            'manual_open_required', true,
            'approved_exemption', false
          )
        ) on conflict (event_key) do nothing
        returning id into v_event_id;

        if v_event_id is not null then
          update public.vendor_accounts
          set consecutive_offline_days = consecutive_offline_days + 1,
              last_offline_compliance_date = v_date
          where id = v_vendor.id
          returning consecutive_offline_days into v_streak;
          v_missed := v_missed + 1;
        else
          update public.vendor_accounts
          set last_offline_compliance_date = v_date
          where id = v_vendor.id
          returning consecutive_offline_days into v_streak;
        end if;

        if v_streak >= 3 then
          v_result := public.apply_vendor_automatic_suspension_v1(
            v_vendor.id,
            'REPEATED_UNEXCUSED_OFFLINE_DAYS',
            jsonb_build_object(
              'trigger', 'daily_manual_open_check',
              'trigger_date', v_date,
              'consecutive_missed_manual_open_days', v_streak
            ),
            null
          );
          if coalesce((v_result->>'applied')::boolean, false) then
            v_applied := v_applied + 1;
            update public.vendor_accounts
            set consecutive_offline_days = 0,
                last_offline_compliance_date = p_target_date
            where id = v_vendor.id;
            exit;
          end if;
        end if;
      end if;

      v_processed := v_processed + 1;
      v_date := v_date + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'target_date', p_target_date,
    'processed_days', v_processed,
    'missed_days', v_missed,
    'opened_days', v_opened_count,
    'exempt_days', v_exempt_count,
    'suspended_days', v_suspended_count,
    'automatic_suspensions', v_applied,
    'automatic_enforcement', true,
    'rule_version', 'vendor_automatic_compliance_v1'
  );
end;
$$;

create or replace function public.evaluate_vendor_automatic_compliance_v1()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_vendor record;
  v_result jsonb;
  v_timeout_applied integer := 0;
  v_offline jsonb;
begin
  perform public.expire_vendor_sanctions_v1();

  for v_vendor in
    select e.vendor_id, count(*)::integer as accumulated_count
    from public.vendor_compliance_events e
    join public.vendor_accounts va on va.id = e.vendor_id
    join public.vendor_onboarding_credentials voc on voc.vendor_id = e.vendor_id
    where e.violation_code = 'REPEATED_ORDER_TIMEOUTS'
      and e.status = 'counted'
      and e.vendor_id <> '11111111-1111-1111-1111-111111111111'::uuid
      and va.vendor_compliance_started_on is not null
      and voc.status in ('active', 'pilot', 'pilot_lagawe')
    group by e.vendor_id
    having count(*) >= 3
    order by e.vendor_id
  loop
    v_result := public.apply_vendor_automatic_suspension_v1(
      v_vendor.vendor_id,
      'REPEATED_ORDER_TIMEOUTS',
      jsonb_build_object(
        'trigger', 'automatic_threshold_sweep',
        'accumulated_unanswered_orders', v_vendor.accumulated_count
      ),
      null
    );
    if coalesce((v_result->>'applied')::boolean, false) then
      v_timeout_applied := v_timeout_applied + 1;
    end if;
  end loop;

  v_offline := public.evaluate_vendor_offline_review_v1();

  return jsonb_build_object(
    'ok', true,
    'automatic_enforcement', true,
    'rule_version', 'vendor_automatic_compliance_v1',
    'timeout_suspensions', v_timeout_applied,
    'offline', v_offline
  );
end;
$$;

revoke all on function public.apply_vendor_automatic_suspension_v1(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_vendor_automatic_suspension_v1(uuid, text, jsonb, uuid)
  to service_role;

revoke all on function public.evaluate_vendor_offline_review_v1(date)
  from public, anon, authenticated;
grant execute on function public.evaluate_vendor_offline_review_v1(date)
  to service_role;

revoke all on function public.evaluate_vendor_automatic_compliance_v1()
  from public, anon, authenticated;
grant execute on function public.evaluate_vendor_automatic_compliance_v1()
  to service_role;

-- Strict manual daily-open tracking starts prospectively.
update public.vendor_accounts
set daily_open_compliance_started_on =
      (clock_timestamp() at time zone 'Asia/Manila')::date,
    last_offline_compliance_date =
      (clock_timestamp() at time zone 'Asia/Manila')::date - 1,
    consecutive_offline_days = 0
where vendor_compliance_started_on is not null;

-- Reconstruct accumulated unanswered Takeout orders from recorded bookings.
insert into public.vendor_compliance_events(
  vendor_id, violation_code, event_type, event_key, event_at,
  source_booking_id, evidence
)
select
  b.vendor_id,
  'REPEATED_ORDER_TIMEOUTS',
  'takeout_timeout',
  'TAKEOUT_TIMEOUT:' || b.id::text,
  coalesce(b.updated_at, b.created_at, clock_timestamp()),
  b.id,
  jsonb_build_object(
    'booking_id', b.id,
    'booking_code', b.booking_code,
    'vendor_status', b.vendor_status,
    'cancel_reason', coalesce(b.vendor_cancel_reason, b.cancel_reason),
    'backfilled', true
  )
from public.bookings b
join public.vendor_accounts va on va.id = b.vendor_id
join public.vendor_onboarding_credentials voc on voc.vendor_id = b.vendor_id
where lower(coalesce(b.service_type, '')) = 'takeout'
  and b.vendor_id is not null
  and b.vendor_id <> '11111111-1111-1111-1111-111111111111'::uuid
  and va.vendor_compliance_started_on is not null
  and voc.status in ('active', 'pilot', 'pilot_lagawe')
  and (
    lower(btrim(coalesce(b.vendor_status, ''))) = 'vendor_timeout'
    or lower(btrim(coalesce(b.vendor_cancel_reason, b.cancel_reason, '')))
       like '%did not respond within%'
    or lower(btrim(coalesce(b.vendor_cancel_reason, b.cancel_reason, '')))
       like '%vendor timeout%'
  )
  and (coalesce(b.created_at, b.updated_at, clock_timestamp())
       at time zone 'Asia/Manila')::date >= va.vendor_compliance_started_on
on conflict (event_key) do nothing;

update public.vendor_accounts va
set accumulated_unanswered_orders = c.event_count,
    consecutive_vendor_timeouts = c.event_count
from (
  select vendor_id, count(*)::integer as event_count
  from public.vendor_compliance_events
  where violation_code = 'REPEATED_ORDER_TIMEOUTS'
    and status = 'counted'
  group by vendor_id
) c
where va.id = c.vendor_id;

update public.vendor_accounts va
set accumulated_unanswered_orders = 0,
    consecutive_vendor_timeouts = 0
where not exists (
  select 1 from public.vendor_compliance_events e
  where e.vendor_id = va.id
    and e.violation_code = 'REPEATED_ORDER_TIMEOUTS'
    and e.status = 'counted'
);

-- Apply reconstructed accumulated timeout thresholds.
do $$
declare v record;
begin
  for v in
    select vendor_id, count(*)::integer as accumulated_count
    from public.vendor_compliance_events
    where violation_code = 'REPEATED_ORDER_TIMEOUTS'
      and status = 'counted'
    group by vendor_id
    having count(*) >= 3
    order by vendor_id
  loop
    perform public.apply_vendor_automatic_suspension_v1(
      v.vendor_id,
      'REPEATED_ORDER_TIMEOUTS',
      jsonb_build_object(
        'trigger', 'migration_timeout_backfill',
        'accumulated_unanswered_orders', v.accumulated_count
      ),
      null
    );
  end loop;
end
$$;

-- Convert offline thresholds previously detected by the system review flow.
do $$
declare r record;
begin
  for r in
    select * from public.vendor_compliance_reviews
    where status = 'pending'
      and review_type = 'suspension_offline'
    order by created_at, id
  loop
    perform public.apply_vendor_automatic_suspension_v1(
      r.vendor_id,
      'REPEATED_UNEXCUSED_OFFLINE_DAYS',
      coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object(
        'converted_from_legacy_review', true,
        'legacy_review_id', r.id,
        'legacy_review_created_at', r.created_at
      ),
      r.id
    );
  end loop;
end
$$;

-- The former review queue is retained as dismissed audit history.
update public.vendor_compliance_reviews
set status = 'dismissed',
    reviewed_at = clock_timestamp(),
    reviewed_by = 'JRIDE_AUTOMATED_ENFORCEMENT',
    review_note = 'Legacy review superseded by automatic enforcement policy.'
where status = 'pending';

-- Recalculate remaining accumulated timeout counts after sanctions consumed events.
update public.vendor_accounts va
set accumulated_unanswered_orders = c.event_count,
    consecutive_vendor_timeouts = c.event_count
from (
  select vendor_id, count(*)::integer as event_count
  from public.vendor_compliance_events
  where violation_code = 'REPEATED_ORDER_TIMEOUTS'
    and status = 'counted'
  group by vendor_id
) c
where va.id = c.vendor_id;

update public.vendor_accounts va
set accumulated_unanswered_orders = 0,
    consecutive_vendor_timeouts = 0
where not exists (
  select 1 from public.vendor_compliance_events e
  where e.vendor_id = va.id
    and e.violation_code = 'REPEATED_ORDER_TIMEOUTS'
    and e.status = 'counted'
);

comment on column public.vendor_accounts.accumulated_unanswered_orders is
  'Accumulated unanswered or expired Takeout orders in the current compliance cycle. A later response does not reset this count.';
comment on column public.vendor_accounts.daily_open_compliance_started_on is
  'First Manila date governed by the manual daily store-opening compliance rule.';
comment on column public.vendor_accounts.last_offline_compliance_date is
  'Latest Manila date processed by the idempotent daily-opening compliance sweep.';
comment on table public.vendor_compliance_events is
  'System event ledger for automatic vendor compliance thresholds.';
comment on function public.apply_vendor_automatic_suspension_v1(uuid, text, jsonb, uuid) is
  'Applies the automatic 7-day first suspension or 30-day repeat suspension.';
comment on function public.evaluate_vendor_automatic_compliance_v1() is
  'Runs automatic accumulated-timeout and manual-daily-open enforcement.';

commit;

create table if not exists public.driver_presence_minutes (
  driver_id uuid not null,
  minute_started_at timestamptz not null,
  last_seen_at timestamptz not null,
  town text null,
  device_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (driver_id, minute_started_at)
);

create index if not exists driver_presence_minutes_minute_idx
  on public.driver_presence_minutes (minute_started_at desc);
create index if not exists driver_presence_minutes_driver_seen_idx
  on public.driver_presence_minutes (driver_id, last_seen_at desc);

alter table public.driver_presence_minutes enable row level security;

create or replace function public.jride_touch_driver_presence_session(
  p_driver_id uuid,
  p_driver_name text,
  p_town text,
  p_status text,
  p_device_id text,
  p_seen_at timestamptz default now(),
  p_close_reason text default null
)
returns public.driver_presence_sessions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.driver_presence_sessions;
  v_open public.driver_presence_sessions;
  v_close_status text;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_gap interval := interval '5 minutes';
begin
  if p_driver_id is null then
    raise exception 'p_driver_id is required' using errcode = '22004';
  end if;

  if v_status in ('online', 'available', 'idle', 'waiting') then
    insert into public.driver_presence_minutes (
      driver_id,
      minute_started_at,
      last_seen_at,
      town,
      device_id,
      created_at,
      updated_at
    )
    values (
      p_driver_id,
      date_trunc('minute', p_seen_at),
      p_seen_at,
      nullif(trim(p_town), ''),
      nullif(trim(p_device_id), ''),
      p_seen_at,
      p_seen_at
    )
    on conflict (driver_id, minute_started_at)
    do update set
      last_seen_at = greatest(public.driver_presence_minutes.last_seen_at, excluded.last_seen_at),
      town = coalesce(excluded.town, public.driver_presence_minutes.town),
      device_id = coalesce(excluded.device_id, public.driver_presence_minutes.device_id),
      updated_at = greatest(public.driver_presence_minutes.updated_at, excluded.updated_at);

    select *
      into v_open
      from public.driver_presence_sessions
     where driver_id = p_driver_id
       and logout_at is null
     order by login_at desc
     limit 1
     for update;

    if v_open.id is not null then
      if p_seen_at < v_open.last_seen_at then
        return v_open;
      end if;

      if p_seen_at <= v_open.last_seen_at + v_gap then
        update public.driver_presence_sessions
           set driver_name = coalesce(nullif(trim(p_driver_name), ''), driver_name),
               town = coalesce(nullif(trim(p_town), ''), town),
               status = v_status,
               last_seen_at = p_seen_at,
               updated_at = p_seen_at,
               device_id = coalesce(nullif(trim(p_device_id), ''), device_id)
         where id = v_open.id
         returning * into v_row;
        return v_row;
      end if;

      update public.driver_presence_sessions
         set status = 'offline',
             logout_at = greatest(login_at, last_seen_at),
             updated_at = greatest(updated_at, last_seen_at),
             close_reason = coalesce(nullif(trim(close_reason), ''), 'heartbeat_gap_timeout')
       where id = v_open.id;
    end if;

    begin
      insert into public.driver_presence_sessions (
        driver_id,
        driver_name,
        town,
        status,
        login_at,
        last_seen_at,
        source,
        device_id,
        created_at,
        updated_at
      )
      values (
        p_driver_id,
        nullif(trim(p_driver_name), ''),
        nullif(trim(p_town), ''),
        v_status,
        p_seen_at,
        p_seen_at,
        'driver_location_ping',
        nullif(trim(p_device_id), ''),
        p_seen_at,
        p_seen_at
      )
      returning * into v_row;
    exception
      when unique_violation then
        select *
          into v_row
          from public.driver_presence_sessions
         where driver_id = p_driver_id
           and logout_at is null
         order by login_at desc
         limit 1;
    end;

    return v_row;
  end if;

  v_close_status := case
    when v_status in ('offline', 'logout', 'logged_out') then 'offline'
    else v_status
  end;

  update public.driver_presence_sessions
     set status = v_close_status,
         logout_at = greatest(login_at, last_seen_at, p_seen_at),
         last_seen_at = greatest(last_seen_at, p_seen_at),
         updated_at = greatest(updated_at, p_seen_at),
         device_id = coalesce(nullif(trim(p_device_id), ''), device_id),
         close_reason = coalesce(nullif(trim(p_close_reason), ''), 'normal_logout')
   where driver_id = p_driver_id
     and logout_at is null
     and p_seen_at >= last_seen_at
   returning * into v_row;

  return v_row;
end;
$function$;

comment on table public.driver_presence_minutes is
  'Observed driver heartbeat minutes used for reliable incentive presence accounting from 2026-08-24 onward.';
comment on function public.jride_touch_driver_presence_session(uuid,text,text,text,text,timestamptz,text) is
  'Records one heartbeat minute per driver and splits presence sessions when heartbeat gaps exceed five minutes.';

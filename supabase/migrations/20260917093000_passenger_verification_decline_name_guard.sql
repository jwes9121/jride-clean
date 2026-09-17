create or replace function public.passenger_verification_name_is_valid(p_name text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_name text;
  v_parts text[];
  v_first text;
  v_last text;
begin
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if v_name = '' then
    return false;
  end if;

  if v_name !~ '^[[:alpha:] .''-]+$' then
    return false;
  end if;

  v_parts := regexp_split_to_array(v_name, '\s+');
  if coalesce(array_length(v_parts, 1), 0) < 2 then
    return false;
  end if;

  v_first := regexp_replace(v_parts[1], '[^[:alpha:]]', '', 'g');
  v_last := regexp_replace(v_parts[array_length(v_parts, 1)], '[^[:alpha:]]', '', 'g');

  return char_length(v_first) >= 2 and char_length(v_last) >= 2;
end;
$$;

alter table public.passenger_verification_requests
  drop constraint if exists passenger_verification_requests_full_name_format_check;

alter table public.passenger_verification_requests
  add constraint passenger_verification_requests_full_name_format_check
  check (
    full_name is not null
    and public.passenger_verification_name_is_valid(full_name)
  ) not valid;

alter table public.passenger_verification_requests
  drop constraint if exists passenger_verification_requests_rejected_reason_check;

alter table public.passenger_verification_requests
  add constraint passenger_verification_requests_rejected_reason_check
  check (
    status <> 'rejected'
    or nullif(btrim(coalesce(admin_notes, '')), '') is not null
  ) not valid;

create or replace function public.sync_passenger_verifications_from_requests()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_dispatcher_reviewed_at timestamptz;
  v_admin_reviewed_at timestamptz;
  v_reject_reason text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  v_status := case new.status
    when 'submitted' then 'pending'
    when 'pending_admin' then 'pre_approved_dispatcher'
    when 'approved' then 'approved_admin'
    when 'rejected' then 'rejected'
    else null
  end;

  if v_status is null then
    return new;
  end if;

  v_dispatcher_reviewed_at := case
    when new.status = 'pending_admin' then new.reviewed_at
    else null
  end;

  v_admin_reviewed_at := case
    when new.status in ('approved', 'rejected') then new.reviewed_at
    else null
  end;

  v_reject_reason := case
    when new.status = 'rejected' then nullif(btrim(coalesce(new.admin_notes, '')), '')
    else null
  end;

  insert into public.passenger_verifications (
    user_id,
    full_name,
    status,
    dispatcher_reviewed_at,
    admin_reviewed_at,
    reject_reason,
    town_origin,
    updated_at
  )
  values (
    new.passenger_id,
    new.full_name,
    v_status,
    v_dispatcher_reviewed_at,
    v_admin_reviewed_at,
    v_reject_reason,
    new.town,
    now()
  )
  on conflict (user_id) do update set
    status = excluded.status,
    full_name = excluded.full_name,
    dispatcher_id = null,
    dispatcher_reviewed_at = excluded.dispatcher_reviewed_at,
    admin_id = null,
    admin_reviewed_at = excluded.admin_reviewed_at,
    reject_reason = excluded.reject_reason,
    town_origin = excluded.town_origin,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_passenger_verifications_from_requests
  on public.passenger_verification_requests;

create trigger trg_sync_passenger_verifications_from_requests
after insert or update of status
on public.passenger_verification_requests
for each row
execute function public.sync_passenger_verifications_from_requests();

insert into public.passenger_verifications (
  user_id,
  full_name,
  status,
  dispatcher_reviewed_at,
  admin_reviewed_at,
  reject_reason,
  town_origin,
  updated_at
)
select
  r.passenger_id,
  r.full_name,
  case r.status
    when 'submitted' then 'pending'
    when 'pending_admin' then 'pre_approved_dispatcher'
    when 'approved' then 'approved_admin'
    when 'rejected' then 'rejected'
  end,
  case when r.status = 'pending_admin' then r.reviewed_at else null end,
  case when r.status in ('approved', 'rejected') then r.reviewed_at else null end,
  case when r.status = 'rejected' then nullif(btrim(coalesce(r.admin_notes, '')), '') else null end,
  r.town,
  now()
from public.passenger_verification_requests r
where r.status in ('submitted', 'pending_admin', 'approved', 'rejected')
on conflict (user_id) do update set
  status = excluded.status,
  full_name = excluded.full_name,
  dispatcher_id = null,
  dispatcher_reviewed_at = excluded.dispatcher_reviewed_at,
  admin_id = null,
  admin_reviewed_at = excluded.admin_reviewed_at,
  reject_reason = excluded.reject_reason,
  town_origin = excluded.town_origin,
  updated_at = now();

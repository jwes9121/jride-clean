begin;

alter table public.vendor_sanctions
  add column if not exists violation_code text,
  add column if not exists vendor_message text,
  add column if not exists internal_note text,
  add column if not exists suspension_scope text,
  add column if not exists source_review_id uuid,
  add column if not exists request_id uuid,
  add column if not exists actor_user_id text,
  add column if not exists actor_email text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists pending_orders_cancelled integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendor_sanctions_suspension_scope_check'
      and conrelid = 'public.vendor_sanctions'::regclass
  ) then
    alter table public.vendor_sanctions
      add constraint vendor_sanctions_suspension_scope_check
      check (
        suspension_scope is null
        or suspension_scope in ('new_orders_only', 'all_operations')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendor_sanctions_source_review_id_fkey'
      and conrelid = 'public.vendor_sanctions'::regclass
  ) then
    alter table public.vendor_sanctions
      add constraint vendor_sanctions_source_review_id_fkey
      foreign key (source_review_id)
      references public.vendor_compliance_reviews(id)
      on delete set null;
  end if;
end;
$$;

update public.vendor_sanctions
set
  violation_code = coalesce(
    nullif(violation_code, ''),
    case
      when sanction_type = 'public_response_warning' then 'RESPONSE_WARNING'
      when sanction_type in ('suspension_7_days', 'manual') then 'COMPLIANCE_SUSPENSION'
      else 'COMPLIANCE_ACTION'
    end
  ),
  vendor_message = coalesce(nullif(vendor_message, ''), reason),
  suspension_scope = case
    when sanction_type in ('suspension_7_days', 'manual')
      then coalesce(nullif(suspension_scope, ''), 'new_orders_only')
    else suspension_scope
  end
where
  violation_code is null
  or violation_code = ''
  or vendor_message is null
  or vendor_message = ''
  or (
    sanction_type in ('suspension_7_days', 'manual')
    and suspension_scope is null
  );

update public.vendor_sanctions
set status = 'expired'
where status = 'active'
  and ends_at <= clock_timestamp();

create unique index if not exists vendor_sanctions_request_id_uidx
  on public.vendor_sanctions(request_id)
  where request_id is not null;

create unique index if not exists vendor_sanctions_one_active_suspension_uidx
  on public.vendor_sanctions(vendor_id)
  where status = 'active'
    and sanction_type in ('suspension_7_days', 'manual');

create unique index if not exists vendor_sanctions_one_active_warning_uidx
  on public.vendor_sanctions(vendor_id)
  where status = 'active'
    and sanction_type = 'public_response_warning';

create or replace function public.expire_vendor_sanctions_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_expired integer := 0;
begin
  for v_row in
    update public.vendor_sanctions
    set status = 'expired'
    where status = 'active'
      and ends_at <= clock_timestamp()
    returning vendor_id, sanction_type
  loop
    v_expired := v_expired + 1;

    if v_row.sanction_type = 'public_response_warning' then
      if not exists (
        select 1
        from public.vendor_sanctions s
        where s.vendor_id = v_row.vendor_id
          and s.status = 'active'
          and s.sanction_type = 'public_response_warning'
          and s.ends_at > clock_timestamp()
      ) then
        update public.vendor_accounts
        set
          public_response_warning_until = null,
          public_response_warning_reason = null
        where id = v_row.vendor_id;
      end if;
    elsif v_row.sanction_type in ('suspension_7_days', 'manual') then
      if not exists (
        select 1
        from public.vendor_sanctions s
        where s.vendor_id = v_row.vendor_id
          and s.status = 'active'
          and s.sanction_type in ('suspension_7_days', 'manual')
          and s.ends_at > clock_timestamp()
      ) then
        update public.vendor_accounts
        set
          suspended_until = null,
          suspension_reason = null,
          accepting_orders = false,
          daily_open_date = null,
          daily_opened_at = null,
          extended_from = null,
          extended_until = null
        where id = v_row.vendor_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'expired_count', v_expired
  );
end;
$$;

revoke all on function public.expire_vendor_sanctions_v1() from public;
revoke all on function public.expire_vendor_sanctions_v1() from anon;
revoke all on function public.expire_vendor_sanctions_v1() from authenticated;
grant execute on function public.expire_vendor_sanctions_v1() to service_role;

commit;

begin;

create or replace function public.admin_suspend_vendor_v1(
  p_vendor_id uuid,
  p_violation_code text,
  p_vendor_message text,
  p_internal_note text,
  p_ends_at timestamptz,
  p_actor_user_id text,
  p_actor_email text,
  p_request_id uuid,
  p_source_review_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_violation_code text := upper(btrim(coalesce(p_violation_code, '')));
  v_vendor_message text := btrim(coalesce(p_vendor_message, ''));
  v_internal_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_actor_user_id text := nullif(btrim(coalesce(p_actor_user_id, '')), '');
  v_actor_email text := nullif(lower(btrim(coalesce(p_actor_email, ''))), '');
  v_created_by text;
  v_vendor_name text;
  v_review public.vendor_compliance_reviews%rowtype;
  v_sanction public.vendor_sanctions%rowtype;
  v_sanction_type text := 'manual';
  v_evidence jsonb := jsonb_build_object('source', 'manual_admin');
  v_cancelled integer := 0;
begin
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_sanction
  from public.vendor_sanctions
  where request_id = p_request_id
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'sanction_id', v_sanction.id,
      'vendor_id', v_sanction.vendor_id,
      'starts_at', v_sanction.starts_at,
      'ends_at', v_sanction.ends_at,
      'pending_orders_cancelled', v_sanction.pending_orders_cancelled
    );
  end if;

  if p_vendor_id is null then
    raise exception 'VENDOR_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_violation_code !~ '^[A-Z0-9_]{3,64}$' then
    raise exception 'INVALID_VIOLATION_CODE' using errcode = 'P0001';
  end if;

  if length(v_vendor_message) < 10 or length(v_vendor_message) > 1000 then
    raise exception 'INVALID_VENDOR_MESSAGE' using errcode = 'P0001';
  end if;

  if p_ends_at is null
     or p_ends_at <= v_now
     or p_ends_at > v_now + interval '90 days' then
    raise exception 'INVALID_SUSPENSION_END' using errcode = 'P0001';
  end if;

  if v_actor_user_id is null and v_actor_email is null then
    raise exception 'ACTOR_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  v_created_by := coalesce(v_actor_email, v_actor_user_id, 'JRide admin');

  perform public.expire_vendor_sanctions_v1();

  select coalesce(
    nullif(btrim(display_name), ''),
    nullif(btrim(email), ''),
    id::text
  )
  into v_vendor_name
  from public.vendor_accounts
  where id = p_vendor_id
  for update;

  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.vendor_sanctions s
    where s.vendor_id = p_vendor_id
      and s.status = 'active'
      and s.sanction_type in ('suspension_7_days', 'manual')
      and s.ends_at > v_now
  ) then
    raise exception 'VENDOR_ALREADY_SUSPENDED' using errcode = 'P0001';
  end if;

  if p_source_review_id is not null then
    select *
    into v_review
    from public.vendor_compliance_reviews
    where id = p_source_review_id
    for update;

    if not found then
      raise exception 'COMPLIANCE_REVIEW_NOT_FOUND' using errcode = 'P0001';
    end if;

    if v_review.vendor_id <> p_vendor_id then
      raise exception 'COMPLIANCE_REVIEW_VENDOR_MISMATCH' using errcode = 'P0001';
    end if;

    if v_review.status <> 'pending' then
      raise exception 'COMPLIANCE_REVIEW_NOT_PENDING' using errcode = 'P0001';
    end if;

    if v_review.review_type not in ('suspension_timeout', 'suspension_offline') then
      raise exception 'COMPLIANCE_REVIEW_NOT_SUSPENSION' using errcode = 'P0001';
    end if;

    v_sanction_type := 'suspension_7_days';
    v_evidence := coalesce(v_review.evidence, '{}'::jsonb);

    if v_review.review_type = 'suspension_timeout' then
      v_violation_code := 'REPEATED_ORDER_TIMEOUTS';
    else
      v_violation_code := 'REPEATED_UNEXCUSED_OFFLINE_DAYS';
    end if;

    if v_vendor_message = '' then
      v_vendor_message := v_review.reason;
    end if;
  end if;

  insert into public.vendor_sanctions(
    vendor_id,
    sanction_type,
    status,
    starts_at,
    ends_at,
    reason,
    evidence,
    created_by,
    violation_code,
    vendor_message,
    internal_note,
    suspension_scope,
    source_review_id,
    request_id,
    actor_user_id,
    actor_email,
    pending_orders_cancelled
  ) values (
    p_vendor_id,
    v_sanction_type,
    'active',
    v_now,
    p_ends_at,
    v_vendor_message,
    v_evidence,
    v_created_by,
    v_violation_code,
    v_vendor_message,
    v_internal_note,
    'new_orders_only',
    p_source_review_id,
    p_request_id,
    v_actor_user_id,
    v_actor_email,
    0
  )
  returning * into v_sanction;

  update public.vendor_accounts
  set
    suspended_until = p_ends_at,
    suspension_reason = v_vendor_message,
    accepting_orders = false,
    daily_open_date = null,
    daily_opened_at = null,
    extended_from = null,
    extended_until = null,
    consecutive_vendor_timeouts = 0,
    consecutive_offline_days = 0
  where id = p_vendor_id;

  update public.bookings
  set
    status = 'cancelled',
    vendor_status = 'cancelled',
    vendor_responded_at = coalesce(vendor_responded_at, v_now),
    vendor_rejected_at = coalesce(vendor_rejected_at, v_now),
    vendor_cancel_reason = 'Vendor temporarily unavailable by JRide administration',
    cancel_reason = 'Vendor temporarily unavailable by JRide administration',
    updated_at = v_now
  where lower(coalesce(service_type, '')) = 'takeout'
    and vendor_id = p_vendor_id
    and lower(btrim(coalesce(vendor_status, ''))) in ('', 'requested', 'vendor_pending')
    and lower(btrim(coalesce(status, ''))) not in ('completed', 'cancelled');

  get diagnostics v_cancelled = row_count;

  update public.vendor_sanctions
  set pending_orders_cancelled = v_cancelled
  where id = v_sanction.id;

  if p_source_review_id is not null then
    update public.vendor_compliance_reviews
    set
      status = 'approved',
      reviewed_at = v_now,
      reviewed_by = v_created_by,
      review_note = v_internal_note
    where id = p_source_review_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'sanction_id', v_sanction.id,
    'vendor_id', p_vendor_id,
    'vendor_name', v_vendor_name,
    'violation_code', v_violation_code,
    'starts_at', v_now,
    'ends_at', p_ends_at,
    'pending_orders_cancelled', v_cancelled
  );
end;
$$;

revoke all on function public.admin_suspend_vendor_v1(uuid, text, text, text, timestamptz, text, text, uuid, uuid) from public;
revoke all on function public.admin_suspend_vendor_v1(uuid, text, text, text, timestamptz, text, text, uuid, uuid) from anon;
revoke all on function public.admin_suspend_vendor_v1(uuid, text, text, text, timestamptz, text, text, uuid, uuid) from authenticated;
grant execute on function public.admin_suspend_vendor_v1(uuid, text, text, text, timestamptz, text, text, uuid, uuid) to service_role;

commit;

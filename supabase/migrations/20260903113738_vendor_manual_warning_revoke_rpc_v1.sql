begin;

create or replace function public.admin_approve_vendor_warning_v1(
  p_review_id uuid,
  p_internal_note text,
  p_actor_user_id text,
  p_actor_email text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ends_at timestamptz := clock_timestamp() + interval '7 days';
  v_internal_note text := nullif(btrim(coalesce(p_internal_note, '')), '');
  v_actor_user_id text := nullif(btrim(coalesce(p_actor_user_id, '')), '');
  v_actor_email text := nullif(lower(btrim(coalesce(p_actor_email, ''))), '');
  v_created_by text;
  v_review public.vendor_compliance_reviews%rowtype;
  v_sanction public.vendor_sanctions%rowtype;
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
      'ends_at', v_sanction.ends_at
    );
  end if;

  if p_review_id is null then
    raise exception 'REVIEW_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_actor_user_id is null and v_actor_email is null then
    raise exception 'ACTOR_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  v_created_by := coalesce(v_actor_email, v_actor_user_id, 'JRide admin');

  perform public.expire_vendor_sanctions_v1();

  select *
  into v_review
  from public.vendor_compliance_reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception 'COMPLIANCE_REVIEW_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_review.status <> 'pending' then
    raise exception 'COMPLIANCE_REVIEW_NOT_PENDING' using errcode = 'P0001';
  end if;

  if v_review.review_type <> 'response_warning' then
    raise exception 'COMPLIANCE_REVIEW_NOT_WARNING' using errcode = 'P0001';
  end if;

  perform 1
  from public.vendor_accounts
  where id = v_review.vendor_id
  for update;

  if not found then
    raise exception 'VENDOR_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.vendor_sanctions s
    where s.vendor_id = v_review.vendor_id
      and s.status = 'active'
      and s.sanction_type = 'public_response_warning'
      and s.ends_at > v_now
  ) then
    raise exception 'VENDOR_WARNING_ALREADY_ACTIVE' using errcode = 'P0001';
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
    source_review_id,
    request_id,
    actor_user_id,
    actor_email
  ) values (
    v_review.vendor_id,
    'public_response_warning',
    'active',
    v_now,
    v_ends_at,
    v_review.reason,
    coalesce(v_review.evidence, '{}'::jsonb),
    v_created_by,
    'REPEATED_ORDER_TIMEOUTS',
    v_review.reason,
    v_internal_note,
    p_review_id,
    p_request_id,
    v_actor_user_id,
    v_actor_email
  )
  returning * into v_sanction;

  update public.vendor_accounts
  set
    public_response_warning_until = v_ends_at,
    public_response_warning_reason = v_review.reason
  where id = v_review.vendor_id;

  update public.vendor_compliance_reviews
  set
    status = 'approved',
    reviewed_at = v_now,
    reviewed_by = v_created_by,
    review_note = v_internal_note
  where id = p_review_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'sanction_id', v_sanction.id,
    'vendor_id', v_review.vendor_id,
    'starts_at', v_now,
    'ends_at', v_ends_at
  );
end;
$$;

create or replace function public.admin_revoke_vendor_sanction_v1(
  p_sanction_id uuid,
  p_reason text,
  p_actor_user_id text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor_user_id text := nullif(btrim(coalesce(p_actor_user_id, '')), '');
  v_actor_email text := nullif(lower(btrim(coalesce(p_actor_email, ''))), '');
  v_revoked_by text;
  v_sanction public.vendor_sanctions%rowtype;
begin
  if p_sanction_id is null then
    raise exception 'SANCTION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if length(v_reason) < 5 or length(v_reason) > 1000 then
    raise exception 'INVALID_REVOCATION_REASON' using errcode = 'P0001';
  end if;

  if v_actor_user_id is null and v_actor_email is null then
    raise exception 'ACTOR_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  v_revoked_by := coalesce(v_actor_email, v_actor_user_id, 'JRide admin');

  select *
  into v_sanction
  from public.vendor_sanctions
  where id = p_sanction_id
  for update;

  if not found then
    raise exception 'SANCTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_sanction.status <> 'active' then
    raise exception 'SANCTION_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  update public.vendor_sanctions
  set
    status = 'revoked',
    revoked_at = v_now,
    revoked_by = v_revoked_by,
    revoke_reason = v_reason
  where id = p_sanction_id;

  if v_sanction.sanction_type = 'public_response_warning' then
    update public.vendor_accounts
    set
      public_response_warning_until = null,
      public_response_warning_reason = null
    where id = v_sanction.vendor_id;
  elsif v_sanction.sanction_type in ('suspension_7_days', 'manual') then
    update public.vendor_accounts
    set
      suspended_until = null,
      suspension_reason = null,
      accepting_orders = false,
      daily_open_date = null,
      daily_opened_at = null,
      extended_from = null,
      extended_until = null
    where id = v_sanction.vendor_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'sanction_id', p_sanction_id,
    'vendor_id', v_sanction.vendor_id,
    'sanction_type', v_sanction.sanction_type,
    'revoked_at', v_now
  );
end;
$$;

revoke all on function public.admin_approve_vendor_warning_v1(uuid, text, text, text, uuid) from public;
revoke all on function public.admin_approve_vendor_warning_v1(uuid, text, text, text, uuid) from anon;
revoke all on function public.admin_approve_vendor_warning_v1(uuid, text, text, text, uuid) from authenticated;
grant execute on function public.admin_approve_vendor_warning_v1(uuid, text, text, text, uuid) to service_role;

revoke all on function public.admin_revoke_vendor_sanction_v1(uuid, text, text, text) from public;
revoke all on function public.admin_revoke_vendor_sanction_v1(uuid, text, text, text) from anon;
revoke all on function public.admin_revoke_vendor_sanction_v1(uuid, text, text, text) from authenticated;
grant execute on function public.admin_revoke_vendor_sanction_v1(uuid, text, text, text) to service_role;

commit;

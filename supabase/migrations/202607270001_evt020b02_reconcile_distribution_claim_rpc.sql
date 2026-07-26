/*
JRide Events Platform
Feature: EVT-020B02
Purpose: Repository reconciliation only. Captures the current, already-live
definition of record_event_distribution_claim verbatim, with no logic
change whatsoever. This function was applied directly to production
outside the migration history (same situation as the EVT-020B01 RLS
policies) - it does not appear in any prior migration file. This migration
exists solely so a fresh environment reproduces the current production
behavior, and so the next migration (adding lifecycle enforcement) is a
reviewable diff against an accurate baseline rather than presenting
pre-existing production logic as newly introduced code.

No intended behavioral change for existing production databases. This is
byte-for-byte the function definition returned by inspecting pg_proc in
production (identity_arguments, result_type, language, and body all
verified against the live database before this file was written).

Rollback:
  drop function if exists public.record_event_distribution_claim(uuid, uuid, text, text, text, text);
*/

create or replace function public.record_event_distribution_claim(
  p_event_id uuid,
  p_entitlement_id uuid,
  p_claimed_by_email text,
  p_claim_method text default 'qr'::text,
  p_counter_name text default null::text,
  p_notes text default null::text
)
returns table (
  inserted boolean,
  claim_id uuid,
  effective_claimed_at timestamp with time zone,
  entitlement_id uuid,
  beneficiary_id uuid,
  program_id uuid
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_entitlement public.event_distribution_entitlements%rowtype;
  v_beneficiary public.event_distribution_beneficiaries%rowtype;
  v_program public.event_distribution_programs%rowtype;
  v_existing public.event_distribution_claims%rowtype;
  v_claim public.event_distribution_claims%rowtype;
  v_now timestamptz := now();
  v_email text := btrim(coalesce(p_claimed_by_email, ''));
  v_method text := btrim(coalesce(p_claim_method, 'qr'));
begin
  if p_event_id is null or p_entitlement_id is null then
    raise exception 'EVENT_AND_ENTITLEMENT_REQUIRED';
  end if;

  if v_email = '' then
    raise exception 'CLAIMED_BY_EMAIL_REQUIRED';
  end if;

  if v_method not in (
    'qr',
    'printed_stub',
    'manual_search'
  ) then
    raise exception 'INVALID_CLAIM_METHOD';
  end if;

  select ent.*
  into v_entitlement
  from public.event_distribution_entitlements ent
  where ent.id = p_entitlement_id
    and ent.event_id = p_event_id
  for update;

  if not found then
    raise exception 'ENTITLEMENT_NOT_FOUND';
  end if;

  select prog.*
  into v_program
  from public.event_distribution_programs prog
  where prog.id = v_entitlement.program_id
    and prog.event_id = p_event_id;

  if not found then
    raise exception 'PROGRAM_NOT_FOUND';
  end if;

  if v_program.status <> 'active' then
    raise exception 'PROGRAM_NOT_ACTIVE';
  end if;

  if
    v_program.starts_at is not null
    and v_program.starts_at > v_now
  then
    raise exception 'PROGRAM_NOT_STARTED';
  end if;

  if
    v_program.ends_at is not null
    and v_program.ends_at <= v_now
  then
    raise exception 'PROGRAM_ENDED';
  end if;

  select ben.*
  into v_beneficiary
  from public.event_distribution_beneficiaries ben
  where ben.id = v_entitlement.beneficiary_id
    and ben.program_id = v_entitlement.program_id
    and ben.event_id = p_event_id;

  if not found then
    raise exception 'BENEFICIARY_NOT_FOUND';
  end if;

  if v_beneficiary.status <> 'active' then
    raise exception 'BENEFICIARY_NOT_ACTIVE';
  end if;

  select clm.*
  into v_existing
  from public.event_distribution_claims clm
  where clm.entitlement_id = v_entitlement.id;

  if found then
    return query
    select
      false,
      v_existing.id,
      v_existing.claimed_at,
      v_existing.entitlement_id,
      v_existing.beneficiary_id,
      v_existing.program_id;

    return;
  end if;

  if v_entitlement.status = 'cancelled' then
    raise exception 'ENTITLEMENT_CANCELLED';
  end if;

  if v_entitlement.status = 'claimed' then
    raise exception 'ENTITLEMENT_ALREADY_CLAIMED';
  end if;

  insert into public.event_distribution_claims (
    event_id,
    program_id,
    beneficiary_id,
    entitlement_id,
    claimed_quantity,
    unit_label,
    claim_method,
    counter_name,
    claimed_by_email,
    claimed_at,
    notes
  )
  values (
    p_event_id,
    v_entitlement.program_id,
    v_entitlement.beneficiary_id,
    v_entitlement.id,
    v_entitlement.quantity,
    v_entitlement.unit_label,
    v_method,
    nullif(
      btrim(coalesce(p_counter_name, '')),
      ''
    ),
    v_email,
    v_now,
    nullif(
      btrim(coalesce(p_notes, '')),
      ''
    )
  )
  returning *
  into v_claim;

  update public.event_distribution_entitlements ent
  set
    status = 'claimed',
    claimed_at = v_claim.claimed_at,
    updated_at = v_claim.claimed_at
  where ent.id = v_entitlement.id;

  return query
  select
    true,
    v_claim.id,
    v_claim.claimed_at,
    v_claim.entitlement_id,
    v_claim.beneficiary_id,
    v_claim.program_id;
end;
$function$;

revoke all on function public.record_event_distribution_claim(uuid, uuid, text, text, text, text) from public;
grant execute on function public.record_event_distribution_claim(uuid, uuid, text, text, text, text) to service_role;

/*
JRide Events Platform
Feature: EVT-020A03
Purpose: Single authoritative write path for `events.status`. Validates the
         current state and the requested transition against an explicit
         allow-list, rejects anything not on that list, applies the change,
         and writes an event_audit_logs entry - all in one transaction.

Actor identity correction:
  Staff sessions authenticated via Google set session.user.id to
  String(token.sub) (see auth.ts), where token.sub is the identity
  provider's subject claim - a string, not guaranteed to be a PostgreSQL
  UUID. requireStaff() passes that value through unchanged as staff.id.
  event_audit_logs.actor_id is a uuid column, so accepting a raw uuid
  parameter here would throw an invalid input syntax error on a normal
  Google-authenticated staff session before the transition completes.

  Fix: accept the actor identifier as text (p_actor_identifier), along with
  email/name/role as separate text parameters. Only cast and store
  actor_id when the identifier is actually UUID-shaped; otherwise leave
  actor_id null and preserve the real identity - identifier, email, name,
  role - inside the audit log's `details` jsonb regardless of whether the
  identifier happened to be a UUID. This keeps the audit trail complete
  even when actor_id itself cannot be set.

Scope decision (per Phase 2A Step 3 planning):
  This RPC owns status validation, transition, and audit logging ONLY.
  It does not touch event_station_tokens, check-in, checkpoint-scan, raffle,
  or distribution-program state. Those are explicitly deferred to later,
  separate "lifecycle integration" changes (one subsystem per commit), so
  this migration's blast radius is limited to the events table and its
  audit log.

Transition matrix (no stated organizer requirement exists yet for anything
beyond this, so nothing wider was added):
  Forward (linear, one step at a time, no skipping):
    draft               -> published
    published           -> registration_open
    registration_open   -> registration_closed
    registration_closed -> live
    live                -> completed
    completed           -> archived
  Backward (explicit, low-risk operational corrections only):
    published           -> draft                (unpublish)
    registration_closed -> registration_open    (reopen registration)
  `archived` is terminal - no transition out of it via this RPC. Reactivating
  an archived event, if ever needed, is out of scope here and would be its
  own explicit decision later.

Rollback:
  drop function if exists public.transition_event_lifecycle(text, text, text, text, text, text, text);
*/

create or replace function public.transition_event_lifecycle(
  p_event_slug text,
  p_to_status text,
  p_actor_identifier text default null,
  p_actor_email text default null,
  p_actor_name text default null,
  p_actor_role text default null,
  p_reason text default null
)
returns table (
  success boolean,
  event_id uuid,
  previous_status text,
  new_status text,
  error_code text,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_current_status text;
  v_allowed boolean;
  v_actor_uuid uuid;
begin
  perform pg_advisory_xact_lock(hashtext('event_lifecycle:' || p_event_slug));

  select id, status
    into v_event_id, v_current_status
  from public.events
  where slug = p_event_slug;

  if v_event_id is null then
    return query select
      false, null::uuid, null::text, null::text,
      'EVENT_NOT_FOUND', 'Event was not found.';
    return;
  end if;

  if p_to_status not in (
    'draft', 'published', 'registration_open',
    'registration_closed', 'live', 'completed', 'archived'
  ) then
    return query select
      false, v_event_id, v_current_status, null::text,
      'INVALID_STATUS', 'Unknown lifecycle status.';
    return;
  end if;

  if v_current_status = p_to_status then
    return query select
      false, v_event_id, v_current_status, null::text,
      'NO_OP_TRANSITION', 'Event is already in the requested status.';
    return;
  end if;

  v_allowed := (v_current_status, p_to_status) in (
    ('draft', 'published'),
    ('published', 'registration_open'),
    ('registration_open', 'registration_closed'),
    ('registration_closed', 'live'),
    ('live', 'completed'),
    ('completed', 'archived'),
    ('published', 'draft'),
    ('registration_closed', 'registration_open')
  );

  if not v_allowed then
    return query select
      false, v_event_id, v_current_status, null::text,
      'INVALID_TRANSITION',
      format('Cannot transition from %s to %s.', v_current_status, p_to_status);
    return;
  end if;

  -- Only cast/store actor_id when the identifier is actually UUID-shaped.
  -- Google-provider staff sessions carry a non-UUID subject claim, so this
  -- will legitimately be null for most real transitions today - the full
  -- identity is preserved in `details` below regardless.
  v_actor_uuid := case
    when btrim(coalesce(p_actor_identifier, ''))
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then p_actor_identifier::uuid
    else null
  end;

  update public.events
  set status = p_to_status,
      updated_at = now()
  where id = v_event_id;

  insert into public.event_audit_logs (event_id, actor_id, action, details)
  values (
    v_event_id,
    v_actor_uuid,
    'event_lifecycle_transition',
    jsonb_build_object(
      'actor_identifier', p_actor_identifier,
      'actor_email', p_actor_email,
      'actor_name', p_actor_name,
      'actor_role', p_actor_role,
      'from_status', v_current_status,
      'to_status', p_to_status,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return query select
    true, v_event_id, v_current_status, p_to_status,
    null::text, null::text;
end;
$$;

revoke all on function public.transition_event_lifecycle(text, text, text, text, text, text, text) from public;
grant execute on function public.transition_event_lifecycle(text, text, text, text, text, text, text) to service_role;

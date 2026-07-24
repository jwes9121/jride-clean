/*
JRide Events Platform
Feature: EVT-020A04
Purpose: Extract the lifecycle transition matrix (currently inline inside
         transition_event_lifecycle's body, committed in EVT-020A03 /
         9835db0c) into a standalone, queryable function. This lets the
         organizer UI ask "what transitions are valid from the current
         state" by querying the same source the transition RPC itself
         enforces against, instead of a second copy of the matrix hardcoded
         in TypeScript. Single source of truth stays in the database.

This does not change transition_event_lifecycle's signature, its callers,
or its validated behavior - only where the matrix data lives. The matrix
values are unchanged from EVT-020A03.

Rollback:
  -- restores transition_event_lifecycle to its EVT-020A03 body (inline matrix)
  -- see supabase/migrations/202607250001_evt020a03_transition_event_lifecycle_rpc.sql
  -- for the prior create-or-replace statement to reapply if needed.
  drop function if exists public.event_lifecycle_allowed_transitions();
*/

-- Shared matrix source. STABLE (not IMMUTABLE) since it's a set-returning
-- function rather than a constant, but its output never varies within or
-- across calls for fixed input - matches how the rest of this codebase
-- treats small static lookup functions.
create or replace function public.event_lifecycle_allowed_transitions()
returns table (from_status text, to_status text)
language sql
stable
as $$
  values
    ('draft', 'published'),
    ('published', 'registration_open'),
    ('registration_open', 'registration_closed'),
    ('registration_closed', 'live'),
    ('live', 'completed'),
    ('completed', 'archived'),
    ('published', 'draft'),
    ('registration_closed', 'registration_open')
$$;

-- Readable by any authenticated staff session (admin or dispatcher), since
-- it's read-only lookup data with no sensitive content, and the organizer
-- UI needs it to render valid-transition buttons for anyone who can view
-- the lifecycle page (the write path, transition_event_lifecycle itself,
-- remains admin-only and unaffected by this grant).
revoke all on function public.event_lifecycle_allowed_transitions() from public;
grant execute on function public.event_lifecycle_allowed_transitions() to service_role;

-- Refactor transition_event_lifecycle to validate against the shared
-- function instead of its own inline VALUES list. Same signature, same
-- validated behavior (EVT020A03), body only.
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

  select exists (
    select 1
    from public.event_lifecycle_allowed_transitions() t
    where t.from_status = v_current_status
      and t.to_status = p_to_status
  ) into v_allowed;

  if not v_allowed then
    return query select
      false, v_event_id, v_current_status, null::text,
      'INVALID_TRANSITION',
      format('Cannot transition from %s to %s.', v_current_status, p_to_status);
    return;
  end if;

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

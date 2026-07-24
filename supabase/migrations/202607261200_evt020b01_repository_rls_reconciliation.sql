/*
JRide Events Platform
Feature: EVT-020B01
Purpose: Repository reconciliation, not historical replay.

Context (see docs/evt-020-phase1-evidence.md and the EVT-020 Phase 2A record):
  The public RLS policies on `events` and `event_pages` were applied directly
  against the production database via the Supabase SQL editor during EVT-020
  Phase 2A Step 1. They were never committed as a migration file. A
  git-history search across the full migration path confirmed no commit,
  under any filename, ever created or altered these policies:

    git log --all -G "create policy" -- the SQL migration files

  returned nothing relevant to these two policies. Production already has
  the correct, verified behavior (confirmed live: draft/archived events
  excluded from public reads on both tables). This migration exists solely
  so a fresh environment built from supabase/migrations/ alone reproduces
  that same behavior - it does not change anything in the already-correct
  production database.

No intended behavioral change for existing production databases. Every
statement below is idempotent (drop-if-exists then create) and safe to run
against a database that already has these policies under either the
production policy names or no policies at all.

Public lifecycle states (visible): published, registration_open,
  registration_closed, live, completed
Hidden: draft, archived

Rollback:
  drop policy if exists "Public can read public lifecycle events" on public.events;
  drop policy if exists "Public can read public lifecycle event pages" on public.event_pages;

  create policy "Public can read published events"
    on public.events
    for select
    to anon, authenticated
    using (status = 'published');

  create policy "Public can read event pages"
    on public.event_pages
    for select
    to anon, authenticated
    using (true);
*/

-- Reconcile 1: events - public SELECT limited to the verified public-facing
-- lifecycle states. Drops both the pre-EVT-020 policy name and the current
-- production policy name (whichever is present, or neither) before
-- recreating, so this is safe regardless of prior state.

drop policy if exists "Public can read published events" on public.events;
drop policy if exists "Public can read public lifecycle events" on public.events;

create policy "Public can read public lifecycle events"
  on public.events
  for select
  to anon, authenticated
  using (
    status in (
      'published',
      'registration_open',
      'registration_closed',
      'live',
      'completed'
    )
  );

-- Reconcile 2: event_pages - public SELECT scoped to rows whose parent
-- event is in the same public lifecycle state set, replacing the original
-- unconditional qual = true grant.

drop policy if exists "Public can read event pages" on public.event_pages;
drop policy if exists "Public can read public lifecycle event pages" on public.event_pages;

create policy "Public can read public lifecycle event pages"
  on public.event_pages
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_pages.event_id
        and e.status in (
          'published',
          'registration_open',
          'registration_closed',
          'live',
          'completed'
        )
    )
  );

-- Reconcile 3 (scope note, no action taken): Phase 1 verified that no other
-- event table (event_attendees, event_checkins, event_tickets, the
-- event_distribution_* tables, event_station_tokens, raffle, sponsors,
-- gallery, audit logs, group values, guest links) has a public
-- anon/authenticated policy - they are RLS-enabled with no matching policy,
-- i.e. default-deny for those roles, and reachable only via supabaseAdmin()
-- (service role). This migration intentionally leaves all of them
-- untouched.

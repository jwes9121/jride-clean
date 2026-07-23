# EVT-020 Phase 1  -  Evidence Report

Repository inspected: `jride-clean-push` (as provided).
Scope: Event Lifecycle & Retention  -  evidence collection only. No code, schema, or migration changes were made in this phase.

---

## 1. Events Table

**Verified.** Source: `supabase/migrations/20260703234000_jride_events_core_v1.sql`, lines 3-19.

```sql
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text,
  event_date date,
  venue text,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'registration_open', 'registration_closed', 'live', 'completed', 'archived')),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  group_label text not null default 'Batch',
  group_type text not null default 'alumni',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Key finding: **`events.status` already has a check constraint enumerating exactly the seven lifecycle values previously discussed**  -  `draft`, `published`, `registration_open`, `registration_closed`, `live`, `completed`, `archived` (line 12). No separate `visibility`, `is_public`, `published` boolean, or `archived_at`/`deleted_at` column exists anywhere in this table or in any later migration touching `events`.

Related tables created in the same migration (`event_settings`, `event_pages`, `event_attendee_types`, `event_attendees`, `event_guest_links`, `event_checkins`, `event_raffle_draws`, `event_raffle_winners`, `event_sponsors`, `event_announcements`, `event_gallery`, `event_audit_logs`)  -  full definitions at lines 21-198 of the same file.

Subsequent migrations altering `events`/`event_attendees`:
- `supabase/migrations/202607040001_evt003_registration_identity.sql`  -  adds `events.reg_prefix` (line 12), `event_attendees.reg_sequence` and `event_attendees.registration_number`.
- `supabase/migrations/202607050001_evt006_checked_in_by.sql`  -  adds `event_attendees.checked_in_by`.
- `supabase/migrations/202607040003_evt003a_event_group_values.sql`  -  adds a new table `event_group_values`, no changes to `events`.

**Not verified:** whether `events` has row-level security (RLS) enabled, and if so, its policies. No migration file in `supabase/migrations/` contains an `enable row level security` or `create policy` statement for `events` or any `event_*` table (checked all 6 migration files under `supabase/migrations/`). If RLS exists, it was applied outside this migration history (e.g. directly in the Supabase dashboard) and is not visible from the repository.

**Not verified:** the live/current values of `events.status` for existing rows, and whether any row currently holds `registration_open`, `registration_closed`, `live`, or `archived`  -  only the seed row (`dbhs-2026`, inserted at status `published`, lines 211-231 of the core migration) is visible in the migration history.

---

## 2. Organizer/Admin Event Management

**Not currently implemented.**

- No route exists under `app/admin/` for events. `find app/admin -maxdepth 2 -type d` lists 40+ existing admin sections (livetrips, dispatch, finance, vendors, drivers, etc.)  -  none named `events` or similar.
- No API route exists at `app/api/events/[eventSlug]/route.ts` (i.e., there is no generic event-update endpoint). The only file at that path level is `app/api/events/[eventSlug]/group-values/route.ts` and other nested sub-routes; there is no bare `route.ts` directly under `[eventSlug]`.
- No code anywhere in `app/` or `lib/` updates `events.status`, `events.slug`, `events.name`, or any other core `events` column. A repository-wide search for `.update(` calls against the `events` table returned no results.
- No organizer-facing UI exists for editing hero content, publishing, marking an event complete, or archiving it. `event_pages` (hero title/subtitle/banner/theme, etc.) is populated only via direct SQL insert in the core migration (lines 237-254); no UI or API writes to it.

Conclusion: organizers currently cannot change an event's status, visibility, or public page content through the application  -  these actions, if they occur at all today, must happen by direct database/SQL access outside the codebase.

---

## 3. Public Event Listing

**Verified.** Source: `app/events/page.tsx`, lines 12-16.

```ts
const { data: events } = await supabase
  .from("events")
  .select("slug,name,short_name,event_date,venue,description,status")
  .eq("status", "published")
  .order("event_date", { ascending: true });
```

- Filtering: only rows where `status = 'published'` are listed (line 15). Ordered by `event_date` ascending (line 16). No `.limit()`, no pagination.
- No visibility field is checked (none exists).
- **Completed-event behavior: not handled.** An event whose `status` has moved to `registration_open`, `registration_closed`, `live`, `completed`, or `archived` would **disappear from the public listing entirely**, because the query only matches `status = 'published'`. There is no branch that keeps `completed` events visible, "marked Completed," or otherwise distinguished  -  they simply stop matching the query.
- Client: uses the public anon Supabase key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, line 7) directly from a server component  -  no staff/session gate on this page (expected, since it's the public listing).

---

## 4. Public Event Detail Page

**Verified.** Source: `app/events/[eventSlug]/page.tsx`, lines 35-42.

```ts
const { data: event } = await supabase
  .from("events")
  .select("id,slug,name,event_date,venue,description,status")
  .eq("slug", params.eventSlug)
  .eq("status", "published")
  .maybeSingle();

if (!event) notFound();
```

- Same `status = 'published'` gate as the listing page (line 39). If an event is not `published`  -  including `completed` or `archived`  -  this route returns a 404 (line 42), regardless of whether the event previously had a public presence.
- No separate check for a `visibility` or `unlisted` concept (none exists in schema).
- No "safe public totals" rendering exists on this page  -  the page shows hero content, event date, countdown, venue, and a registration CTA (lines 53-137) but does not query or display attendance counts, distribution totals, or any aggregate statistics.
- Data loading uses the same public anon client pattern as the listing page (lines 7-8, 33).

**Gap relative to the discussed design:** there is currently no code path that keeps a `completed` event's public page reachable (as a "public but marked Completed" archive)  -  the current implementation would make it unreachable the moment its status leaves `published`.

---

## 5. Event Update APIs

**Verified  -  no endpoint capable of updating `events` core fields exists.**

Full route inventory under `app/api/events/[eventSlug]/`:

```
attendees/[attendeeId]/disqualify/route.ts
attendees/[attendeeId]/reissue-pass/route.ts
attendees/[attendeeId]/route.ts
check-in/route.ts
checkpoint-scan/route.ts
command-center/route.ts
distribution/claim/route.ts
distribution/households/route.ts
distribution/reports/route.ts
group-values/route.ts
help-desk/register/route.ts
help-desk/search/route.ts
pass/[registrationNumber]/image/route.js
pass/[registrationNumber]/route.ts
raffle/[winnerId]/route.ts
raffle/animation-names/route.ts
raffle/current/route.ts
raffle/draw/route.ts
register/route.ts
reports/attendance-summary/route.ts
stations/issue/route.ts
ticket-availability/route.ts
ticket-register/route.ts
```

None of these routes write to the `events` table. All routes that reference `events` do so via `.select()` only (read), for example:
- `app/api/events/[eventSlug]/check-in/route.ts`, line 56: `.select("id,slug,group_label")`
- `app/api/events/[eventSlug]/distribution/claim/route.ts`, line 108: `.select("id,slug,name,status")`  -  `status` is selected but never referenced again in the file (confirmed by search: no `event.status` or equivalent check found after the select).
- `app/api/events/[eventSlug]/pass/[registrationNumber]/route.ts`, line 64: `.eq("status", "published")`  -  this route additionally gates the Event Pass view itself on `status = 'published'`.
- `app/api/events/[eventSlug]/group-values/route.ts`, line 18: `.eq("status", "published")`.
- `app/api/events/[eventSlug]/ticket-availability/route.ts`, lines 43-50: selects `status`, `registration_opens_at`, `registration_closes_at` and returns them to the caller for display (lines 129-141)  -  these values are **not used to gate** ticket availability logic in this file.

**Permissions on the routes that do exist** (via `lib/auth/requireStaff.ts`, which checks a NextAuth session against roles `admin` | `dispatcher`):

| Route | Allowed roles |
|---|---|
| `stations/issue` | `admin` only |
| `raffle/draw`, `attendees/.../disqualify` | `admin` only |
| `command-center`, `attendees/[attendeeId]`, `attendees/.../reissue-pass`, `reports/attendance-summary`, `help-desk/register` | `admin`, `dispatcher` |
| `distribution/reports`, `distribution/households` | `admin`/staff roles (see `distribution/households/route.ts` line 79; `distribution/reports/route.ts` line 193) |
| `check-in`, `checkpoint-scan` | Not gated by `requireStaff`  -  gated instead by a per-station token (`requireEventStation`, see Section 9/Section 10 below) |

No role or permission level named "organizer" exists; access control is the same two-role staff model (`admin`, `dispatcher`) used elsewhere in the JRide platform, reused for events.

---

## 6. Registration Lifecycle

**Verified.** Core logic in `lib/events/registration.ts`.

- `getEvent()` (lines 13-22) fetches `id, slug, status` for the event.
- Status gate, lines 161-166:

```ts
if (event.status !== "published" && event.status !== "registration_open") {
  return {
    success: false,
    error: { code: "EVENT_NOT_OPEN", message: "Registration is not open." },
  };
}
```

  Registration is permitted only when `status` is `published` **or** `registration_open`. This is the one place in the codebase where more than one lifecycle status value is actively enforced.

- `registerAttendee()` from this file is called by two API routes: `app/api/events/[eventSlug]/register/route.ts` (public online registration, line 2/13) and `app/api/events/[eventSlug]/help-desk/register/route.ts` (assisted/walk-in registration by staff, line 15/73)  -  both therefore inherit the same status gate.
- **Gap:** `app/api/events/[eventSlug]/ticket-register/route.ts` (a separate ticket-based registration path) does **not** import or call `registerAttendee`, and a search of that file for `events` table access or `status` checks returned no matches. This path currently has **no event-status enforcement**  -  it is not verified whether it can be used to register attendees regardless of event status.
- `registration_opens_at` / `registration_closes_at` (the timestamp columns) are **not read anywhere in the registration-write path**  -  they are only selected and returned as display data in `ticket-availability/route.ts` (Section 5 above). No code compares "now" to these timestamps to open or close registration automatically.
- `event_settings.registration_enabled` (boolean column, core migration line 24) exists but a search for `registration_enabled` across `app/` and `lib/` returned no matches  -  **not currently read or enforced anywhere in application code.**

---

## 7. Distribution Lifecycle

**Verified**, in `app/api/events/[eventSlug]/distribution/households/route.ts`.

- Distribution programs carry their own independent `status` field, separate from `events.status`. Program-open enforcement, lines 510-523:

```ts
if (
  program.status === "cancelled" ||
  program.status === "closed"
) {
  return noStore(
    {
      success: false,
      reason: "program_not_open",
      message: "Honga Pahing program is not open for household registration.",
    },
    409
  );
}
```

- Claim-token behavior is handled in `app/api/events/[eventSlug]/distribution/claim/route.ts`; entitlement status values observed in code (`status`, `claim_token`, `claimed_at`  -  line 130-131) include at least `allocated`, `claimed`, `cancelled` (per usage in `distribution/reports/route.ts`, lines 122-148).
- **Gap:** no code path was found that closes a distribution program, or invalidates its claim tokens, automatically when `events.status` changes (e.g. to `completed`). Program status and event status are two independent state machines today; nothing links them.
- **Not verified:** the schema for `distribution_programs`, `event_beneficiaries`/households, or entitlement tables  -  no `.sql` migration file in this repository creates tables matching these names (searched all `*.sql` files repo-wide for `distribution_programs`, `event_beneficiaries`, `distribution_entitlements`; none found). These tables are referenced extensively in application code (`distribution/households/route.ts`, `distribution/claim/route.ts`, `distribution/reports/route.ts`) but their DDL is not present in `supabase/migrations/`, meaning they were created outside this migration history and cannot be verified from the repository alone.

---

## 8. Attendance/Check-in Lifecycle

**Verified.** Source: `app/api/events/[eventSlug]/check-in/route.ts`.

- QR check-in path authorizes via a per-station token (`requireEventStation`, imported line 3, invoked ~line 74) rather than a staff session  -  see Section 10.
- Duplicate check-in is explicitly blocked, line 159: `if (attendee.attendance_status === "checked_in")`.
- `event_attendees.attendance_status` is constrained in schema to `('not_checked_in', 'checked_in')` only (core migration, lines 84-85)  -  there is no "voided"/"cancelled" check-in state.
- **Gap:** no code in `check-in/route.ts` or `checkpoint-scan/route.ts` reads or checks `events.status` at all (`check-in/route.ts` line 56 selects only `id, slug, group_label`; `checkpoint-scan/route.ts` line 82 selects only `id, slug`). This means **check-in and checkpoint scanning are currently possible regardless of the parent event's lifecycle status**  -  including on a `draft`, `completed`, or `archived` event, since nothing in these routes checks that field.
- Manual/volunteer check-in: `checkinMethod` supports `qr`, `manual`, `assisted` (schema constraint, core migration line 119) but the "Volunteer Console" specifically named in the Phase 1 contract was not located as a distinct route  -  `help-desk/register` and `help-desk/search` (both under `app/api/events/[eventSlug]/help-desk/`) appear to serve this role; **not verified** whether these are the intended "volunteer console" or a separate, unfound feature.

---

## 9. Raffle Lifecycle

**Verified.** Schema: core migration, `event_raffle_draws` (lines 124-138) and `event_raffle_winners` (lines 140-151).

- Draw status values (check constraint, line 131): `draft`, `rolling`, `winner_selected`, `claimed`, `unclaimed`, `cancelled`.
- Winner status values (check constraint, line 146): `selected`, `claimed`, `unclaimed`, `voided`.
- Draw execution: `app/api/events/[eventSlug]/raffle/draw/route.ts`, gated to `admin` role only (line 34), sets winner status to `selected` (line 187).
- Current/active draw lookup: `app/api/events/[eventSlug]/raffle/current/route.ts` filters winners `.in("status", ["selected", "claimed"])` (line 96) and draws `.in("status", ["rolling", "winner_selected"])` (line 114).
- **Gap:** no code was found in `raffle/draw/route.ts` or `raffle/current/route.ts` that checks `events.status` before allowing a draw to start or a winner to be selected  -  raffle operations are not currently tied to the event lifecycle.
- "Reopening behavior" (per the contract's checklist item)  -  **not verified**; no route or function explicitly named or described as reopening a closed/cancelled draw was found.

---

## 10. Permissions

**Verified**, via `lib/auth/requireStaff.ts` (full file reviewed) and its call sites (listed in Section 5).

- Two staff roles exist platform-wide: `admin` and `dispatcher` (type `StaffRole`, lines 3, 27).
- `requireStaff(allowedRoles)` checks a NextAuth session (`auth()` from `@/auth`) and the signed-in user's `role` field; returns `401 NOT_SIGNED_IN` if no session, `403 FORBIDDEN` if the role isn't in `allowedRoles`.
- Scanner and checkpoint-scan stations use a **separate, non-staff authorization path**: `lib/events/requireEventStation.ts`  -  a per-station bearer token, hashed (SHA-256) and checked against an `event_station_tokens` table (query at lines ~44-52), scoped to `event_id` + `station_type` (`scanner` | `checkpoint` | `projector`) with an `expires_at` and `status = 'active'` check.
- **Not verified:** the `event_station_tokens` table's DDL  -  no migration file in `supabase/migrations/` creates this table (searched repo-wide). Its schema (columns `station_type`, `checkpoint_id`, `status`, `expires_at`, etc.) is only known from the `.select()` call in `requireEventStation.ts`.
- No role or flag distinguishes "organizer" from general platform `admin`/`dispatcher` staff. There is currently no way in code to answer, specifically for events, "who may publish / unpublish / complete / archive / edit a completed event / edit an archived event"  -  because no code performs any of those six actions at all (see Section 2).

---

## 11. Existing Visibility

**Not currently implemented.**

- No `visibility`, `is_public`, `is_unlisted`, or `is_private` column exists on `events` or any related table in any migration.
- The only gate that resembles a visibility control is the `status = 'published'` filter used identically by the public listing (Section 3), public detail page (Section 4), the Event Pass API (`pass/[registrationNumber]/route.ts` line 64), and `group-values/route.ts` (line 18)  -  i.e., "visibility" today is conflated with "status," not a separate concept.

---

## 12. Existing Retention, Cleanup, Archive, or Deletion Behavior

**Not currently implemented.**

- No cron/scheduled job configuration was found: `vercel.json` contains no `crons` entry (checked directly  -  no match for "cron" in the file).
- No code performs `DELETE FROM events` or equivalent, and no `archived_at` / `deleted_at` columns exist on `events` or any `event_*` table (repo-wide search for these column names touching event tables returned no results; the only `archived_at` reference found anywhere in the codebase is in an unrelated driver-workforce analytics route, `app/api/admin/analytics/driver-workforce/route.ts` line 368, not connected to Events).
- All foreign keys from child event tables (`event_settings`, `event_pages`, `event_attendees`, `event_checkins`, `event_raffle_draws`, `event_raffle_winners`, `event_sponsors`, `event_announcements`, `event_gallery`, `event_audit_logs`, `event_group_values`) use `on delete cascade` back to `events.id` (core migration, e.g. lines 23, 43, 62, 75, 103, 114, 126, 142, 155, 166, 180, 192; `event_group_values`, evt003a migration line 11)  -  meaning **if an `events` row were ever manually deleted**, all associated attendee, check-in, raffle, sponsor, announcement, gallery, and audit-log data would cascade-delete with it. No soft-delete mechanism exists at the database level to prevent this.
- Token expiry: `event_station_tokens.expires_at` exists (per Section 10) as a field, but its enforcement/rotation behavior beyond the single check in `requireEventStation.ts` is **not verified** (its issuance/expiry-setting logic in `stations/issue/route.ts` was not inspected in this pass  -  flagged for Phase 2 follow-up if relevant).

---

## 13. Unknown or Unverified Items

- Whether Row-Level Security is enabled on `events` or any `event_*` table, and what policies (if any) exist  -  not present in the migration history in this repository.
- Live/current `events.status` values for any event other than the seeded `dbhs-2026` row.
- DDL for `distribution_programs`, household/beneficiary tables, and distribution entitlement tables  -  referenced extensively in application code but not present in any migration file in this repository.
- DDL for `event_station_tokens`  -  referenced in `lib/events/requireEventStation.ts` and `stations/issue/route.ts` but not present in any migration file in this repository.
- Whether `app/api/events/[eventSlug]/ticket-register/route.ts` enforces event status through some indirect mechanism not discovered in this pass (a targeted search found no direct reference to `events` or `status` in that file, but the file was not read in full line-by-line).
- Whether a distinct "Volunteer Console" (named explicitly in the Phase 1 contract) exists as separate from `help-desk/register` / `help-desk/search`.
- `event_settings.registration_enabled`  -  column exists but no application code reads it; whether it is intended to be read by some component not yet found, or is simply unused, is not verified.
- Raffle "reopening behavior"  -  no matching code found; presence/absence beyond that is not verified.
- `event_station_tokens` issuance/expiry logic in `stations/issue/route.ts` beyond the authorization check already documented in Section 10.

---

## 14. Evidence Matrix

| Area | Status | Evidence |
|---|---|---|
| Events table | Verified | `supabase/migrations/20260703234000_jride_events_core_v1.sql`, lines 3-19 |
| Organizer edit page | Verified (not implemented) | No matches: `app/admin/` (no `events` subfolder); no `app/api/events/[eventSlug]/route.ts` |
| Public listing | Verified | `app/events/page.tsx`, lines 12-16 |
| Event detail | Verified | `app/events/[eventSlug]/page.tsx`, lines 35-42 |
| Registration lifecycle | Verified | `lib/events/registration.ts`, lines 13-22, 161-166 |
| Distribution lifecycle | Verified (partially  -  schema not verified) | `app/api/events/[eventSlug]/distribution/households/route.ts`, lines 510-523; DDL not found in repo |
| Attendance lifecycle | Verified | `app/api/events/[eventSlug]/check-in/route.ts`, lines 56, 159 |
| Raffle lifecycle | Verified | `supabase/migrations/20260703234000_jride_events_core_v1.sql`, lines 124-151; `app/api/events/[eventSlug]/raffle/draw/route.ts`, lines 34, 187 |
| Visibility | Verified (not implemented) | No visibility column in inspected migrations; public access uses `status = 'published'` (see Section 3, Section 4) |
| Retention | Verified (not implemented in repository) | No cron in `vercel.json`; no `archived_at`/`deleted_at` columns on event tables; `on delete cascade` confirmed on all child tables |

---

## Phase Gate

```
PHASE 1 DECISION

[ ] PASS - Proceed to EVT-020 Phase 2
[x] CONDITIONAL PASS - Proceed to Phase 2 design only
[ ] FAIL - Phase 2 blocked

Reason:
Phase 2 design may proceed using the verified repository evidence. All ten required
inspection areas produced evidence-backed findings, and the repository confirms
that events.status already supports all seven desired lifecycle states, that no
separate visibility concept exists (public access is currently conflated with
status = 'published'), that no organizer UI or event-update API exists, and that
no retention/archive automation exists in the repository. These are sufficient to
design: reuse of events.status, a new visibility concept, organizer controls, public
archive behavior, and the lifecycle-enforcement gaps (registration partially
enforces status; ticket-register, check-in, checkpoint-scan, raffle, and distribution
do not).

Implementation affecting RLS, distribution tables, station tokens, or live event
records remains blocked until the outstanding database evidence below is collected.

Outstanding items (block implementation, not design):
- Confirm RLS status and policies (if any) on `events` and all `event_*` tables directly against the live database.
- Obtain or reconstruct DDL for `distribution_programs`, household/beneficiary tables, distribution entitlement tables, and `event_station_tokens` (not present in supabase/migrations/ in this repository).
- Confirm current live `events.status` value(s) for any event(s) beyond the seeded dbhs-2026 row.
- Confirm whether `ticket-register/route.ts` has any indirect event-status enforcement (full line-by-line read not completed in this pass).
- Confirm intended purpose of unused `event_settings.registration_enabled` column.
```

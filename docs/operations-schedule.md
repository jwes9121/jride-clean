# JRide Operations Schedule

Route: `/admin/operations-schedule`. Available from the Control Center directory.

## First use

Employees sign in with their existing approved Google accounts. On their first
visit, each chooses their name from the remaining unclaimed names:

- Marcus: Lagawe + Hingyon
- Kong: Banaue
- Bembol: Lamut

The existing `JRIDE_DISPATCHER_EMAILS` / `DISPATCHER_EMAILS` configuration remains
the authorization source. Each name can be linked to only one account, and each
account can select only once. The selector disappears after saving. Both API
and UI block subsequent identity changes, including the retired Admin setup
action. Admin retains the existing Admin identity and does not choose a name.

September planning is open from September 8, 2026. Dates before launch are
excluded from display, claims and finalization. September has 69 duty slots and
requires seven rest days per employee. The first partial week (September 8-13)
still receives two rest days each. The September 28-October 4 week shares its
records across months. October through December can be opened in advance.

Share the page URL. All three coordinators can
see the same schedule and claim duties under their own identity. Admin can claim
coverage personally or override a duty owner with a reason.

Admin's Coordinator choices overview lists each saved login, selected rest
dates, monthly duty counts, individual duty dates, coverage requests, and open
task counts. Choices refresh with the shared schedule every 15 seconds.

## Schedule rules

- Philippine time (Asia/Manila). Weeks run Monday through Sunday.
- Exactly two rest days per coordinator per week; at most one rest day per date.
- Boundary weeks include dates from adjacent months and share the same records.
- Core Primary and Core Backup: 10 AM to 3 PM, different people.
- Evening Monitor: 3 PM to 7 PM. A Core worker may also cover Evening.
- An employee cannot claim a duty on their rest day.
- More than 24 hours before start, the owner may release a slot. It becomes
  available for another person; the releasing person may grab another for bawi.
- Within 24 hours, release is blocked. A coverage request retains the current
  owner until an eligible replacement accepts. A Core Backup cannot occupy both
  simultaneous roles: Admin must first arrange a replacement Backup.
- Finished duties and past dates cannot be rewritten.
- Admin finalization requires all monthly duties covered, no pending coverage
  requests, and exactly two rest days in every intersecting full week. Changes
  return every affected finalized month to Planning for review.
- Admin override requires a reason and maintains rest and simultaneous-role
  constraints. It never silently removes responsibility.

## Immediate tasks

Admin assigns a title, instructions (including vendor/location), employee and
due date. Personal vendor visit and upcoming vendor profile setup templates are
provided. Open and overdue work remains visible to all coordinators and Admin.
Only the assignee can confirm completion, with a required note. Confirmation
records their account and timestamp. Admin can reopen a completed task with a
reason; previous completion details remain in the audit trail.

## Driver teams

The source is the latest 500 location rows, deduplicated by driver ID, matching
LiveTrips `/api/admin/driver_locations`. Master hidden statuses and explicit
inactive/terminated roster statuses are excluded. Home town comes from
`driver_profiles.municipality`, then `driver_locations.home_town`. Admin randomizes within towns, then balances each town and
total team sizes. Assignments are saved, not reshuffled on every visit. Rebalance
requires a reason and keeps previous mappings in history. Geographic physical
and vendor responsibility stays unchanged.

## Storage and access

Apply the Operations Schedule migration before the page release. The server
uses the existing staff-session gate and service Supabase client. Unmapped
dispatchers cannot access operations data. Browser requests cannot choose their
own staff identity or role. Writes require same-origin JSON.

One shared state row is committed with an expected version under a row lock.
The state and an immutable before/after audit event are saved in the same SQL
transaction. Conflicting edits return HTTP 409. Client polling runs every 15
seconds and on window focus. History supports older pages of 40 events.

RLS is enabled, anon/authenticated privileges are revoked, and the commit RPC is
service-only. The service role has no update/delete permission on audit events.

## Validation

- `node scripts/test-operations-schedule.cjs`: 25 domain tests, including launch
  month finalization and permanent first-login identity selection.
- TypeScript check and production build.
- Real local API with isolated database double: auth/role denial, racing claims,
  retained coverage owner, handoff, rest conflict, Admin checks, audit and Origin.
- Production SQL verified in a rollback transaction: atomic audit, stale-version
  rejection, RLS, denied client access and immutable event permissions. Test
  state was rolled back; no employees, duties or tasks were seeded as real data.
- Browser checks: staff login redirect, schedule views, Admin task form,
  employee completion and note, mobile layout, no browser errors.
- All changed source files are ASCII-only.

## Events

Admin can plan JRide events, training and information drives with audience,
location, date, same-day time, participating coordinators and instructions.
Reserve travel and preparation time too. Events appear in the shared calendar
and Events tab. They do not count as rest days or automatic attendance.
Existing duty/rest assignments remain owned when an event creates a conflict.
Conflicts block finalization; new overlapping duty/rest choices are rejected.
Arrange replacement coverage, stagger attendance or cancel/recreate the event
with different participants/time. Cancellation needs an Admin reason and is
audited. Event changes return affected finalized months to Planning.

## Team exclusions

The confirmed driver identities for Marcus (Macuswilis B. Pugong) and Kong
(Agerico L. Ligeralde) are excluded by stable ID from team membership; their
coordinator accounts remain unchanged. The existing two JRide tester IDs and
explicit test-driver names are excluded. Inactive, deactivated, terminated and
pending records cannot enter a new distribution. Rebalancing replaces the
mapping using only the filtered roster, so old excluded assignments are removed.

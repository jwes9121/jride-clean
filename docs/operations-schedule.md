# JRide Operations Schedule

Route: `/admin/operations-schedule`. Available from the Control Center directory.

## First use

Admin signs in with the existing approved Google account. In Coordinator setup,
link the existing dispatcher accounts to these prefilled names and areas:

- Marcus: Lagawe + Hingyon
- Kong: Banaue
- Bembol: Lamut

The account picker reads the existing `JRIDE_DISPATCHER_EMAILS` / `DISPATCHER_EMAILS`
configuration. This feature does not create new logins or change global staff
authorization. Saved account identities cannot be silently replaced; Admin can
correct display names with an audited reason.

Open next month's planning, then share the page URL. All three coordinators can
see the same schedule and claim duties under their own identity. Admin can claim
coverage personally or override a duty owner with a reason.

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

The source is `drivers` joined to `zones`. This follows the existing dispatch
eligibility rule: active or legacy blank `roster_status`; inactive and terminated
drivers are excluded. Admin randomizes within towns, then balances each town and
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

- `node scripts/test-operations-schedule.cjs`: 22 domain tests.
- TypeScript check and production build.
- Real local API with isolated database double: auth/role denial, racing claims,
  retained coverage owner, handoff, rest conflict, Admin checks, audit and Origin.
- Production SQL verified in a rollback transaction: atomic audit, stale-version
  rejection, RLS, denied client access and immutable event permissions. Test
  state was rolled back; no employees, duties or tasks were seeded as real data.
- Browser checks: staff login redirect, schedule views, Admin task form,
  employee completion and note, mobile layout, no browser errors.
- All changed source files are ASCII-only.

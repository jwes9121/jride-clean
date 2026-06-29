# JRide Development Standard v1.0

Status: Draft
Scope: JRide production codebase, database, finance modules, and operational systems.

## 1. Change Tiers

### Tier 1 - Full Pipeline Required

Applies to:
- finance_* tables
- accounting/posting rules
- wallet or money movement
- BIR reports or exports
- authentication/authorization
- business-unit or partner scope
- database schema changes
- production operational workflows

Required path:
Business Requirement -> Architecture Spec -> Operational Integration Matrix -> Posting Rule -> Migration -> API -> UI -> Testing -> Production.

### Tier 2 - Light Path Allowed

Applies to:
- UI copy
- labels
- non-financial display changes
- read-only report formatting
- documentation cleanup

Required path:
Diff review -> targeted test/build -> commit.

Tier 2 must not touch money movement, permissions, schema, or posting logic.

## 2. Git Rules

- Review git diff before commit.
- Build must be green before merge.
- Do not commit build/cache artifacts such as tsconfig.tsbuildinfo.
- No .bak, .old, backup folders, or manually-versioned filename copies.
- Git history is the only version history.
- One logical change per commit where practical.

## 3. Database Rules

- Every schema change must be a migration.
- One logical feature per migration.
- Verify every migration after execution.
- No direct production edits without documented reason.
- Migrations must be idempotent where practical.
- Rollback or recovery plan must be considered before execution.

## 4. Finance Rules

- Every money-related feature requires an Operational Integration Matrix entry.
- Every finance event requires an idempotency key.
- Every posting rule must balance before activation.
- Every new event type must document failure mode and recovery action.
- Posting rule version is resolved by event effective date, never by processing or posting date.
- Posted journals are immutable.
- Corrections use reversals or adjusting entries.

## 5. Security Rules

- No Finance API route may use the service-role key without authenticated and authorized server-side checks.
- Business-unit, company, partner, and location scope must be enforced at the database/RLS layer where practical.
- UI filters are not security controls.
- Partner access must never rely only on frontend filtering.

## 6. Testing Rules

- Every posting rule requires at least one Posting Rule Tester case before it can move from Draft to Active.
- Financial changes require tests for success path and at least one failure path.
- Build must pass before commit.
- Production-impacting changes require verification commands or logs.

## 7. Documentation Rules

- Every locked architectural decision must be recorded in the decision log.
- Decisions must include date, decision, reason, and impact.
- Architecture changes must update docs before or with implementation.

# JRide Decision Log

Status: Draft

## Decision 001 - Multi-company Finance

Date: 2026-06-30
Decision: Finance Center is multi-company ready from day one.
Reason: JRide may later support vendors, third-party companies, partners, or separate legal entities.
Impact: Finance tables use company_id as a core scope column.

## Decision 002 - Business Scope

Date: 2026-06-30
Decision: Finance scope is company_id -> business_unit_id -> location_id.
Reason: JRide needs reporting by company, partner/business unit, and town/location.
Impact: Partner reports and municipality reports can be generated from the same accounting foundation.

## Decision 003 - Revenue Recognition

Date: 2026-06-30
Decision: Ride revenue is JRide commission only, not gross driver-collected fare.
Reason: Drivers collect gross fare; JRide earns commission/platform fees.
Impact: Posting rules must use commission/service fee amount sources, not gross fare, unless formally revised.

## Decision 004 - Sandbox First

Date: 2026-06-30
Decision: Finance starts with Inbox/Sandbox before auto-posting.
Reason: JRide needs review controls while accounting rules are being validated.
Impact: Events go to review before immutable journals unless auto-posting is explicitly enabled.

## Decision 005 - Posting Rule Versioning

Date: 2026-06-30
Decision: Posting rule version is resolved by event effective date, not processing date.
Reason: Backlogs and retries must not rewrite historical accounting treatment.
Impact: Posting Rule Tester must support as_of_date.

## Decision 006 - Executive Audit

Date: 2026-06-30
Decision: CEO audit visibility is private by default but grantable through can_view_executive_audit.
Reason: Preserve executive control now without creating future governance blind spots.
Impact: Audit records exist and are immutable; visibility is permission-based.

## Decision 007 - No Manual Backup Files

Date: 2026-06-30
Decision: No .bak, .old, or manually-versioned file copies.
Reason: Git history must be the only version history.
Impact: Backup folders and manual copies should not be committed.

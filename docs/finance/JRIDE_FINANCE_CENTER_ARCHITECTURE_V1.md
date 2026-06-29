# JRide Finance Center Architecture v1.0



Status: Draft

Company: JRide Corporation

Purpose: BIR-ready finance, accounting, reporting, and future partner settlement foundation.



## 1. Core Principle



JRide Finance is not just bookkeeping. It is the financial engine of JRide ERP.



Operations create finance events.

Finance events resolve posting rules.

Posting rules create immutable journal entries.

Journal entries feed ledgers, reports, BIR books, dashboards, and partner settlement.



## 2. Locked Decisions



1. Multi-company ready from day one.

2. Every finance record has company_id.

3. Business scope is company_id -> business_unit_id -> location_id.

4. Locations are core master data, not finance-only.

5. Ride revenue is JRide commission only, not gross driver-collected fare.

6. Takeout revenue is JRide commission/service fee only.

7. Posted journals are immutable.

8. Corrections use reversals or adjusting entries.

9. Period status and journal status are separate.

10. Rule version is resolved by event timestamp, not processing timestamp.

11. Posting rules are header + lines.

12. Finance events require idempotency keys.

13. Failed posting runs must be visible in Accounting Health.

14. CEO audit is private by default but grantable through can_view_executive_audit.

15. No Finance API may use service-role access without explicit authentication and authorization.

16. Partners receive scoped settlement reports, not JRide full books.



## 3. Accounting Periods



Period statuses:

- draft

- open

- closing

- closed



Journal statuses:

- draft

- posted

- reversed

- voided



## 4. Finance Health



Blocking checks:

- unbalanced journals

- failed posting runs

- orphan finance events

- missing posting rule

- period close errors



Advisory checks:

- missing attachments

- founder entries pending review

- assets missing useful life

- tax treatment pending accountant review



Period closing and BIR book export must be blocked if blocking checks fail.



## 5. Operational Integration Matrix



| Business Event | Finance Event | Idempotency Key | Posting Rule | Failure Mode | Recovery Action | Severity |

|---|---|---|---|---|---|---|

| Ride completed | RIDE_COMPLETED | booking_id | Ride Commission v1 | no rule / invalid amount / wallet negative | fail event, log posting run, manual review | critical |

| Takeout completed | TAKEOUT_COMPLETED | order_id | Takeout Commission v1 | vendor missing / invalid amount | fail event, ops review | critical |

| Founder pays Starlink | FOUNDER_EXPENSE | contribution_id | Founder Expense v1 | missing document | post but mark unsubstantiated | advisory |

| Asset acquired | ASSET_ACQUIRED | asset_event_id | Asset Acquisition v1 | no useful life / no rule | fail or advisory depending field | critical/advisory |

| Manual expense | MANUAL_EXPENSE | expense_id | Expense v1 | missing account / invalid amount | fail event, manual review | critical |



## 6. Partner Reporting



Partners are scoped by business_unit_id and/or location_id.



Reports:

- Partner Settlement Report

- Revenue Share Report

- Outstanding Balance Report

- Scoped Income Summary



Partners must never receive company-wide JRide books unless explicitly authorized.



## 7. Future Modules



Reserved only:

- Payroll

- Inventory

- Procurement

- CRM

- AI

- Business Intelligence


## 8. Finance Sandbox / Inbox

Finance starts with Inbox, not Dashboard.

All money-related items enter the Finance Inbox first:
- ride events
- takeout events
- manual expenses
- founder expenses
- asset events
- refunds
- wallet deductions
- future payroll/inventory events

Nothing becomes a posted journal until approved or auto-posting is explicitly enabled.

### Sandbox Approval Rules

- triggered_by, created_by, and approved_by are separate fields.
- approved_by is recorded even if the same person created the item.
- high-risk self-approval is allowed during startup but flagged.
- rejected items never disappear; they move to the Exception Queue.
- replay must not double-post if a successful posting run already exists.
- replay after success requires explicit reverse-and-replay.
- period close is blocked if pending sandbox items exist inside the period.

### Finance Inbox Statuses

- pending
- needs_review
- approved
- rejected
- posted
- failed
- archived

## 9. Accounting Health

Accounting Health has two layers.

### Blocking Checks

These block period close and BIR export:
- failed posting runs
- unbalanced journals
- pending sandbox items inside the period
- orphan finance events
- missing posting rules
- closed-period violations

### Advisory Checks

These do not block close but remain visible:
- missing receipts
- founder entries pending review
- assets missing useful life
- tax treatment pending accountant review

## 10. Sprint 1 Scope

Sprint 1 includes:
- Finance Inbox / Sandbox
- Manual Expense Entry
- Posting Rule Tester with as_of_date
- Posting Run Monitor
- Accounting Health blocking checks
- Feature Flags scoped by company_id

Dashboard comes later.

## 11. Finance Feature Flags

Feature flags must be company-scoped.

Examples:
- ride_auto_posting
- takeout_auto_posting
- founder_auto_posting
- asset_auto_posting
- bir_export_enabled
- partner_settlement_enabled

Default for JRide v1:
- all posting goes through Sandbox unless explicitly enabled.

## 12. Lifecycle Rules

Every finance object must have a lifecycle.

Finance Event:
pending -> processing -> sandbox -> approved/rejected -> posted -> archived

Document:
uploaded -> linked -> reviewed -> archived

Asset:
draft -> active -> depreciating -> disposed -> archived

Founder Contribution:
draft -> reviewed -> posted -> closed

## 13. Database Change Policy

After Finance Foundation, all database changes must be:
- stored as versioned migration files in the repo
- reviewed before execution
- scoped to one logical feature
- verified after execution
- tied to the Architecture Spec or Operational Integration Matrix

## 14. Revenue Recognition Policy

JRide recognizes revenue based on the company's earned commission and platform/service fees, not the full fare collected by drivers, unless the underlying business model changes and the policy is formally revised.

Revenue recognition rules are version-controlled and documented.

Historical transactions continue to use the revenue policy and posting rule version effective at the event timestamp.

## 15. Operational Integration Policy

No feature affecting money may be merged into JRide unless:

- an Operational Integration Matrix entry exists
- a Posting Rule exists or the feature is explicitly documented as non-financial
- failure modes and recovery actions are documented
- idempotency key is defined
- Accounting Health impact is known

## 16. Architecture Freeze Policy

The Finance database foundation is considered frozen after v1.0.

Future changes should prefer:

- new configuration
- new posting rules
- new workflows

over introducing new top-level tables.

New top-level entities require architecture review and documented justification.


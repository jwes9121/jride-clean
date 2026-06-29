# JRide Finance Inbox UI Specification v1.0

Status: Draft
File: docs/finance/FINANCE_INBOX_UI_SPEC.md

## 1. Purpose

The Finance Inbox is the first user-facing Finance module.

It is the review and approval workspace for all money-related finance events before they become immutable posted journal entries.

Visible navigation:

Finance > Inbox

Implementation may use generic internal naming such as approval_queue or action_items, but visible UI remains Finance Inbox until another module needs a shared Action Center.

## 2. Core Rule

Nothing becomes a posted journal until approved through the Finance Inbox, unless auto-posting is explicitly enabled by company-scoped feature flag.

## 3. Status Rules

Pending:
- no warnings
- awaiting routine approval

Needs Review:
- one or more warnings
- individual review required

Approved:
- approved by authorized user
- awaiting posting or already posted

Rejected:
- rejected with required reason
- remains visible in Exception Queue

Failed:
- posting failed
- requires intervention

Posted:
- immutable journal exists

Archived:
- historical only

## 4. Warning Rules

Warning types:
- Founder Self Approval
- Missing Receipt
- Missing Tax Treatment
- Missing Posting Rule
- Wallet Negative
- Duplicate Event
- Amount Mismatch
- Missing Asset Life

Warnings are queryable and stored.

Founder Self Approval is advisory during startup, not blocking, but must be logged distinctly.

## 5. Grid Columns

- Selection
- Status
- Warning
- Business Event
- Finance Event
- Business Unit
- Location
- Amount
- Posting Rule
- Rule Version
- Created At
- Created By
- Approved By
- Source Module
- Action

## 6. Review Panel

Selecting a row opens:
- Business Event
- Source Record
- Finance Event
- Posting Rule
- Rule Version
- Business Unit
- Location
- Amount
- Warnings
- Source Documents
- Proposed Journal
- Posting History

## 7. Proposed Journal

Shows:
- debit accounts
- credit accounts
- balanced indicator
- rule version
- amount sources

## 8. Actions

Allowed actions:
- Approve
- Reject
- Replay
- Reprocess With Current Rules
- View Source
- Posting History
- Open Documents

## 9. Approval Rules

triggered_by, created_by, and approved_by are separate facts.

approved_by must be recorded even when the same user created the item.

High-risk self-approval is allowed during startup but flagged.

## 10. Reject Rules

Reject requires reason.

Reject reason options:
- Incorrect Amount
- Wrong Rule
- Duplicate Event
- Missing Information
- Other

If Other is selected, free-text explanation is required.

Rejected events remain visible in the Exception Queue.

## 11. Replay Rules

Replay checks for existing successful posting.

If a successful posting run already exists, Replay is blocked.

Replay uses the original event effective date to resolve the posting rule version.

Reprocess With Current Rules is a separate logged action.

Replay must never silently double-post.

## 12. Bulk Approval

Bulk approval is allowed only when all selected rows have:
- no warnings
- no failed posting runs
- no missing posting rule
- no duplicate successful posting
- no wallet-negative warning

Rows with warnings require individual review.

## 13. Posting History

Posting History shows every finance_posting_runs row tied to the finance event.

Columns:
- Attempt
- Rule Version
- Status
- Failure Code
- Retry Count
- Started
- Finished
- Journal
- User

## 14. Search

Search supports:
- booking code
- ride
- takeout
- founder
- expense
- asset
- wallet
- partner
- amount
- date

## 15. Filters

Filters:
- status
- business unit
- location
- source module
- posting rule
- created by
- approved by
- date range
- warning type

## 16. Security

RLS is required.

Business-unit scope must be enforced in SQL.

Partner scope must be enforced in SQL.

Frontend filtering is not a security control.

## 17. Performance

Default page size: 50 rows.

Use server pagination.

Infinite scrolling is deferred.

## 18. Blocking Rules

Period close and BIR export are blocked when:
- pending sandbox items exist inside the period
- failed posting runs exist
- unbalanced journals exist
- missing posting rules exist
- orphan finance events exist

## 19. Advisory Rules

These do not block period closing:
- missing receipts
- missing tax treatment
- founder self approval
- missing asset useful life

## 20. Empty States

Required empty states:
- No Pending Items
- No Failed Items
- No Search Results
- No Permission

## 21. Future Extension

The implementation should allow future reuse by Operations, Compliance, and Executive approval queues without changing the visible Finance Inbox navigation.

The visible Action Center navigation is deferred until at least one non-finance approval workflow exists.

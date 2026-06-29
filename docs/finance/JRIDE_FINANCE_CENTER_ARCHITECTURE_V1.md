\# JRide Finance Center Architecture v1.0



Status: Draft

Company: JRide Corporation

Purpose: BIR-ready finance, accounting, reporting, and future partner settlement foundation.



\## 1. Core Principle



JRide Finance is not just bookkeeping. It is the financial engine of JRide ERP.



Operations create finance events.

Finance events resolve posting rules.

Posting rules create immutable journal entries.

Journal entries feed ledgers, reports, BIR books, dashboards, and partner settlement.



\## 2. Locked Decisions



1\. Multi-company ready from day one.

2\. Every finance record has company\_id.

3\. Business scope is company\_id -> business\_unit\_id -> location\_id.

4\. Locations are core master data, not finance-only.

5\. Ride revenue is JRide commission only, not gross driver-collected fare.

6\. Takeout revenue is JRide commission/service fee only.

7\. Posted journals are immutable.

8\. Corrections use reversals or adjusting entries.

9\. Period status and journal status are separate.

10\. Rule version is resolved by event timestamp, not processing timestamp.

11\. Posting rules are header + lines.

12\. Finance events require idempotency keys.

13\. Failed posting runs must be visible in Accounting Health.

14\. CEO audit is private by default but grantable through can\_view\_executive\_audit.

15\. No Finance API may use service-role access without explicit authentication and authorization.

16\. Partners receive scoped settlement reports, not JRide full books.



\## 3. Accounting Periods



Period statuses:

\- draft

\- open

\- closing

\- closed



Journal statuses:

\- draft

\- posted

\- reversed

\- voided



\## 4. Finance Health



Blocking checks:

\- unbalanced journals

\- failed posting runs

\- orphan finance events

\- missing posting rule

\- period close errors



Advisory checks:

\- missing attachments

\- founder entries pending review

\- assets missing useful life

\- tax treatment pending accountant review



Period closing and BIR book export must be blocked if blocking checks fail.



\## 5. Operational Integration Matrix



| Business Event | Finance Event | Idempotency Key | Posting Rule | Failure Mode | Recovery Action | Severity |

|---|---|---|---|---|---|---|

| Ride completed | RIDE\_COMPLETED | booking\_id | Ride Commission v1 | no rule / invalid amount / wallet negative | fail event, log posting run, manual review | critical |

| Takeout completed | TAKEOUT\_COMPLETED | order\_id | Takeout Commission v1 | vendor missing / invalid amount | fail event, ops review | critical |

| Founder pays Starlink | FOUNDER\_EXPENSE | contribution\_id | Founder Expense v1 | missing document | post but mark unsubstantiated | advisory |

| Asset acquired | ASSET\_ACQUIRED | asset\_event\_id | Asset Acquisition v1 | no useful life / no rule | fail or advisory depending field | critical/advisory |

| Manual expense | MANUAL\_EXPENSE | expense\_id | Expense v1 | missing account / invalid amount | fail event, manual review | critical |



\## 6. Partner Reporting



Partners are scoped by business\_unit\_id and/or location\_id.



Reports:

\- Partner Settlement Report

\- Revenue Share Report

\- Outstanding Balance Report

\- Scoped Income Summary



Partners must never receive company-wide JRide books unless explicitly authorized.



\## 7. Future Modules



Reserved only:

\- Payroll

\- Inventory

\- Procurement

\- CRM

\- AI

\- Business Intelligence


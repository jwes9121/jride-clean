# JRide Events Platform Architecture

Status: Active
Product: JRide Events Platform (JEP)
Parent Company: JRide Corporation

## Core Principles

- JRide Events is event-agnostic.
- No event-specific logic should be hardcoded in React components.
- Event behavior should be driven by database configuration.
- Every attendee has three identities:
  - UUID: internal database identity
  - Registration Number: human/help desk identity
  - QR Token: secure validation credential
- Event registration must not require a JRide account.
- JRide account creation is optional and should happen only after successful event registration.

## Core Tables

- events
- event_pages
- event_settings
- event_group_values
- event_attendee_types
- event_attendees
- event_guest_links
- event_checkins
- event_raffle_draws
- event_raffle_winners
- event_gallery
- event_sponsors
- event_announcements
- event_audit_logs

## Engine Modules

- lib/events/types.ts
- lib/events/validation.ts
- lib/events/registration-number.ts
- lib/events/identity-resolution.ts
- lib/events/event-pass.ts
- lib/events/registration.ts

## Route Isolation

JRide Events must stay inside:

- /events
- /api/events
- /admin/events

It must not touch Mobility, Takeout, Dispatch, Wallet, or Finance routes unless explicitly scoped.

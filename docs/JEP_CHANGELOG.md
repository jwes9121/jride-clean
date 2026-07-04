# JRide Events Platform Changelog

## EVT-001 - Public Events Foundation

Added public /events and /events/[eventSlug] routes. Established the first public surface of JRide Events.

## EVT-002 - Dynamic Event Homepage

Improved event homepage to render from events and event_pages. Added event date, venue, countdown, and placeholder action cards.

## EVT-003 - Registration Engine

Added reusable registration engine under lib/events. Implemented validation, identity resolution, registration numbering, event pass generation, and thin registration API.

## EVT-003A - Event Group Values and Event-Scoped APIs

Added event_group_values table and seeded DBHS batch dropdown values. Moved APIs under /api/events/{slug}/... for event-scoped routing.

## EVT-004A1 - Event Pass Lookup API

Added token-protected Event Pass lookup API using registrationNumber plus qrToken.

## EVT-004A2 - Event Pass Page

Added premium credential-style Event Pass page with noindex/nofollow, status badge, initials avatar, guest list, print styling, and secure token requirement.

## EVT-004B - Registration UI

Added mobile-first event registration page with full name, mobile number, dynamic group dropdown, nickname, optional guests, validation, duplicate prompt, and redirect to Event Pass.

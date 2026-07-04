# JRide Events Platform API

## Public Routes

GET /api/events/{slug}/group-values
- Purpose: Returns active dropdown values for registration.
- Auth: Public

POST /api/events/{slug}/register
- Purpose: Registers attendee and optional guests.
- Auth: Public
- Returns:
  - attendeeId
  - registrationNumber
  - qrToken
  - eventPassUrl

GET /api/events/{slug}/pass/{registrationNumber}?token={qrToken}
- Purpose: Loads token-protected Event Pass data.
- Auth: Public but token-protected
- Security: registrationNumber alone must not expose attendee data.

## Future Protected Routes

POST /api/events/{slug}/check-in
- Auth: Scanner role

GET /api/events/{slug}/attendees
- Auth: Staff role

POST /api/events/{slug}/attendees/{id}/merge
- Auth: Admin role

POST /api/events/{slug}/raffle/draw
- Auth: MC role

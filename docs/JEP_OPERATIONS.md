# JRide Events Platform Operations

## Deployment Rules

- Build must be green before commit.
- Commit must be feature-scoped.
- Do not mix docs, schema, API, and UI unless required by one feature.
- Run git status before and after commits.

## Production Safety

- Events must not affect Mobility, Takeout, Dispatch, Wallet, or Finance.
- Public attendee pass pages must use noindex, nofollow.
- Event Pass lookup requires registrationNumber plus qrToken.

## Event Day Priorities

1. Scanner stability
2. Offline scanner cache and sync
3. Help Desk recovery
4. Live attendance dashboard
5. Raffle operation

## Validation Checklist

- Normal registration
- Same mobile registration
- Same name and batch
- Slight misspelling
- Guest add/remove
- Slow 3G submit
- Double-click Register
- Pass without token
- Pass wrong token
- Print preview

# JRide Canonical Backend Route Map

```text
app/
└── api/
    ├── admin/
    │   └── livetrips/
    │       └── page-data/
    │           └── route.ts
    │              ROLE: LiveTrips read aggregator only
    │
    ├── dispatch/
    │   ├── assign/
    │   │   └── route.ts
    │   │      ROLE: assignment only
    │   └── status/
    │       └── route.ts
    │          ROLE: lifecycle only
    │
    ├── driver/
    │   └── fare/
    │       └── propose/
    │           └── route.ts
    │              ROLE: fare proposal only
    │
    ├── rides/
    │   └── fare-response/
    │       └── route.ts
    │          ROLE: passenger accept / reject only
    │
    ├── public/
    │   └── passenger/
    │       └── booking/
    │           └── route.ts
    │              ROLE: canonical passenger booking read only
    │
    └── passenger/
        └── track/
            └── route.ts
               ROLE: tracking enrichment only or future deprecation target
```

## Compatibility wrappers retained

These routes remain in place so existing callers keep working, but they now forward to the canonical fare proposal route:

- `app/api/driver/fare-offer/route.ts`
- `app/api/dispatch/fare/offer/route.ts`
- `app/api/rides/fare/route.ts`

## Debugging chain

```text
Action taken
→ exact route called
→ exact DB fields changed
→ exact next status expected
→ exact UI screen consuming that result
```

# JRIDE PROD SMOKETEST

Generated: 2026-02-07 20:58:04
Base: https://app.jride.net

## Pass 1

| Check | OK | HTTP | ms | URL | Note |
| --- | --- | ---: | ---: | --- | --- |
| Site root | âœ… | 200 | 2266 | "https://app.jride.net/" |  |
| Ride page | âœ… | 200 | 117 | "https://app.jride.net/ride" |  |
| Passenger booking poll (no code) | âŒ | 400 | 630 | "https://app.jride.net/api/public/passenger/booking" | The remote server returned an error: (400) Bad Request. |
| Dispatch status (no params) | âŒ | 404 | 329 | "https://app.jride.net/api/dispatch/status" | The remote server returned an error: (404) Not Found. |
| Dispatch assign (no body) | âŒ | 405 | 626 | "https://app.jride.net/api/dispatch/assign" | The remote server returned an error: (405) Method Not Allowed. |
| Auth session | âœ… | 200 | 621 | "https://app.jride.net/api/auth/session" |  |

## Pass 2

| Check | OK | HTTP | ms | URL | Note |
| --- | --- | ---: | ---: | --- | --- |
| Site root (pass2) | âœ… | 200 | 372 | "https://app.jride.net/" |  |
| Ride page (pass2) | âœ… | 200 | 103 | "https://app.jride.net/ride" |  |
| Passenger booking poll (no code) (pass2) | âŒ | 400 | 317 | "https://app.jride.net/api/public/passenger/booking" | The remote server returned an error: (400) Bad Request. |
| Dispatch status (no params) (pass2) | âŒ | 404 | 296 | "https://app.jride.net/api/dispatch/status" | The remote server returned an error: (404) Not Found. |
| Dispatch assign (no body) (pass2) | âŒ | 405 | 314 | "https://app.jride.net/api/dispatch/assign" | The remote server returned an error: (405) Method Not Allowed. |
| Auth session (pass2) | âœ… | 200 | 408 | "https://app.jride.net/api/auth/session" |  |

## Summary

- âš ï¸ Some checks failed. Review the tables above.
- Tip: 401/403 can be normal for protected endpoints; 429/5xx indicates limits/errors.



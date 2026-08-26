# Failed Ticket Analytics V1

The Analytics V3 failed-ticket panel includes Ride and Takeout terminal failures.

Filters:

- Today
- This week
- This month
- Last 7, 30, 90, or 365 days
- Ride and Takeout, Ride only, or Takeout only
- Town
- Booking, passenger, driver, vendor, outcome, or reason search

Time quality is explicit:

- Exact: JRide captured a dedicated event timestamp.
- Derived: JRide calculated an expected vendor response deadline from order placement and the stored timeout rule.
- Recorded: the row has no dedicated event timestamp, so the last recorded update time is shown without claiming it is exact.

Dummy/test passengers, the test vendor, and explicitly excluded bookings are not counted.

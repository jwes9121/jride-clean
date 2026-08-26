# Timeout Timestamp Repair V1

## Defect

Several historical Takeout timeout rows displayed a later database-maintenance timestamp as the exact missed-order time. The timestamp could be hours or days after the order even though the stored reason said the vendor response window was five minutes.

## Repair

- Original invalid timestamp values are preserved in `booking_timestamp_repair_audit`.
- Historical timeout timestamps more than 30 minutes after order placement are cleared instead of being presented as exact facts.
- The legacy trigger that stamped `now()` onto old timeout rows is removed.
- The transition-aware timeout trigger remains authoritative for new orders.
- Old rows without an exact timeout event show a clearly labelled expected response deadline derived from order placement plus the stored five- or fifteen-minute historical rule.
- New pending Takeout offers created after the rollout are expired by a one-minute cron sweep once the five-minute vendor response window passes.

## Analytics

Analytics V3 now includes a failed/expired ticket report for both Ride and Takeout. Ride cancellation records do not invent a reason or exact event time when production did not capture one.

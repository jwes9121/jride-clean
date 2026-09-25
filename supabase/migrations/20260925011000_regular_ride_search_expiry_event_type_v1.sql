-- Allow the expiry authority to record automatic no-driver search closure.

alter table public.booking_lifecycle_events
  drop constraint if exists booking_lifecycle_events_event_type_check;

alter table public.booking_lifecycle_events
  add constraint booking_lifecycle_events_event_type_check
  check (
    event_type = any (
      array[
        'booking_created'::text,
        'driver_assigned'::text,
        'driver_reassigned'::text,
        'assignment_expired'::text,
        'fare_proposed'::text,
        'fare_accepted'::text,
        'fare_rejected'::text,
        'fare_response_expired'::text,
        'search_expired'::text,
        'passenger_cancelled'::text,
        'driver_cancelled'::text,
        'trip_completed'::text,
        'no_show'::text
      ]
    )
  );

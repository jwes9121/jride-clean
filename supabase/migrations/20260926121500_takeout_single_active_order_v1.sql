-- JRIDE_TAKEOUT_SINGLE_ACTIVE_ORDER_V1
-- One passenger may have only one non-terminal Takeout booking at a time.
-- Scope is Takeout only; Ride, Errand, AgriMarket and other services are untouched.
-- API performs a friendly pre-check. This partial unique index closes the race
-- where simultaneous requests could otherwise both pass the API check.

create unique index if not exists ux_bookings_one_active_takeout_passenger_v1
on public.bookings (created_by_user_id)
where service_type = 'takeout'
  and created_by_user_id is not null
  and status not in ('completed', 'cancelled', 'canceled');

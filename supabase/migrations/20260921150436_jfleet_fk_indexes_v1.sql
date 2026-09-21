-- Cover JFleet foreign keys used by owner, driver, booking, and audit lookups.

create index jfleet_addons_itinerary_after_idx
  on public.jfleet_addons(itinerary_id_after)
  where itinerary_id_after is not null;

create index jfleet_bookings_driver_schedule_idx
  on public.jfleet_bookings(assigned_driver_id, scheduled_start_at, scheduled_end_at, status)
  where assigned_driver_id is not null;

create index jfleet_bookings_vehicle_schedule_idx
  on public.jfleet_bookings(assigned_vehicle_id, scheduled_start_at, scheduled_end_at, status)
  where assigned_vehicle_id is not null;

create index jfleet_bookings_current_itinerary_idx
  on public.jfleet_bookings(current_itinerary_id);

create index jfleet_driver_documents_driver_idx
  on public.jfleet_driver_documents(driver_id);

create index jfleet_driver_locations_booking_idx
  on public.jfleet_driver_locations(booking_id)
  where booking_id is not null;

create index jfleet_inquiries_accepted_quote_idx
  on public.jfleet_inquiries(accepted_quote_id)
  where accepted_quote_id is not null;

create index jfleet_inquiries_converted_booking_idx
  on public.jfleet_inquiries(converted_booking_id)
  where converted_booking_id is not null;

create index jfleet_partner_documents_partner_idx
  on public.jfleet_partner_documents(partner_id);

create index jfleet_partners_owner_user_idx
  on public.jfleet_partners(owner_user_id)
  where owner_user_id is not null;

create index jfleet_payments_confirmed_owner_idx
  on public.jfleet_payments(confirmed_by_owner_user_id)
  where confirmed_by_owner_user_id is not null;

create index jfleet_quotes_created_owner_idx
  on public.jfleet_quotes(created_by_owner_user_id)
  where created_by_owner_user_id is not null;

create index jfleet_quotes_itinerary_idx
  on public.jfleet_quotes(itinerary_id);

create index jfleet_quotes_partner_idx
  on public.jfleet_quotes(partner_id);

create index jfleet_route_deviation_driver_idx
  on public.jfleet_route_deviation_events(driver_id, detected_at desc);

create index jfleet_route_points_driver_time_idx
  on public.jfleet_route_points(driver_id, captured_at);

create index jfleet_vehicle_documents_vehicle_idx
  on public.jfleet_vehicle_documents(vehicle_id);

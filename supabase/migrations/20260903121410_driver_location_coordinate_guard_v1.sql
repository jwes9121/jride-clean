-- Prevent assignment-capable presence states from carrying missing or sentinel GPS.

update public.driver_locations
set status = 'gps_pending'
where lower(coalesce(status, '')) in ('online', 'available', 'idle', 'waiting', 'on_trip')
  and (
    lat is null
    or lng is null
    or lat < -90
    or lat > 90
    or lng < -180
    or lng > 180
    or (lat = 0 and lng = 0)
  );

alter table public.driver_locations
  drop constraint if exists driver_locations_usable_coords_for_active_status_v1;

alter table public.driver_locations
  add constraint driver_locations_usable_coords_for_active_status_v1
  check (
    lower(coalesce(status, '')) not in ('online', 'available', 'idle', 'waiting', 'on_trip')
    or (
      lat is not null
      and lng is not null
      and lat between -90 and 90
      and lng between -180 and 180
      and not (lat = 0 and lng = 0)
    )
  )
  not valid;

alter table public.driver_locations
  validate constraint driver_locations_usable_coords_for_active_status_v1;

comment on constraint driver_locations_usable_coords_for_active_status_v1
on public.driver_locations is
  'Active/assignable driver presence requires non-null bounded coordinates and rejects JRide missing-GPS sentinel 0/0.';

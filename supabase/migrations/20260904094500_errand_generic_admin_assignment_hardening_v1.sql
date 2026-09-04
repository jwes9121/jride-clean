-- Errand deployment hardening: generic admin/dispatcher mutations can target
-- Errand bookings, so they must be callable only through trusted server paths.

revoke all on function public.admin_assign_driver_by_id_v1(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_assign_driver_by_id_v1(uuid,uuid,text,text)
  to service_role;

revoke all on function public.admin_reassign_driver(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_reassign_driver(uuid,uuid,text,text)
  to service_role;

revoke all on function public.admin_reassign_trip(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.admin_reassign_trip(uuid,uuid,uuid,text)
  to service_role;

revoke all on function public.admin_set_trip_emergency(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_trip_emergency(uuid,boolean)
  to service_role;

revoke all on function public.admin_set_trip_on_the_way(text)
  from public, anon, authenticated;
grant execute on function public.admin_set_trip_on_the_way(text)
  to service_role;

revoke all on function public.admin_set_trip_on_trip(text)
  from public, anon, authenticated;
grant execute on function public.admin_set_trip_on_trip(text)
  to service_role;

revoke all on function public.dispatcher_assign_driver(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.dispatcher_assign_driver(uuid,uuid,text,text)
  to service_role;

revoke all on function public.jride_release_stale_assigned_bookings()
  from public, anon, authenticated;
grant execute on function public.jride_release_stale_assigned_bookings()
  to service_role;

-- Errand deployment hardening: keep wallet mutation helpers server-only.
-- These helpers mutate driver wallet state and must not be callable directly
-- through PostgREST by public, anon, or ordinary authenticated clients.

revoke all on function public.process_booking_wallet_cut(uuid)
  from public, anon, authenticated;
grant execute on function public.process_booking_wallet_cut(uuid)
  to service_role;

revoke all on function public.apply_driver_wallet_deduction(uuid,numeric,text,uuid)
  from public, anon, authenticated;
grant execute on function public.apply_driver_wallet_deduction(uuid,numeric,text,uuid)
  to service_role;

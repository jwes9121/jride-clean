-- Errand deployment hardening: close generic completion and wallet-ledger bypasses.
-- Preserve existing read access while making wallet accounting writes server-only.

revoke insert, update, delete, truncate, references, trigger
  on table public.driver_wallet_transactions
  from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.driver_wallet_ledger
  from anon, authenticated;

-- Generic completion/status mutations must be mediated by trusted server routes.
revoke all on function public.settle_completed_ride_wallet_v2(uuid,text)
  from public, anon, authenticated;
grant execute on function public.settle_completed_ride_wallet_v2(uuid,text)
  to service_role;

revoke all on function public.admin_complete_trip(text)
  from public, anon, authenticated;
grant execute on function public.admin_complete_trip(text)
  to service_role;

revoke all on function public.complete_booking_and_credit_driver(text)
  from public, anon, authenticated;
grant execute on function public.complete_booking_and_credit_driver(text)
  to service_role;

revoke all on function public.admin_finalize_trip_and_credit_wallets(text)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_trip_and_credit_wallets(text)
  to service_role;

revoke all on function public.admin_update_booking_status(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_update_booking_status(jsonb)
  to service_role;

revoke all on function public.dispatcher_update_booking_status(jsonb)
  from public, anon, authenticated;
grant execute on function public.dispatcher_update_booking_status(jsonb)
  to service_role;

revoke all on function public.dispatcher_update_booking_status(uuid,text)
  from public, anon, authenticated;
grant execute on function public.dispatcher_update_booking_status(uuid,text)
  to service_role;

revoke all on function public.dispatcher_update_booking_status_v2(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.dispatcher_update_booking_status_v2(uuid,text,text)
  to service_role;

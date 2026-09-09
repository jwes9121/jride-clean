-- Supabase default privileges may grant ALL to service_role on new tables.
-- Keep these audit records append-only even when those defaults are present.
revoke all on public.operations_shift_outreach from service_role;
grant select,insert on public.operations_shift_outreach to service_role;
revoke update,delete,truncate on public.operations_shift_actions,public.operations_shift_booking_history from service_role;

-- Deploy the accompanying authenticated server routes BEFORE this migration.
-- Passenger data is accessed through JRide APIs, never directly by public clients.
-- No passenger records, sessions, orders, payments, or promo balances are changed.

ALTER TABLE public.passenger_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_addresses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_addresses TO service_role;

ALTER TABLE public.passenger_device_session_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_device_session_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_device_session_events TO service_role;

ALTER TABLE public.passenger_device_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_device_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_device_sessions TO service_role;

ALTER TABLE public.passenger_free_ride_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_free_ride_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_free_ride_audit TO service_role;

ALTER TABLE public.passenger_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_profiles TO service_role;

ALTER TABLE public.passenger_promo_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_promo_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_promo_allowlist TO service_role;

ALTER TABLE public.passenger_promo_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_promo_credits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_promo_credits TO service_role;

ALTER TABLE public.passenger_promo_event_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_promo_event_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_promo_event_log TO service_role;

ALTER TABLE public.passenger_promo_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_promo_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_promo_redemptions TO service_role;

ALTER TABLE public.passenger_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_verifications TO service_role;

ALTER TABLE public.passenger_verification_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.passenger_verification_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.passenger_verification_requests TO service_role;

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_reset_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.password_reset_tokens TO service_role;

DROP POLICY IF EXISTS "Passenger can insert own verification" ON public.passenger_verification_requests;
DROP POLICY IF EXISTS "Passenger can select own verification" ON public.passenger_verification_requests;
DROP POLICY IF EXISTS "Passenger can update own verification" ON public.passenger_verification_requests;
DROP POLICY IF EXISTS "vreq_insert_own" ON public.passenger_verification_requests;
DROP POLICY IF EXISTS "vreq_select_own" ON public.passenger_verification_requests;
DROP POLICY IF EXISTS "vreq_update_own" ON public.passenger_verification_requests;

ALTER VIEW public.admin_free_ride_summary_v1 SET (security_invoker = true);
REVOKE ALL ON TABLE public.admin_free_ride_summary_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_free_ride_summary_v1 TO service_role;

ALTER VIEW public.v_jride_android_first_ride_audit SET (security_invoker = true);
REVOKE ALL ON TABLE public.v_jride_android_first_ride_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_jride_android_first_ride_audit TO service_role;

ALTER VIEW public.v_passenger_active_device_sessions SET (security_invoker = true);
REVOKE ALL ON TABLE public.v_passenger_active_device_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_passenger_active_device_sessions TO service_role;

REVOKE ALL ON FUNCTION public.admin_approve_passenger(bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_passenger(bigint,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_reject_passenger(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_passenger(bigint,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.dispatcher_preapprove_passenger(bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_preapprove_passenger(bigint,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.jride_passenger_claim_device_session(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_passenger_claim_device_session(uuid,text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_passenger_revoke_all_sessions(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_passenger_revoke_all_sessions(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_passenger_sign_out_device(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_passenger_sign_out_device(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_passenger_validate_device_session(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_passenger_validate_device_session(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_ensure_android_credit(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_ensure_android_credit(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_expire_stale_reservations(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_expire_stale_reservations(text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_finalize_completed_booking(uuid,numeric,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_finalize_completed_booking(uuid,numeric,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_get_status(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_get_status(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_is_whitelisted(text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_is_whitelisted(text,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_mark_message_seen(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_mark_message_seen(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_release_for_booking(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_release_for_booking(uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.jride_promo_reserve_for_booking(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jride_promo_reserve_for_booking(uuid,text,uuid,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.passenger_request_verification(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.passenger_request_verification(uuid,text,text,text,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.promo_try_use_free_ride(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promo_try_use_free_ride(uuid,uuid,uuid) TO service_role;

-- Fail atomically if a role inheritance or unexpected grant leaves access open.
DO $verify$
DECLARE target text; role_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.passenger_addresses','public.passenger_device_session_events','public.passenger_device_sessions','public.passenger_free_ride_audit','public.passenger_profiles','public.passenger_promo_allowlist','public.passenger_promo_credits','public.passenger_promo_event_log','public.passenger_promo_redemptions','public.passenger_verifications','public.passenger_verification_requests','public.password_reset_tokens','public.admin_free_ride_summary_v1','public.v_jride_android_first_ride_audit','public.v_passenger_active_device_sessions'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(role_name,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Unexpected public access: % on %',role_name,target;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role',target,'SELECT') THEN
      RAISE EXCEPTION 'Server access missing: %',target;
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['public.admin_approve_passenger(bigint,uuid)','public.admin_reject_passenger(bigint,uuid,text)','public.dispatcher_preapprove_passenger(bigint,uuid)','public.jride_passenger_claim_device_session(uuid,text,text,text,text)','public.jride_passenger_revoke_all_sessions(uuid,text)','public.jride_passenger_sign_out_device(uuid,text)','public.jride_passenger_validate_device_session(uuid,text)','public.jride_promo_ensure_android_credit(uuid,text,text)','public.jride_promo_expire_stale_reservations(text)','public.jride_promo_finalize_completed_booking(uuid,numeric,uuid,text,text)','public.jride_promo_get_status(uuid,text,text)','public.jride_promo_is_whitelisted(text,uuid,text)','public.jride_promo_mark_message_seen(uuid,text,text)','public.jride_promo_release_for_booking(uuid,text,text)','public.jride_promo_reserve_for_booking(uuid,text,uuid,text,text)','public.passenger_request_verification(uuid,text,text,text,text,text,text)','public.promo_try_use_free_ride(uuid,uuid,uuid)'] LOOP
    IF has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
       OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
      RAISE EXCEPTION 'Incorrect private function privileges: %',target;
    END IF;
  END LOOP;
END;
$verify$;
NOTIFY pgrst, 'reload schema';

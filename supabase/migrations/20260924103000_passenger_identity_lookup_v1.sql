-- Canonical staff-only read model. Requests are authoritative when present:
-- the production trigger mirrors their status/name into passenger_verifications.
-- No passenger data, approval status, or booking behavior is rewritten.
CREATE VIEW public.passenger_identity_v1
WITH (security_barrier = true)
AS
WITH ids AS (
  SELECT user_id FROM public.passenger_profiles
  UNION SELECT passenger_id FROM public.passenger_verification_requests
  UNION SELECT user_id FROM public.passenger_verifications
), identity AS (
  SELECT ids.user_id,
    COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(u.raw_user_meta_data->>'full_name'), '')) AS display_name,
    CASE WHEN r.passenger_id IS NOT NULL THEN
      CASE WHEN r.status = 'approved' THEN NULLIF(btrim(r.full_name), '') END
    ELSE CASE WHEN v.status = 'approved_admin' THEN NULLIF(btrim(v.full_name), '') END END AS verified_full_name,
    COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(u.phone), ''), NULLIF(btrim(u.raw_user_meta_data->>'phone'), '')) AS phone,
    COALESCE(NULLIF(btrim(p.town_origin), ''), NULLIF(btrim(u.raw_user_meta_data->>'town_origin'), ''), NULLIF(btrim(r.town), ''), NULLIF(btrim(v.town_origin), '')) AS town,
    COALESCE(NULLIF(btrim(p.barangay_origin), ''), NULLIF(btrim(u.raw_user_meta_data->>'barangay_origin'), ''), NULLIF(btrim(v.barangay_origin), '')) AS barangay,
    u.created_at AS account_created_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.status
      WHEN v.status = 'approved_admin' THEN 'approved'
      WHEN v.status = 'pre_approved_dispatcher' THEN 'pending_admin'
      WHEN v.status = 'pending' THEN 'submitted'
      ELSE COALESCE(v.status, 'not_submitted') END AS verification_status,
    CASE WHEN r.passenger_id IS NOT NULL THEN
      CASE WHEN r.status = 'approved' THEN r.reviewed_at END
    ELSE CASE WHEN v.status = 'approved_admin' THEN v.admin_reviewed_at END END AS verified_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.submitted_at ELSE v.created_at END AS verification_submitted_at,
    CASE WHEN r.passenger_id IS NOT NULL THEN 'passenger_verification_requests'
      WHEN v.user_id IS NOT NULL THEN 'passenger_verifications'
      ELSE NULL END AS verification_source,
    CASE WHEN r.passenger_id IS NOT NULL THEN r.passenger_id::text ELSE v.id::text END AS verification_record_id,
    CASE WHEN r.passenger_id IS NULL THEN NULLIF(btrim(v.id_type), '') END AS id_type,
    CASE WHEN r.passenger_id IS NOT NULL THEN NULLIF(btrim(r.id_front_path), '') IS NOT NULL
      ELSE NULLIF(btrim(v.id_photo_url), '') IS NOT NULL END AS has_id_front,
    r.passenger_id IS NOT NULL AND NULLIF(btrim(r.id_back_path), '') IS NOT NULL AS has_id_back,
    CASE WHEN r.passenger_id IS NOT NULL THEN NULLIF(btrim(r.selfie_with_id_path), '') IS NOT NULL
      ELSE NULLIF(btrim(v.selfie_photo_url), '') IS NOT NULL END AS has_selfie,
    r.passenger_id IS NOT NULL AND v.user_id IS NOT NULL AND (
      v.status IS DISTINCT FROM CASE r.status WHEN 'approved' THEN 'approved_admin'
        WHEN 'submitted' THEN 'pending' WHEN 'pending_admin' THEN 'pre_approved_dispatcher' ELSE r.status END
      OR (r.status = 'approved' AND lower(btrim(r.full_name)) IS DISTINCT FROM lower(btrim(v.full_name)))
    ) AS verification_record_conflict
  FROM ids
  LEFT JOIN public.passenger_profiles p ON p.user_id = ids.user_id
  LEFT JOIN public.passenger_verification_requests r ON r.passenger_id = ids.user_id
  LEFT JOIN public.passenger_verifications v ON v.user_id = ids.user_id
  LEFT JOIN auth.users u ON u.id = ids.user_id
)
SELECT identity.*,
  CASE WHEN display_name IS NULL OR verified_full_name IS NULL THEN NULL
    ELSE lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))
      <> lower(regexp_replace(btrim(verified_full_name), '\s+', ' ', 'g')) END AS identity_name_mismatch
FROM identity;

-- Deliberate owner-executed view: service_role cannot read auth.users directly.
-- Only this safe projection is granted; never grant this view to client roles.
REVOKE ALL ON public.passenger_identity_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.passenger_identity_v1 TO service_role;
COMMENT ON VIEW public.passenger_identity_v1 IS
  'Server-only passenger identity. Display name is editable; verified_full_name is the stored approved submission, not OCR or an independent legal-name assertion. No evidence paths or ID numbers.';

CREATE VIEW public.passenger_recent_activity_v1 WITH (security_invoker = true) AS
SELECT b.created_by_user_id AS user_id, b.id AS activity_id,
  CASE b.service_type WHEN 'takeout' THEN 'Takeout' WHEN 'errand' THEN 'Errand' ELSE 'Ride' END AS service,
  COALESCE(b.booking_code, b.id::text) AS code, b.booking_code AS booking_code,
  b.status, b.created_at, COALESCE(b.updated_at, b.created_at) AS last_activity_at,
  b.from_label AS origin_label, b.to_label AS destination_label, b.cancel_reason
FROM public.bookings b
WHERE b.created_by_user_id IS NOT NULL
  AND b.service_type IN ('motorcycle', 'tricycle', 'ride', 'kolong_kolong', 'takeout', 'errand')
  AND NOT EXISTS (SELECT 1 FROM public.agrimarket_orders a WHERE a.delivery_booking_id = b.id)
UNION ALL
SELECT a.customer_user_id, a.id, 'AgriMarket', a.order_code, b.booking_code,
  a.status, a.created_at, COALESCE(a.updated_at, a.created_at),
  NULL::text, a.delivery_label, a.cancel_reason
FROM public.agrimarket_orders a
LEFT JOIN public.bookings b ON b.id = a.delivery_booking_id;

REVOKE ALL ON public.passenger_recent_activity_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.passenger_recent_activity_v1 TO service_role;

CREATE FUNCTION public.search_passenger_identity_v1(p_query text)
RETURNS SETOF public.passenger_identity_v1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' SET statement_timeout = '5s'
AS $function$
  WITH input AS (
    SELECT lower(btrim(p_query)) AS q,
      regexp_replace(btrim(p_query), '[^0-9]', '', 'g') AS digits
    WHERE char_length(btrim(p_query)) BETWEEN 2 AND 120
  ), normalized AS (
    SELECT q, CASE WHEN digits ~ '^63[0-9]{10}$' THEN substr(digits, 3)
      WHEN digits ~ '^0[0-9]{10}$' THEN substr(digits, 2) ELSE digits END AS phone_query,
      q ~ '^[+0-9() .-]+$' AS is_phone
    FROM input
  )
  SELECT i.*
  FROM public.passenger_identity_v1 i CROSS JOIN normalized n
  WHERE strpos(lower(COALESCE(i.display_name, '')), n.q) > 0
    OR strpos(lower(COALESCE(i.verified_full_name, '')), n.q) > 0
    OR i.user_id::text = n.q
    OR (n.is_phone AND length(n.phone_query) >= 4
      AND strpos(regexp_replace(COALESCE(i.phone, ''), '[^0-9]', '', 'g'), n.phone_query) > 0)
    OR EXISTS (
      SELECT 1 FROM public.passenger_recent_activity_v1 a
      WHERE a.user_id = i.user_id AND (lower(a.code) = n.q OR lower(a.booking_code) = n.q)
    )
  ORDER BY (i.user_id::text = n.q) DESC, lower(i.display_name) NULLS LAST, i.user_id
  LIMIT 26;
$function$;
REVOKE ALL ON FUNCTION public.search_passenger_identity_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_passenger_identity_v1(text) TO service_role;

-- This existing broad policy defeated the private ID bucket. Owner-only
-- policies and server-side uploads remain intact, including both path formats.
DROP POLICY IF EXISTS "passenger-ids read 4l2bp_0" ON storage.objects;

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.passenger_identity_v1', 'SELECT')
    OR has_table_privilege('authenticated', 'public.passenger_identity_v1', 'SELECT')
    OR has_table_privilege('anon', 'public.passenger_recent_activity_v1', 'SELECT')
    OR has_table_privilege('authenticated', 'public.passenger_recent_activity_v1', 'SELECT')
    OR has_function_privilege('anon', 'public.search_passenger_identity_v1(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.search_passenger_identity_v1(text)', 'EXECUTE')
    OR NOT has_table_privilege('service_role', 'public.passenger_identity_v1', 'SELECT')
    OR NOT has_function_privilege('service_role', 'public.search_passenger_identity_v1(text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Passenger identity read permissions are incorrect'; END IF;
END;
$verify$;
NOTIFY pgrst, 'reload schema';

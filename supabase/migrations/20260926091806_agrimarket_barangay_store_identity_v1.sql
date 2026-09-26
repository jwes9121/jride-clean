BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF (
    SELECT md5(p.prosrc)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'agrimarket_farmer_save_profile_v3'
  ) IS DISTINCT FROM '798209889ca9890e44d14859fa72ae01' THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_V3_BASELINE_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producers
    WHERE nullif(trim(coalesce(vendor_name,'')), '') IS NOT NULL
    GROUP BY town, lower(regexp_replace(trim(vendor_name), '[[:space:]]+', ' ', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_DUPLICATE_STORE_NAMES_EXIST';
  END IF;
END;
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS agrimarket_producers_town_vendor_name_ci_uidx
ON public.agrimarket_producers (
  town,
  lower(regexp_replace(trim(vendor_name), '[[:space:]]+', ' ', 'g'))
)
WHERE nullif(trim(coalesce(vendor_name,'')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agrimarket_farmer_profile_conflicts_v1(
  p_producer_id uuid,
  p_town text,
  p_phone_normalized text,
  p_vendor_name text
)
RETURNS TABLE(
  phone_taken boolean,
  vendor_name_taken boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.agrimarket_producers p
      WHERE p.id <> p_producer_id
        AND (
          CASE
            WHEN regexp_replace(coalesce(p.contact_phone,''), '[^0-9]', '', 'g') ~ '^09[0-9]{9}$'
              THEN '+63' || substring(regexp_replace(p.contact_phone, '[^0-9]', '', 'g') from 2)
            WHEN regexp_replace(coalesce(p.contact_phone,''), '[^0-9]', '', 'g') ~ '^9[0-9]{9}$'
              THEN '+63' || regexp_replace(p.contact_phone, '[^0-9]', '', 'g')
            WHEN regexp_replace(coalesce(p.contact_phone,''), '[^0-9]', '', 'g') ~ '^639[0-9]{9}$'
              THEN '+' || regexp_replace(p.contact_phone, '[^0-9]', '', 'g')
            ELSE null
          END
        ) = p_phone_normalized
    )
    OR EXISTS (
      SELECT 1
      FROM public.agrimarket_farmer_applications a
      WHERE a.approved_producer_id IS DISTINCT FROM p_producer_id
        AND a.phone_normalized = p_phone_normalized
        AND a.status IN ('submitted','under_review','correction_requested','approved')
    ) AS phone_taken,
    EXISTS (
      SELECT 1
      FROM public.agrimarket_producers p
      WHERE p.id <> p_producer_id
        AND p.town = p_town
        AND nullif(trim(coalesce(p.vendor_name,'')), '') IS NOT NULL
        AND lower(regexp_replace(trim(p.vendor_name), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(trim(coalesce(p_vendor_name,'')), '[[:space:]]+', ' ', 'g'))
    ) AS vendor_name_taken;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_farmer_profile_conflicts_v1(uuid,text,text,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_profile_conflicts_v1(uuid,text,text,text)
TO service_role;

CREATE OR REPLACE FUNCTION public.agrimarket_farmer_save_profile_v4(
  p_producer_id uuid,
  p_town text,
  p_contact_name text,
  p_phone_display text,
  p_phone_normalized text,
  p_barangay text,
  p_vendor_name text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_motorcycle_accessible boolean,
  p_pickup_tricycle_accessible boolean,
  p_pickup_roadside_handoff_required boolean,
  p_pickup_driver_directions text,
  p_actor text,
  p_confirm_vendor_name boolean DEFAULT false,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  application_id uuid,
  producer_id uuid,
  access_code text,
  accepting_orders boolean,
  profile_completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_name text := regexp_replace(trim(coalesce(p_vendor_name,'')), '[[:space:]]+', ' ', 'g');
  v_result record;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producers p
    WHERE p.id <> p_producer_id
      AND p.town = trim(coalesce(p_town,''))
      AND nullif(trim(coalesce(p.vendor_name,'')), '') IS NOT NULL
      AND lower(regexp_replace(trim(p.vendor_name), '[[:space:]]+', ' ', 'g')) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STORE_NAME_TAKEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO STRICT v_result
  FROM public.agrimarket_farmer_save_profile_v3(
    p_producer_id,
    p_town,
    p_contact_name,
    p_phone_display,
    p_phone_normalized,
    p_barangay,
    v_name,
    p_pickup_label,
    p_pickup_lat,
    p_pickup_lng,
    p_pickup_motorcycle_accessible,
    p_pickup_tricycle_accessible,
    p_pickup_roadside_handoff_required,
    p_pickup_driver_directions,
    p_actor,
    p_confirm_vendor_name,
    p_now
  );

  RETURN QUERY
  SELECT
    v_result.application_id,
    v_result.producer_id,
    v_result.access_code,
    v_result.accepting_orders,
    v_result.profile_completed_at;
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%agrimarket_producers_town_vendor_name_ci_uidx%' THEN
      RAISE EXCEPTION 'AGRIMARKET_STORE_NAME_TAKEN' USING ERRCODE = 'P0001';
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_farmer_save_profile_v4(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_save_profile_v4(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) TO service_role;

COMMENT ON INDEX public.agrimarket_producers_town_vendor_name_ci_uidx IS
  'Prevents duplicate AgriMarket farm/store names within the same municipality, ignoring case and repeated whitespace.';

COMMENT ON FUNCTION public.agrimarket_farmer_save_profile_v4(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) IS
  'Town-aware farmer profile save with same-town normalized store-name uniqueness enforced before confirmation.';

DO $permissions$
DECLARE
  v_check oid := to_regprocedure('public.agrimarket_farmer_profile_conflicts_v1(uuid,text,text,text)')::oid;
  v_save oid := to_regprocedure('public.agrimarket_farmer_save_profile_v4(uuid,text,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,boolean,timestamp with time zone)')::oid;
BEGIN
  IF v_check IS NULL OR v_save IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_IDENTITY_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_check, 'EXECUTE')
     OR has_function_privilege('authenticated', v_check, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_check, 'EXECUTE')
     OR has_function_privilege('anon', v_save, 'EXECUTE')
     OR has_function_privilege('authenticated', v_save, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_save, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_IDENTITY_PRIVILEGES_INVALID';
  END IF;
END;
$permissions$;

COMMIT;

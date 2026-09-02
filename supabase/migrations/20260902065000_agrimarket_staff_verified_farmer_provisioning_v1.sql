-- AGRIMARKET STAFF-VERIFIED FARMER PROVISIONING V1
--
-- Controlled-rollout scope:
--   * public farmer applications may remain disabled;
--   * an authenticated JRide administrator may provision a farmer already
--     verified offline;
--   * the existing AGF access-code + 6-digit PIN credential model is reused;
--   * only a bcrypt PIN hash is persisted; the raw PIN is not written into
--     producer, application, credential-audit, or event details;
--   * provisioning creates a durable staff-attributed audit record.
--
-- Authorization is enforced twice:
--   1. the API route requires requireAgrimarketStaff(true), which is admin-only;
--   2. this RPC is executable only by service_role and requires the route to
--      identify the authorized role as admin for defense in depth.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_producers') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_PRODUCERS_MISSING';
  END IF;

  IF to_regclass('public.agrimarket_producer_credentials') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_CREDENTIALS_MISSING';
  END IF;

  IF to_regclass('public.agrimarket_farmer_applications') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_APPLICATIONS_MISSING';
  END IF;

  IF to_regclass('public.agrimarket_farmer_application_events') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_APPLICATION_EVENTS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_producers'
      AND column_name = 'contact_phone'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_CONTACT_PHONE_MISSING';
  END IF;

  IF to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text)') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_PGCRYPTO_MISSING';
  END IF;
END;
$$;

ALTER TABLE public.agrimarket_farmer_applications
  ADD COLUMN IF NOT EXISTS onboarding_source text NOT NULL DEFAULT 'public_application';

ALTER TABLE public.agrimarket_farmer_applications
  ALTER COLUMN onboarding_source SET DEFAULT 'public_application',
  ALTER COLUMN onboarding_source SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_farmer_applications
    WHERE onboarding_source NOT IN ('public_application', 'staff_verified')
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_UNKNOWN_ONBOARDING_SOURCE_EXISTS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_farmer_applications'::regclass
      AND conname = 'agrimarket_farmer_applications_onboarding_source_chk'
  ) THEN
    ALTER TABLE public.agrimarket_farmer_applications
      ADD CONSTRAINT agrimarket_farmer_applications_onboarding_source_chk
      CHECK (onboarding_source IN ('public_application', 'staff_verified'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.agrimarket_farmer_applications.onboarding_source IS
  'How the farmer entered Agrimarket: public_application or staff_verified. Public onboarding may remain disabled while staff_verified provisioning is available to administrators.';

CREATE OR REPLACE FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  p_application_code text,
  p_access_code text,
  p_pin text,
  p_contact_name text,
  p_phone_display text,
  p_phone_normalized text,
  p_town text,
  p_barangay text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_intended_products text[],
  p_verification_method text,
  p_identity_reference_last4 text,
  p_verification_note text,
  p_provisioned_by text,
  p_provisioned_by_role text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  application_id uuid,
  application_code text,
  producer_id uuid,
  producer_status text,
  accepting_orders boolean,
  access_code text,
  credential_status text,
  onboarding_source text,
  provisioned_by text,
  provisioned_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_application_code text := upper(trim(coalesce(p_application_code, '')));
  v_access_code text := upper(trim(coalesce(p_access_code, '')));
  v_contact_name text := regexp_replace(trim(coalesce(p_contact_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone_display text := trim(coalesce(p_phone_display, ''));
  v_phone_normalized text := trim(coalesce(p_phone_normalized, ''));
  v_phone_digits text;
  v_phone_display_digits text;
  v_town text := trim(coalesce(p_town, ''));
  v_barangay text := nullif(regexp_replace(trim(coalesce(p_barangay, '')), '[[:space:]]+', ' ', 'g'), '');
  v_pickup_label text := regexp_replace(trim(coalesce(p_pickup_label, '')), '[[:space:]]+', ' ', 'g');
  v_products text[];
  v_verification_method text := regexp_replace(trim(coalesce(p_verification_method, '')), '[[:space:]]+', ' ', 'g');
  v_identity_last4 text := nullif(upper(regexp_replace(trim(coalesce(p_identity_reference_last4, '')), '[[:space:]]+', '', 'g')), '');
  v_verification_note text := trim(coalesce(p_verification_note, ''));
  v_actor text := trim(coalesce(p_provisioned_by, ''));
  v_actor_role text := lower(trim(coalesce(p_provisioned_by_role, '')));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_producer_id uuid;
  v_application_id uuid;
BEGIN
  IF v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'AGRIMARKET_ADMIN_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_actor) < 2 OR length(v_actor) > 200 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROVISIONING_ACTOR_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_application_code !~ '^AGSTAFF-[0-9]{8}-[A-F0-9]{8}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_APPLICATION_CODE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_access_code !~ '^AGF-[A-Z0-9]{6,12}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_ACCESS_CODE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_pin, '') !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_PIN_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_contact_name) < 2 OR length(v_contact_name) > 120 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_NAME_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_phone_normalized !~ '^\+639[0-9]{9}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_phone_display = '' THEN
    v_phone_display := v_phone_normalized;
  END IF;

  IF length(v_phone_display) < 10 OR length(v_phone_display) > 30 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_DISPLAY_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  v_phone_digits := regexp_replace(v_phone_normalized, '[^0-9]', '', 'g');
  v_phone_display_digits := regexp_replace(v_phone_display, '[^0-9]', '', 'g');

  IF v_phone_display_digits NOT IN (
    v_phone_digits,
    substring(v_phone_digits FROM 3),
    '0' || substring(v_phone_digits FROM 3)
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_town NOT IN ('Lagawe', 'Hingyon', 'Kiangan', 'Banaue', 'Lamut') THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_barangay IS NOT NULL AND length(v_barangay) > 100 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_pickup_label) < 2 OR length(v_pickup_label) > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lat < -90 OR p_pickup_lat > 90
     OR p_pickup_lng IS NULL OR p_pickup_lng < -180 OR p_pickup_lng > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(clean_product ORDER BY clean_product), '{}'::text[])
  INTO v_products
  FROM (
    SELECT DISTINCT left(
      regexp_replace(trim(item), '[[:space:]]+', ' ', 'g'),
      80
    ) AS clean_product
    FROM unnest(coalesce(p_intended_products, '{}'::text[])) AS source(item)
    WHERE trim(item) <> ''
    ORDER BY clean_product
    LIMIT 20
  ) AS cleaned;

  IF cardinality(v_products) < 1 THEN
    RAISE EXCEPTION 'AGRIMARKET_INTENDED_PRODUCTS_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_verification_method) < 2 OR length(v_verification_method) > 80 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFICATION_METHOD_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_identity_last4 IS NOT NULL AND v_identity_last4 !~ '^[A-Z0-9]{2,4}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_ID_REFERENCE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF length(v_verification_note) < 5 OR length(v_verification_note) > 1000 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFICATION_NOTE_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize provisioning decisions for the canonical mobile number. This
  -- prevents concurrent staff requests from creating duplicate farmers.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('agrimarket_staff_verified:' || v_phone_normalized, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_farmer_applications a
    WHERE a.phone_normalized = v_phone_normalized
      AND a.status IN ('submitted', 'under_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producers p
    WHERE regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g') IN (
      v_phone_digits,
      substring(v_phone_digits FROM 3),
      '0' || substring(v_phone_digits FROM 3)
    )
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_farmer_applications a
    WHERE a.application_code = v_application_code
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_APPLICATION_CODE_COLLISION'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producer_credentials c
    WHERE c.access_code = v_access_code
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_ACCESS_CODE_COLLISION'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.agrimarket_producers(
    vendor_account_id,
    contact_name,
    contact_phone,
    town,
    barangay,
    pickup_label,
    pickup_lat,
    pickup_lng,
    status,
    accepting_orders,
    joining_fee,
    listing_fee,
    marketplace_fee_percent,
    created_at,
    updated_at
  ) VALUES (
    NULL,
    v_contact_name,
    v_phone_display,
    v_town,
    v_barangay,
    v_pickup_label,
    p_pickup_lat,
    p_pickup_lng,
    'active',
    true,
    0,
    0,
    0,
    v_now,
    v_now
  )
  RETURNING id INTO v_producer_id;

  INSERT INTO public.agrimarket_producer_credentials(
    producer_id,
    access_code,
    pin_hash,
    status,
    failed_attempts,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_producer_id,
    v_access_code,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    'active',
    0,
    v_actor,
    v_now,
    v_now
  );

  INSERT INTO public.agrimarket_farmer_applications(
    application_code,
    applicant_name,
    phone_normalized,
    phone_display,
    town,
    barangay,
    pickup_label,
    pickup_lat,
    pickup_lng,
    intended_products,
    identity_type,
    identity_reference_last4,
    applicant_note,
    status,
    review_note,
    reviewed_by,
    reviewed_at,
    approved_producer_id,
    onboarding_source,
    created_at,
    updated_at
  ) VALUES (
    v_application_code,
    v_contact_name,
    v_phone_normalized,
    v_phone_display,
    v_town,
    v_barangay,
    v_pickup_label,
    p_pickup_lat,
    p_pickup_lng,
    v_products,
    v_verification_method,
    v_identity_last4,
    NULL,
    'approved',
    v_verification_note,
    v_actor,
    v_now,
    v_producer_id,
    'staff_verified',
    v_now,
    v_now
  )
  RETURNING id INTO v_application_id;

  INSERT INTO public.agrimarket_farmer_application_events(
    application_id,
    event_type,
    actor_type,
    actor,
    details,
    created_at
  ) VALUES (
    v_application_id,
    'approved',
    'staff',
    v_actor,
    jsonb_build_object(
      'onboarding_source', 'staff_verified',
      'producer_id', v_producer_id,
      'access_code', v_access_code,
      'provisioned_by_role', v_actor_role,
      'verification_method', v_verification_method,
      'identity_reference_last4', v_identity_last4,
      'intended_products', to_jsonb(v_products),
      'pin_visible_once', true,
      'pin_stored_as_hash', true
    ),
    v_now
  );

  RETURN QUERY
  SELECT
    v_application_id,
    v_application_code,
    v_producer_id,
    'active'::text,
    true,
    v_access_code,
    'active'::text,
    'staff_verified'::text,
    v_actor,
    v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,text,text,text,text,double precision,double precision,
  text[],text,text,text,text,text,timestamptz
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,text,text,text,text,double precision,double precision,
  text[],text,text,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,text,text,text,text,double precision,double precision,
  text[],text,text,text,text,text,timestamptz
) IS
  'Patch C admin-only provisioning primitive. Atomically creates a staff-verified producer, bcrypt-hashed AGF credential, approved source-tagged application, and staff audit event. The raw PIN is never persisted.';

DO $$
DECLARE
  v_function oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_farmer_applications'
      AND column_name = 'onboarding_source'
      AND is_nullable = 'NO'
      AND column_default = '''public_application''::text'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_ONBOARDING_SOURCE_COLUMN_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_farmer_applications'::regclass
      AND conname = 'agrimarket_farmer_applications_onboarding_source_chk'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_ONBOARDING_SOURCE_CONSTRAINT_MISSING';
  END IF;

  v_function := to_regprocedure(
    'public.agrimarket_admin_provision_verified_farmer_v1(text,text,text,text,text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,timestamp with time zone)'
  )::oid;

  IF v_function IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PROVISIONING_FUNCTION_MISSING';
  END IF;

  IF has_function_privilege('anon', v_function, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PROVISIONING_FUNCTION_PUBLICLY_EXECUTABLE';
  END IF;

  IF NOT has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PROVISIONING_FUNCTION_SERVICE_ROLE_MISSING';
  END IF;
END;
$$;

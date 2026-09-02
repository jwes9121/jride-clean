-- AGRIMARKET STAFF-VERIFIED FARMER PROVISIONING - ROLLOUT PATCH C V1
--
-- Purpose:
--   Allow a JRide administrator to create an already-verified farmer account
--   while public farmer applications remain disabled.
--
-- Security boundary:
--   - The application route is administrator-only.
--   - This RPC is callable only by service_role.
--   - The six-digit PIN is hashed with pgcrypto bcrypt before storage.
--   - The plaintext PIN is never stored in any table or audit record.
--
-- Audit boundary:
--   Every successful provisioning writes one farmer_provisioned row to
--   agrimarket_producer_access_events, recording the producer, actor, reason,
--   and timestamp without recording the plaintext PIN.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_producers') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_PRODUCERS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_producer_credentials') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_CREDENTIALS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_producer_access_events') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_ACCESS_EVENTS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_farmer_applications') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PRECONDITION_APPLICATIONS_MISSING';
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

ALTER TABLE public.agrimarket_producer_access_events
  DROP CONSTRAINT IF EXISTS agrimarket_producer_access_events_type_chk;

ALTER TABLE public.agrimarket_producer_access_events
  ADD CONSTRAINT agrimarket_producer_access_events_type_chk CHECK (
    event_type IN (
      'farmer_provisioned',
      'pin_reset',
      'access_revoked',
      'farmer_suspended',
      'farmer_reactivated'
    )
  );

CREATE OR REPLACE FUNCTION public.agrimarket_normalize_farmer_phone_v1(
  p_phone text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_digits text := regexp_replace(p_phone, '[^0-9]', '', 'g');
BEGIN
  IF v_digits ~ '^63[0-9]{10}$' THEN
    RETURN '0' || substring(v_digits FROM 3);
  END IF;

  IF v_digits ~ '^9[0-9]{9}$' THEN
    RETURN '0' || v_digits;
  END IF;

  RETURN v_digits;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_normalize_farmer_phone_v1(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_normalize_farmer_phone_v1(text)
  TO service_role;

COMMENT ON FUNCTION public.agrimarket_normalize_farmer_phone_v1(text) IS
  'Patch C internal helper. Canonicalizes farmer phone input for duplicate-account protection.';

CREATE OR REPLACE FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  p_contact_name text,
  p_contact_phone text,
  p_town text,
  p_barangay text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_intended_products text[],
  p_identity_type text,
  p_identity_reference_last4 text,
  p_verification_note text,
  p_access_code text,
  p_pin text,
  p_provisioned_by text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  producer_id uuid,
  access_code text,
  producer_status text,
  accepting_orders boolean,
  provisioned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_name text := trim(coalesce(p_contact_name, ''));
  v_phone text := public.agrimarket_normalize_farmer_phone_v1(p_contact_phone);
  v_town_input text := lower(trim(coalesce(p_town, '')));
  v_town text;
  v_barangay text := nullif(trim(coalesce(p_barangay, '')), '');
  v_pickup_label text := trim(coalesce(p_pickup_label, ''));
  v_identity_type text := nullif(trim(coalesce(p_identity_type, '')), '');
  v_identity_last4 text := nullif(upper(trim(coalesce(p_identity_reference_last4, ''))), '');
  v_verification_note text := trim(coalesce(p_verification_note, ''));
  v_access_code text := upper(trim(coalesce(p_access_code, '')));
  v_actor text := trim(coalesce(p_provisioned_by, ''));
  v_products text[] := '{}'::text[];
  v_existing_producer_id uuid;
  v_existing_application_id uuid;
  v_existing_application_status text;
  v_producer_id uuid;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
BEGIN
  IF length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_NAME_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_phone IS NULL OR v_phone !~ '^[0-9]{10,16}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_town := CASE v_town_input
    WHEN 'aguinaldo' THEN 'Aguinaldo'
    WHEN 'alfonso lista' THEN 'Alfonso Lista'
    WHEN 'asipulo' THEN 'Asipulo'
    WHEN 'banaue' THEN 'Banaue'
    WHEN 'hingyon' THEN 'Hingyon'
    WHEN 'hungduan' THEN 'Hungduan'
    WHEN 'kiangan' THEN 'Kiangan'
    WHEN 'lagawe' THEN 'Lagawe'
    WHEN 'lamut' THEN 'Lamut'
    WHEN 'mayoyao' THEN 'Mayoyao'
    WHEN 'tinoc' THEN 'Tinoc'
    ELSE NULL
  END;

  IF v_town IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_barangay IS NOT NULL AND length(v_barangay) > 160 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_pickup_label) < 2 OR length(v_pickup_label) > 500 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lat < -90 OR p_pickup_lat > 90 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LAT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF p_pickup_lng IS NULL OR p_pickup_lng < -180 OR p_pickup_lng > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LNG_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_identity_type IS NOT NULL AND length(v_identity_type) > 120 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_IDENTITY_TYPE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_identity_last4 IS NOT NULL AND v_identity_last4 !~ '^[A-Z0-9]{2,4}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_IDENTITY_LAST4_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_verification_note) < 5 OR length(v_verification_note) > 1000 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_VERIFICATION_NOTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_access_code !~ '^AGF-[A-Z0-9]{6,12}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_ACCESS_CODE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(p_pin, '') !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_PIN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_actor) < 2 OR length(v_actor) > 320 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROVISIONING_ACTOR_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(product ORDER BY product), '{}'::text[])
  INTO v_products
  FROM (
    SELECT DISTINCT nullif(trim(u.raw_product), '') AS product
    FROM unnest(coalesce(p_intended_products, '{}'::text[])) AS u(raw_product)
  ) cleaned
  WHERE product IS NOT NULL;

  IF cardinality(v_products) > 30
     OR EXISTS (
       SELECT 1
       FROM unnest(v_products) AS p(product)
       WHERE length(p.product) > 120
     ) THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PRODUCTS_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('agrimarket:verified-farmer:' || v_phone, 0)
  );

  SELECT p.id
  INTO v_existing_producer_id
  FROM public.agrimarket_producers p
  WHERE p.contact_phone IS NOT NULL
    AND public.agrimarket_normalize_farmer_phone_v1(p.contact_phone) = v_phone
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_existing_producer_id IS NOT NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_ALREADY_REGISTERED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT a.id, a.status
  INTO v_existing_application_id, v_existing_application_status
  FROM public.agrimarket_farmer_applications a
  WHERE public.agrimarket_normalize_farmer_phone_v1(a.phone_normalized) = v_phone
    AND a.status IN ('submitted', 'under_review', 'approved')
  ORDER BY
    CASE WHEN a.status = 'approved' THEN 0 ELSE 1 END,
    a.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_existing_application_id IS NOT NULL THEN
    IF v_existing_application_status = 'approved' THEN
      RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_ALREADY_REGISTERED'
        USING ERRCODE = 'P0001';
    END IF;

    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_OPEN_APPLICATION_EXISTS'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producer_credentials c
    WHERE c.access_code = v_access_code
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_ACCESS_CODE_ALREADY_EXISTS' USING ERRCODE = 'P0001';
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
    v_name,
    v_phone,
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
    locked_until,
    last_used_at,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_producer_id,
    v_access_code,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    'active',
    0,
    NULL,
    NULL,
    v_actor,
    v_now,
    v_now
  );

  INSERT INTO public.agrimarket_producer_access_events(
    producer_id,
    event_type,
    actor,
    reason,
    details,
    created_at
  ) VALUES (
    v_producer_id,
    'farmer_provisioned',
    v_actor,
    v_verification_note,
    jsonb_build_object(
      'source', 'staff_verified',
      'access_code', v_access_code,
      'phone_last4', right(v_phone, 4),
      'town', v_town,
      'barangay', v_barangay,
      'intended_products', to_jsonb(v_products),
      'identity_type', v_identity_type,
      'identity_reference_last4', v_identity_last4,
      'free_farmer_launch', true
    ),
    v_now
  );

  RETURN QUERY
  SELECT v_producer_id, v_access_code, 'active'::text, true, v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamptz
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_provision_verified_farmer_v1(
  text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamptz
) IS
  'Patch C service-role RPC. Atomically creates one staff-verified farmer, bcrypt credential, and farmer_provisioned audit event. Plaintext PIN is never stored.';

DO $$
DECLARE
  v_event_constraint text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_event_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.agrimarket_producer_access_events'::regclass
    AND c.conname = 'agrimarket_producer_access_events_type_chk';

  IF v_event_constraint IS NULL OR position('farmer_provisioned' IN v_event_constraint) = 0 THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_AUDIT_EVENT_CONSTRAINT_FAILED';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.agrimarket_admin_provision_verified_farmer_v1(text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_SERVICE_ROLE_EXECUTE_MISSING';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.agrimarket_admin_provision_verified_farmer_v1(text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.agrimarket_admin_provision_verified_farmer_v1(text,text,text,text,text,double precision,double precision,text[],text,text,text,text,text,text,timestamp with time zone)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AGRIMARKET_PATCH_C_PUBLIC_EXECUTE_NOT_REVOKED';
  END IF;
END;
$$;

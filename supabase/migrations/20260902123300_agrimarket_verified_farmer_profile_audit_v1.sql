CREATE OR REPLACE FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  p_producer_id uuid,
  p_contact_name text,
  p_phone_display text,
  p_phone_normalized text,
  p_town text,
  p_barangay text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_motorcycle_accessible boolean,
  p_pickup_tricycle_accessible boolean,
  p_pickup_roadside_handoff_required boolean,
  p_pickup_driver_directions text,
  p_resolved_town text,
  p_change_reason text,
  p_actor text,
  p_actor_role text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  producer_id uuid,
  application_id uuid,
  accepting_orders boolean,
  orders_paused boolean,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor text := trim(coalesce(p_actor, ''));
  v_role text := lower(trim(coalesce(p_actor_role, '')));
  v_reason text := trim(coalesce(p_change_reason, ''));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_contact_name text := regexp_replace(trim(coalesce(p_contact_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone_display text := trim(coalesce(p_phone_display, ''));
  v_phone_normalized text := trim(coalesce(p_phone_normalized, ''));
  v_phone_digits text;
  v_phone_display_digits text;
  v_town text := trim(coalesce(p_town, ''));
  v_resolved_town text := trim(coalesce(p_resolved_town, ''));
  v_barangay text := nullif(regexp_replace(trim(coalesce(p_barangay, '')), '[[:space:]]+', ' ', 'g'), '');
  v_pickup_label text := regexp_replace(trim(coalesce(p_pickup_label, '')), '[[:space:]]+', ' ', 'g');
  v_pickup_directions text := trim(coalesce(p_pickup_driver_directions, ''));
  v_producer public.agrimarket_producers%rowtype;
  v_application public.agrimarket_farmer_applications%rowtype;
  v_location_or_access_changed boolean := false;
  v_orders_paused boolean := false;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'AGRIMARKET_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_producer_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_actor) < 2 OR length(v_actor) > 200 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_ACTOR_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_reason) < 5 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_CHANGE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_contact_name) < 2 OR length(v_contact_name) > 120 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_NAME_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_phone_normalized !~ '^\+639[0-9]{9}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_phone_display = '' THEN
    v_phone_display := v_phone_normalized;
  END IF;
  IF length(v_phone_display) < 10 OR length(v_phone_display) > 30 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_DISPLAY_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_phone_digits := regexp_replace(v_phone_normalized, '[^0-9]', '', 'g');
  v_phone_display_digits := regexp_replace(v_phone_display, '[^0-9]', '', 'g');
  IF v_phone_display_digits NOT IN (
    v_phone_digits,
    substring(v_phone_digits FROM 3),
    '0' || substring(v_phone_digits FROM 3)
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_town NOT IN ('Lagawe', 'Hingyon', 'Kiangan', 'Banaue', 'Lamut') THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_resolved_town <> v_town THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_TOWN_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_barangay IS NOT NULL AND length(v_barangay) > 100 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_pickup_label) < 2 OR length(v_pickup_label) > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lat < -90 OR p_pickup_lat > 90
     OR p_pickup_lng IS NULL OR p_pickup_lng < -180 OR p_pickup_lng > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF NOT coalesce(p_pickup_motorcycle_accessible, false)
     AND NOT coalesce(p_pickup_tricycle_accessible, false)
     AND NOT coalesce(p_pickup_roadside_handoff_required, false) THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_ACCESS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_pickup_directions) < 5 OR length(v_pickup_directions) > 1000 THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_producer
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id
  FOR UPDATE;

  IF v_producer.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.* INTO v_application
  FROM public.agrimarket_farmer_applications a
  WHERE a.approved_producer_id = p_producer_id
    AND a.onboarding_source = 'staff_verified'
    AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_application.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_VERIFIED_APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('agrimarket_staff_verified:' || v_phone_normalized, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_farmer_applications a
    WHERE a.id <> v_application.id
      AND a.phone_normalized = v_phone_normalized
      AND a.status IN ('submitted', 'under_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producers p
    WHERE p.id <> p_producer_id
      AND regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g') IN (
        v_phone_digits,
        substring(v_phone_digits FROM 3),
        '0' || substring(v_phone_digits FROM 3)
      )
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  v_location_or_access_changed :=
    v_producer.town IS DISTINCT FROM v_town
    OR coalesce(v_producer.barangay, '') IS DISTINCT FROM coalesce(v_barangay, '')
    OR v_producer.pickup_label IS DISTINCT FROM v_pickup_label
    OR v_producer.pickup_lat IS DISTINCT FROM p_pickup_lat
    OR v_producer.pickup_lng IS DISTINCT FROM p_pickup_lng
    OR coalesce(v_producer.pickup_motorcycle_accessible, false) IS DISTINCT FROM coalesce(p_pickup_motorcycle_accessible, false)
    OR coalesce(v_producer.pickup_tricycle_accessible, false) IS DISTINCT FROM coalesce(p_pickup_tricycle_accessible, false)
    OR coalesce(v_producer.pickup_roadside_handoff_required, false) IS DISTINCT FROM coalesce(p_pickup_roadside_handoff_required, false)
    OR coalesce(v_producer.pickup_driver_directions, '') IS DISTINCT FROM v_pickup_directions;

  v_orders_paused := v_location_or_access_changed AND coalesce(v_producer.accepting_orders, false);

  UPDATE public.agrimarket_producers p
  SET contact_name = v_contact_name,
      contact_phone = v_phone_display,
      town = v_town,
      barangay = v_barangay,
      pickup_label = v_pickup_label,
      pickup_lat = p_pickup_lat,
      pickup_lng = p_pickup_lng,
      pickup_motorcycle_accessible = p_pickup_motorcycle_accessible,
      pickup_tricycle_accessible = p_pickup_tricycle_accessible,
      pickup_roadside_handoff_required = p_pickup_roadside_handoff_required,
      pickup_driver_directions = v_pickup_directions,
      accepting_orders = CASE
        WHEN v_location_or_access_changed THEN false
        ELSE p.accepting_orders
      END,
      updated_at = v_now
  WHERE p.id = p_producer_id;

  UPDATE public.agrimarket_farmer_applications a
  SET applicant_name = v_contact_name,
      phone_normalized = v_phone_normalized,
      phone_display = v_phone_display,
      town = v_town,
      barangay = v_barangay,
      pickup_label = v_pickup_label,
      pickup_lat = p_pickup_lat,
      pickup_lng = p_pickup_lng,
      pickup_motorcycle_accessible = p_pickup_motorcycle_accessible,
      pickup_tricycle_accessible = p_pickup_tricycle_accessible,
      pickup_roadside_handoff_required = p_pickup_roadside_handoff_required,
      pickup_driver_directions = v_pickup_directions,
      updated_at = v_now
  WHERE a.id = v_application.id;

  INSERT INTO public.agrimarket_farmer_application_events(
    application_id,
    event_type,
    actor_type,
    actor,
    details,
    created_at
  ) VALUES (
    v_application.id,
    'profile_updated',
    'staff',
    v_actor,
    jsonb_build_object(
      'producer_id', p_producer_id,
      'reason', v_reason,
      'location_or_access_changed', v_location_or_access_changed,
      'orders_paused', v_orders_paused,
      'before', jsonb_build_object(
        'contact_name', v_producer.contact_name,
        'contact_phone', v_producer.contact_phone,
        'town', v_producer.town,
        'barangay', v_producer.barangay,
        'pickup_label', v_producer.pickup_label,
        'pickup_lat', v_producer.pickup_lat,
        'pickup_lng', v_producer.pickup_lng,
        'pickup_motorcycle_accessible', v_producer.pickup_motorcycle_accessible,
        'pickup_tricycle_accessible', v_producer.pickup_tricycle_accessible,
        'pickup_roadside_handoff_required', v_producer.pickup_roadside_handoff_required,
        'pickup_driver_directions', v_producer.pickup_driver_directions,
        'accepting_orders', v_producer.accepting_orders
      ),
      'after', jsonb_build_object(
        'contact_name', v_contact_name,
        'contact_phone', v_phone_display,
        'phone_normalized', v_phone_normalized,
        'town', v_town,
        'barangay', v_barangay,
        'pickup_label', v_pickup_label,
        'pickup_lat', p_pickup_lat,
        'pickup_lng', p_pickup_lng,
        'pickup_motorcycle_accessible', p_pickup_motorcycle_accessible,
        'pickup_tricycle_accessible', p_pickup_tricycle_accessible,
        'pickup_roadside_handoff_required', p_pickup_roadside_handoff_required,
        'pickup_driver_directions', v_pickup_directions,
        'accepting_orders', CASE
          WHEN v_location_or_access_changed THEN false
          ELSE v_producer.accepting_orders
        END
      )
    ),
    v_now
  );

  RETURN QUERY
  SELECT
    p.id,
    v_application.id,
    p.accepting_orders,
    v_orders_paused,
    v_now
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) IS
  'Admin-only audited correction for staff-verified farmer contact and private pickup data. Location or access changes automatically pause new orders until readiness is approved again.';

DO $$
DECLARE v_profile_update oid;
BEGIN
  v_profile_update := to_regprocedure(
    'public.agrimarket_admin_update_verified_farmer_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,text,text,text,timestamp with time zone)'
  )::oid;
  IF v_profile_update IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PROFILE_UPDATE_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_profile_update, 'EXECUTE')
     OR has_function_privilege('authenticated', v_profile_update, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_profile_update, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PROFILE_UPDATE_PRIVILEGES_INVALID';
  END IF;
END;
$$;

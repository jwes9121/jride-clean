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
      AND p.proname = 'agrimarket_farmer_save_profile_v2'
  ) IS DISTINCT FROM '878b2ceeed65099c2d5401208db71a37' THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_V2_BASELINE_CHANGED';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.agrimarket_farmer_save_profile_v3(
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
  v_producer public.agrimarket_producers%rowtype;
  v_result record;
  v_town text := trim(coalesce(p_town, ''));
  v_previous_town text;
  v_town_changed boolean := false;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
BEGIN
  IF v_town NOT IN ('Lagawe', 'Hingyon', 'Banaue', 'Lamut') THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_TOWN_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_producer
  FROM public.agrimarket_producers
  WHERE id = p_producer_id
  FOR UPDATE;

  IF NOT FOUND OR lower(coalesce(v_producer.status, '')) <> 'active' THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  v_previous_town := v_producer.town;
  v_town_changed := v_town IS DISTINCT FROM v_previous_town;

  IF v_producer.vendor_name_locked_at IS NOT NULL AND v_town_changed THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_TOWN_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF v_town_changed THEN
    UPDATE public.agrimarket_producers
    SET town = v_town,
        accepting_orders = false,
        store_open = false,
        updated_at = v_now
    WHERE id = p_producer_id;
  END IF;

  SELECT *
  INTO STRICT v_result
  FROM public.agrimarket_farmer_save_profile_v2(
    p_producer_id,
    p_contact_name,
    p_phone_display,
    p_phone_normalized,
    p_barangay,
    p_vendor_name,
    p_pickup_label,
    p_pickup_lat,
    p_pickup_lng,
    p_pickup_motorcycle_accessible,
    p_pickup_tricycle_accessible,
    p_pickup_roadside_handoff_required,
    p_pickup_driver_directions,
    p_actor,
    p_confirm_vendor_name,
    v_now
  );

  IF v_town_changed THEN
    INSERT INTO public.agrimarket_farmer_application_events(
      application_id,
      event_type,
      actor_type,
      actor,
      details,
      created_at
    )
    VALUES (
      v_result.application_id,
      'profile_updated',
      'applicant',
      v_result.access_code,
      jsonb_build_object(
        'action', 'initial_municipality_selected',
        'producer_id', p_producer_id,
        'previous_town', v_previous_town,
        'town', v_town,
        'orders_paused', true
      ),
      v_now
    );
  END IF;

  RETURN QUERY
  SELECT
    v_result.application_id,
    v_result.producer_id,
    v_result.access_code,
    v_result.accepting_orders,
    v_result.profile_completed_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_farmer_save_profile_v3(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_save_profile_v3(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_farmer_save_profile_v3(
  uuid,text,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,boolean,timestamptz
) IS 'Farmer profile save with first-setup municipality correction limited to Lagawe, Hingyon, Banaue, or Lamut. Municipality changes are blocked after farm-name confirmation and pause readiness atomically.';

DO $permissions$
DECLARE
  v_fn oid := to_regprocedure(
    'public.agrimarket_farmer_save_profile_v3(uuid,text,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,boolean,timestamp with time zone)'
  )::oid;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_V3_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_V3_PRIVILEGES_INVALID';
  END IF;
END;
$permissions$;

COMMIT;

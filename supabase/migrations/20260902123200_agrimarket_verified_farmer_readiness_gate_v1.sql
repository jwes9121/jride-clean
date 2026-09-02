CREATE OR REPLACE FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  p_producer_id uuid,
  p_ready boolean,
  p_actor text,
  p_actor_role text,
  p_note text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  producer_id uuid,
  producer_status text,
  accepting_orders boolean,
  credential_status text,
  active_available_product_count integer,
  action text,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor text := trim(coalesce(p_actor, ''));
  v_role text := lower(trim(coalesce(p_actor_role, '')));
  v_note text := trim(coalesce(p_note, ''));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_producer public.agrimarket_producers%rowtype;
  v_credential public.agrimarket_producer_credentials%rowtype;
  v_application_id uuid;
  v_product_count integer := 0;
  v_action text;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'AGRIMARKET_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_producer_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_actor) < 2 OR length(v_actor) > 200 THEN
    RAISE EXCEPTION 'AGRIMARKET_READINESS_ACTOR_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_note) < 5 OR length(v_note) > 500 THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_NOTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_producer
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id
  FOR UPDATE;

  IF v_producer.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.id INTO v_application_id
  FROM public.agrimarket_farmer_applications a
  WHERE a.approved_producer_id = p_producer_id
    AND a.onboarding_source = 'staff_verified'
    AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_application_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_VERIFIED_APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.* INTO v_credential
  FROM public.agrimarket_producer_credentials c
  WHERE c.producer_id = p_producer_id
  FOR UPDATE;

  IF v_credential.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_CREDENTIAL_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_product_count
  FROM public.agrimarket_products product
  WHERE product.producer_id = p_producer_id
    AND product.is_active = true
    AND product.listed_quantity > product.reserved_quantity + product.sold_quantity;

  IF coalesce(p_ready, false) THEN
    IF v_producer.status <> 'active' THEN
      RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    IF v_credential.status <> 'active' THEN
      RAISE EXCEPTION 'AGRIMARKET_CREDENTIAL_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    IF NOT coalesce(v_producer.pickup_motorcycle_accessible, false)
       AND NOT coalesce(v_producer.pickup_tricycle_accessible, false)
       AND NOT coalesce(v_producer.pickup_roadside_handoff_required, false) THEN
      RAISE EXCEPTION 'AGRIMARKET_PICKUP_ACCESS_NOT_VERIFIED' USING ERRCODE = 'P0001';
    END IF;
    IF length(trim(coalesce(v_producer.pickup_driver_directions, ''))) < 5 THEN
      RAISE EXCEPTION 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_product_count < 1 THEN
      RAISE EXCEPTION 'AGRIMARKET_FARMER_NO_ACTIVE_PRODUCT' USING ERRCODE = 'P0001';
    END IF;
    v_action := 'ready_for_orders';
  ELSE
    v_action := 'orders_paused';
  END IF;

  UPDATE public.agrimarket_producers p
  SET accepting_orders = coalesce(p_ready, false),
      updated_at = v_now
  WHERE p.id = p_producer_id;

  INSERT INTO public.agrimarket_farmer_application_events(
    application_id,
    event_type,
    actor_type,
    actor,
    details,
    created_at
  ) VALUES (
    v_application_id,
    v_action,
    'staff',
    v_actor,
    jsonb_build_object(
      'producer_id', p_producer_id,
      'accepting_orders', coalesce(p_ready, false),
      'active_available_product_count', v_product_count,
      'note', v_note
    ),
    v_now
  );

  RETURN QUERY
  SELECT
    p.id,
    p.status,
    p.accepting_orders,
    c.status,
    v_product_count,
    v_action,
    v_now
  FROM public.agrimarket_producers p
  JOIN public.agrimarket_producer_credentials c ON c.producer_id = p.id
  WHERE p.id = p_producer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) IS
  'Admin-only readiness gate for staff-verified farmers. Enabling orders requires an active credential, verified pickup access, private driver directions, and at least one active product with available quantity.';

DO $$
DECLARE v_readiness oid;
BEGIN
  v_readiness := to_regprocedure(
    'public.agrimarket_admin_set_verified_farmer_readiness_v1(uuid,boolean,text,text,text,timestamp with time zone)'
  )::oid;
  IF v_readiness IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_readiness, 'EXECUTE')
     OR has_function_privilege('authenticated', v_readiness, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_readiness, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_PRIVILEGES_INVALID';
  END IF;
END;
$$;

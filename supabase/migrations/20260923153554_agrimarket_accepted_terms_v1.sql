BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
DECLARE old_def text; needle text := 'round(sum(p.unit_price*x.quantity),2)';
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.agrimarket_create_reserved_order_v4(uuid,uuid,uuid,jsonb,numeric,integer,numeric,integer,text,text)'::regprocedure) IS DISTINCT FROM '9e726af2ac044834c1cc86e6ecca3d95' THEN
  RAISE EXCEPTION 'Checkout source changed; review before applying'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.agrimarket_customer_respond_harvest_v1(text,uuid,text,timestamptz)'::regprocedure) IS DISTINCT FROM 'e48f4b012e56bfeed66d36090851cf8e' THEN
  RAISE EXCEPTION 'Harvest response source changed; review before applying'; END IF;
 -- Align only the subtotal expression; do not backfill historical orders.
 old_def := pg_get_functiondef('public.agrimarket_create_reserved_order_v4(uuid,uuid,uuid,jsonb,numeric,integer,numeric,integer,text,text)'::regprocedure);
 IF (length(old_def)-length(replace(old_def,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Rounding anchor changed'; END IF;
 EXECUTE replace(old_def,needle,'sum(round(p.unit_price*x.quantity,2))');
END;
$preflight$;

-- These records contain private routing basis. Only trusted server callers can access them.
CREATE TABLE public.agrimarket_checkout_quotes_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_user_id uuid NOT NULL REFERENCES auth.users(id),
 basis jsonb NOT NULL CHECK(jsonb_typeof(basis)='object'),
 quoted_payload jsonb NOT NULL CHECK(jsonb_typeof(quoted_payload)='object'),
 routes jsonb NOT NULL CHECK(jsonb_typeof(routes)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '5 minutes'),
 consumed_order_id uuid UNIQUE REFERENCES public.agrimarket_orders(id),
 consumed_request_id uuid,
 consumed_at timestamptz,
 CHECK(expires_at>created_at),
 CHECK((consumed_order_id IS NULL)=(consumed_request_id IS NULL))
);
CREATE INDEX agrimarket_checkout_quotes_expiry_idx ON public.agrimarket_checkout_quotes_v1(expires_at) WHERE consumed_order_id IS NULL;
CREATE INDEX agrimarket_checkout_quotes_customer_created_idx ON public.agrimarket_checkout_quotes_v1(customer_user_id,created_at DESC);
ALTER TABLE public.agrimarket_checkout_quotes_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agrimarket_checkout_quotes_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.agrimarket_checkout_quotes_v1 TO service_role;

CREATE FUNCTION public.agrimarket_checkout_basis_v1(p_customer_user_id uuid,p_address_id uuid,p_items jsonb,p_vehicle text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' SET timezone='UTC' AS $function$
 WITH requested AS (SELECT * FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric)),
 prods AS (SELECT p.id,p.producer_id,p.name,p.product_group,p.species,p.meat_cut,p.cargo_class,p.selling_unit,p.unit_weight_kg,p.unit_price,p.availability_mode,p.harvest_start_at,p.harvest_end_at,p.harvest_order_cutoff_at,p.default_prep_minutes,p.vehicle_requirement,p.handling_eligible,p.is_active FROM public.agrimarket_products p JOIN requested r ON r.product_id=p.id)
 SELECT jsonb_build_object(
 'customer_user_id',p_customer_user_id,'preferred_vehicle_type',p_vehicle,
 'items',(SELECT jsonb_agg(to_jsonb(r) ORDER BY product_id) FROM requested r),
 'address',(SELECT to_jsonb(a) FROM (SELECT pa.id,pa.address_text,pa.label,pa.lat,pa.lng,pa.is_active FROM public.passenger_addresses pa WHERE pa.id=p_address_id AND pa.created_by_user_id=p_customer_user_id AND pa.is_active) a),
 'producer',(SELECT to_jsonb(v) FROM (SELECT p.id,p.pickup_lat,p.pickup_lng,p.status,p.accepting_orders,p.store_open,p.marketplace_fee_percent,p.pickup_motorcycle_accessible,p.pickup_tricycle_accessible,p.pickup_roadside_handoff_required,p.pickup_driver_directions FROM public.agrimarket_producers p WHERE p.id=(SELECT producer_id FROM prods LIMIT 1)) v),
 'products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM prods p),
 'pricing',(SELECT to_jsonb(s) FROM (SELECT ps.id,ps.pricing_version,ps.currency,ps.base_delivery_fee,ps.route_fee_per_km,ps.delivery_company_cut,ps.rounding_mode,ps.is_active,ps.cash_first_threshold,ps.heavy_load_exact_tier1_max_kg,ps.heavy_load_exact_tier2_max_kg,ps.heavy_load_exact_tier3_max_kg,ps.heavy_load_exact_tier4_max_kg,ps.kolong_kolong_max_kg,ps.heavy_load_tier1_fee,ps.heavy_load_tier2_fee,ps.heavy_load_tier3_fee,ps.heavy_load_tier4_fee,ps.special_handling_standard_fee,ps.special_handling_bulky_fee,ps.special_handling_live_single_fee,ps.special_handling_live_difficult_fee FROM public.agrimarket_pricing_settings ps WHERE ps.id=1 AND ps.is_active) s));
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_checkout_basis_v1(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_checkout_basis_v1(uuid,uuid,jsonb,text) TO service_role;

CREATE FUNCTION public.agrimarket_capture_checkout_quote_v1(p_customer_user_id uuid,p_address_id uuid,p_items jsonb,p_vehicle text,p_expected_basis jsonb,p_quoted_payload jsonb,p_routes jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' SET timezone='UTC' AS $function$
DECLARE b jsonb; sub numeric; route_km numeric; delivery record; q public.agrimarket_checkout_quotes_v1%rowtype; snapshot_items jsonb; given_items jsonb;
BEGIN
 IF p_customer_user_id IS NULL OR p_address_id IS NULL OR p_vehicle NOT IN ('motorcycle','tricycle','kolong_kolong')
    OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'AGRIMARKET_QUOTE_INPUT_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric)
    WHERE product_id IS NULL OR quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity') OR quantity<>round(quantity,3))
    OR (SELECT count(DISTINCT product_id) FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric))<>jsonb_array_length(p_items) THEN
  RAISE EXCEPTION 'AGRIMARKET_QUOTE_INPUT_INVALID'; END IF;
 -- Capture one locked material basis; do not bless a reread that differs from the routed/rendered source.
 PERFORM p.id FROM public.agrimarket_products p JOIN jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric) ON x.product_id=p.id ORDER BY p.id FOR SHARE OF p;
 PERFORM p.id FROM public.agrimarket_producers p WHERE p.id=(p_expected_basis->'producer'->>'id')::uuid FOR SHARE;
 PERFORM a.id FROM public.passenger_addresses a WHERE a.id=p_address_id AND a.created_by_user_id=p_customer_user_id FOR SHARE;
 PERFORM s.id FROM public.agrimarket_pricing_settings s WHERE s.id=1 FOR SHARE;
 b := public.agrimarket_checkout_basis_v1(p_customer_user_id,p_address_id,p_items,p_vehicle);
 IF b IS DISTINCT FROM p_expected_basis OR b->'address'='null'::jsonb OR b->'producer'='null'::jsonb OR b->'pricing'='null'::jsonb THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_CHANGED'); END IF;
 SELECT sum(round(p.unit_price*r.quantity,2)),jsonb_agg(jsonb_build_object(
  'product_id',p.id,'name',p.name,'selling_unit',p.selling_unit,'unit_price',p.unit_price,'quantity',r.quantity,'line_total',round(p.unit_price*r.quantity,2),
  'availability_mode',p.availability_mode,'harvest_start_at',p.harvest_start_at,'harvest_end_at',p.harvest_end_at,'harvest_order_cutoff_at',p.harvest_order_cutoff_at) ORDER BY p.id)
 INTO sub,snapshot_items
 FROM jsonb_to_recordset(p_items) r(product_id uuid,quantity numeric) JOIN public.agrimarket_products p ON p.id=r.product_id;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY product_id) INTO given_items FROM jsonb_to_recordset(p_quoted_payload->'items') x(
  product_id uuid,name text,selling_unit text,unit_price numeric,quantity numeric,line_total numeric,availability_mode text,harvest_start_at timestamptz,harvest_end_at timestamptz,harvest_order_cutoff_at timestamptz);
 IF sub IS NULL OR sub IS DISTINCT FROM (p_quoted_payload->>'product_subtotal')::numeric OR snapshot_items IS DISTINCT FROM given_items THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_CHANGED'); END IF;
 IF p_routes->>'provider' IS DISTINCT FROM 'mapbox_driving' OR p_routes->>'farmer_km' IS NULL OR p_routes->>'farmer_seconds' IS NULL
  OR (p_routes->>'farmer_km') IN ('NaN','Infinity','-Infinity') OR (p_routes->>'farmer_km')::numeric<0 OR (p_routes->>'farmer_seconds')::integer<0 THEN RAISE EXCEPTION 'AGRIMARKET_ROUTE_INVALID'; END IF;
 IF sub>(b->'pricing'->>'cash_first_threshold')::numeric AND (p_routes->>'customer_km' IS NULL OR p_routes->>'customer_seconds' IS NULL OR (p_routes->>'customer_km') IN ('NaN','Infinity','-Infinity') OR (p_routes->>'customer_km')::numeric<0 OR (p_routes->>'customer_seconds')::integer<0) THEN RAISE EXCEPTION 'AGRIMARKET_ROUTE_REQUIRED'; END IF;
 route_km := round((p_routes->>'farmer_km')::numeric+CASE WHEN sub>(b->'pricing'->>'cash_first_threshold')::numeric THEN (p_routes->>'customer_km')::numeric ELSE 0 END,3);
 IF route_km IS NULL THEN RAISE EXCEPTION 'AGRIMARKET_ROUTE_REQUIRED'; END IF;
 SELECT * INTO delivery FROM public.agrimarket_quote_delivery_v1(route_km);
 IF (p_quoted_payload->'address'->>'id')::uuid IS DISTINCT FROM p_address_id
   OR p_quoted_payload->>'preferred_vehicle_type' IS DISTINCT FROM p_vehicle
   OR (p_quoted_payload->'delivery'->>'delivery_fee')::numeric IS DISTINCT FROM delivery.delivery_fee
   OR (p_quoted_payload->'delivery'->>'base_fee')::numeric IS DISTINCT FROM delivery.base_delivery_fee
   OR (p_quoted_payload->'delivery'->>'rate_per_km')::numeric IS DISTINCT FROM delivery.route_fee_per_km
   OR (p_quoted_payload->>'initial_approved_total')::numeric IS DISTINCT FROM sub+delivery.delivery_fee THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_CHANGED'); END IF;
 INSERT INTO public.agrimarket_checkout_quotes_v1(customer_user_id,basis,quoted_payload,routes) VALUES(p_customer_user_id,b,p_quoted_payload,p_routes) RETURNING * INTO q;
 RETURN jsonb_build_object('ok',true,'contract','quoted_v1','quote_id',q.id,'created_at',q.created_at,'expires_at',q.expires_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_capture_checkout_quote_v1(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_capture_checkout_quote_v1(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.agrimarket_create_quoted_order_v1(p_customer_user_id uuid,p_client_request_id uuid,p_quote_id uuid,p_address_id uuid,p_items jsonb,p_vehicle text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' SET timezone='UTC' AS $function$
DECLARE q public.agrimarket_checkout_quotes_v1%rowtype; b jsonb; canonical_items jsonb; existing public.agrimarket_orders%rowtype; made record; saved public.agrimarket_orders%rowtype;
BEGIN
 IF p_customer_user_id IS NULL OR p_client_request_id IS NULL OR p_quote_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_REQUIRED'); END IF;
 -- Serialize retries even when they arrive with distinct quote tokens.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_user_id::text||':'||p_client_request_id::text,0));
 SELECT * INTO q FROM public.agrimarket_checkout_quotes_v1 WHERE id=p_quote_id AND customer_user_id=p_customer_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_NOT_FOUND'); END IF;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY product_id) INTO canonical_items FROM jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric);
 IF q.basis->'items' IS DISTINCT FROM canonical_items OR (q.basis->'address'->>'id')::uuid IS DISTINCT FROM p_address_id OR q.basis->>'preferred_vehicle_type' IS DISTINCT FROM p_vehicle THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_CART_CHANGED'); END IF;
 SELECT * INTO existing FROM public.agrimarket_orders WHERE customer_user_id=p_customer_user_id AND client_request_id=p_client_request_id;
 IF FOUND THEN
  IF q.consumed_order_id IS DISTINCT FROM existing.id OR q.consumed_request_id IS DISTINCT FROM p_client_request_id THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_REPLAY_CONFLICT'); END IF;
  RETURN jsonb_build_object('ok',true,'idempotent_replay',true,'order_code',existing.order_code,'producer_id',existing.producer_id);
 END IF;
 IF q.consumed_order_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_ALREADY_USED'); END IF;
 IF q.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_EXPIRED'); END IF;
 -- Match the existing creator's product -> producer lock order; retain stock guards.
 PERFORM p.id FROM public.agrimarket_products p JOIN jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric) ON x.product_id=p.id ORDER BY p.id FOR UPDATE OF p;
 PERFORM p.id FROM public.agrimarket_producers p WHERE p.id=(q.basis->'producer'->>'id')::uuid FOR UPDATE;
 PERFORM a.id FROM public.passenger_addresses a WHERE a.id=p_address_id AND a.created_by_user_id=p_customer_user_id FOR UPDATE;
 PERFORM s.id FROM public.agrimarket_pricing_settings s WHERE s.id=1 FOR SHARE;
 b := public.agrimarket_checkout_basis_v1(p_customer_user_id,p_address_id,p_items,p_vehicle);
 IF b IS DISTINCT FROM q.basis THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_CHANGED'); END IF;
 IF q.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_QUOTE_EXPIRED'); END IF;
 SELECT * INTO made FROM public.agrimarket_create_reserved_order_v4(p_customer_user_id,p_client_request_id,p_address_id,p_items,
  (q.routes->>'farmer_km')::numeric,(q.routes->>'farmer_seconds')::integer,(q.routes->>'customer_km')::numeric,(q.routes->>'customer_seconds')::integer,p_vehicle,q.routes->>'provider');
 SELECT * INTO saved FROM public.agrimarket_orders WHERE id=made.order_id;
 -- Raising rolls back the creator, inventory holds, notifications and receipt together.
 IF saved.id IS NULL OR saved.total_payable IS DISTINCT FROM (q.quoted_payload->>'initial_approved_total')::numeric
   OR saved.product_subtotal IS DISTINCT FROM (q.quoted_payload->>'product_subtotal')::numeric
   OR saved.fulfillment_mode IS DISTINCT FROM q.quoted_payload->'fulfillment'->>'mode'
   OR saved.harvest_expected_start_at IS DISTINCT FROM (q.quoted_payload->'fulfillment'->>'expected_harvest_start_at')::timestamptz
   OR coalesce(saved.harvest_expected_end_at,saved.harvest_expected_start_at) IS DISTINCT FROM coalesce((q.quoted_payload->'fulfillment'->>'expected_harvest_end_at')::timestamptz,(q.quoted_payload->'fulfillment'->>'expected_harvest_start_at')::timestamptz) THEN
  RAISE EXCEPTION 'AGRIMARKET_QUOTE_CHANGED' USING ERRCODE='P0001'; END IF;
 UPDATE public.agrimarket_checkout_quotes_v1 SET consumed_order_id=saved.id,consumed_request_id=p_client_request_id,consumed_at=clock_timestamp() WHERE id=q.id;
 RETURN jsonb_build_object('ok',true,'idempotent_replay',false,'order_code',saved.order_code,'producer_id',saved.producer_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_create_quoted_order_v1(uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_create_quoted_order_v1(uuid,uuid,uuid,uuid,jsonb,text) TO service_role;

ALTER TABLE public.agrimarket_harvest_proposals ADD COLUMN response_revision_at timestamptz;
CREATE FUNCTION public.agrimarket_customer_respond_harvest_v2(p_order_code text,p_customer_user_id uuid,p_response text,p_proposal_id uuid,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE o public.agrimarket_orders%rowtype; hp public.agrimarket_harvest_proposals%rowtype; result jsonb; response text:=lower(trim(coalesce(p_response,'')));
BEGIN
 IF p_proposal_id IS NULL OR p_expected_updated_at IS NULL OR response NOT IN ('accept','reject') THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_REVISION_REQUIRED'); END IF;
 SELECT * INTO o FROM public.agrimarket_orders WHERE order_code=trim(p_order_code) AND customer_user_id=p_customer_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); END IF;
 SELECT * INTO hp FROM public.agrimarket_harvest_proposals WHERE id=p_proposal_id AND order_id=o.id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_PROPOSAL_STALE'); END IF;
 IF hp.status IN ('accepted','rejected') AND hp.customer_response=response AND hp.response_revision_at=p_expected_updated_at THEN
  RETURN jsonb_build_object('ok',true,'already_done',true,'proposal_id',hp.id,'proposal_status',hp.status,'status',o.status); END IF;
 IF hp.status<>'pending_customer' OR hp.updated_at IS DISTINCT FROM p_expected_updated_at OR o.fulfillment_mode<>'scheduled_harvest' OR o.status<>'awaiting_harvest'
  OR EXISTS(SELECT 1 FROM public.agrimarket_harvest_proposals WHERE order_id=o.id AND status='pending_customer' AND id<>hp.id) THEN
  RETURN jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_PROPOSAL_STALE'); END IF;
 result := public.agrimarket_customer_respond_harvest_v1(o.order_code,p_customer_user_id,response,clock_timestamp());
 IF result->>'ok'='true' THEN
  UPDATE public.agrimarket_harvest_proposals SET response_revision_at=p_expected_updated_at WHERE id=hp.id;
 END IF;
 RETURN result||jsonb_build_object('proposal_id',hp.id,'accepted_input_revision',p_expected_updated_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_customer_respond_harvest_v2(text,uuid,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_customer_respond_harvest_v2(text,uuid,text,uuid,timestamptz) TO service_role;
COMMIT;

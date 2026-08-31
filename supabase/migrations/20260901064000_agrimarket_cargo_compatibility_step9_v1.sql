-- AGRIMARKET CARGO COMPATIBILITY - STEP 9 V1
-- Scope: prevent one Agrimarket order from mixing cargo classes that cannot
-- legitimately share one delivery run under one confirmed handling tier and
-- one vehicle.
--
-- Locked examples:
--   compatible: goat + goat
--   compatible: vegetables + vegetables
--   incompatible: live goat + loose vegetables
--   incompatible: live poultry + fresh meat
--
-- The locked specification does not define a broader cross-class matrix.
-- V1 therefore has exactly one cross-class family: standard_produce and
-- fragile_produce are both produce. Every other existing cargo_class remains
-- isolated unless a later approved specification explicitly changes the map.
--
-- Enforcement is placed on agrimarket_order_items, the durable cart snapshot.
-- agrimarket_create_reserved_order_v4 inserts these rows before inventory
-- reservation rows and quantity counters, so an incompatibility exception
-- aborts the checkout transaction before reservation side effects can commit.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_orders') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_PRECONDITION_ORDERS_MISSING';
  END IF;

  IF to_regclass('public.agrimarket_order_items') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_PRECONDITION_ORDER_ITEMS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_order_items'
      AND column_name = 'cargo_class'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_PRECONDITION_CARGO_CLASS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_order_items'
      AND column_name = 'order_id'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_PRECONDITION_ORDER_ID_MISSING';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agrimarket_cargo_family_v1(
  p_cargo_class text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_cargo_class text := lower(trim(p_cargo_class));
BEGIN
  CASE v_cargo_class
    WHEN 'standard_produce' THEN RETURN 'produce';
    WHEN 'fragile_produce' THEN RETURN 'produce';
    WHEN 'bulk_sack' THEN RETURN 'bulk_sack';
    WHEN 'crate' THEN RETURN 'crate';
    WHEN 'live_fish' THEN RETURN 'live_fish';
    WHEN 'live_poultry' THEN RETURN 'live_poultry';
    WHEN 'live_livestock' THEN RETURN 'live_livestock';
    WHEN 'fresh_meat' THEN RETURN 'fresh_meat';
    WHEN 'chilled_meat' THEN RETURN 'chilled_meat';
    WHEN 'frozen_meat' THEN RETURN 'frozen_meat';
    WHEN 'other_agri' THEN RETURN 'other_agri';
    ELSE
      RAISE EXCEPTION 'AGRIMARKET_UNSUPPORTED_CARGO_CLASS: %', p_cargo_class
        USING ERRCODE = 'P0001';
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_cargo_family_v1(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_cargo_family_v1(text)
  TO service_role;

COMMENT ON FUNCTION public.agrimarket_cargo_family_v1(text) IS
  'Step 9 cargo compatibility map. standard_produce and fragile_produce share produce; every other V1 cargo class is isolated.';

CREATE OR REPLACE FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_new_family text;
  v_existing_cargo_class text;
  v_existing_family text;
BEGIN
  v_new_family := public.agrimarket_cargo_family_v1(new.cargo_class);

  -- Serialize compatibility decisions per order so concurrent item writes
  -- cannot both validate against an empty/pre-write snapshot and commit an
  -- incompatible combination.
  PERFORM 1
  FROM public.agrimarket_orders o
  WHERE o.id = new.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGRIMARKET_ORDER_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    oi.cargo_class,
    public.agrimarket_cargo_family_v1(oi.cargo_class)
  INTO
    v_existing_cargo_class,
    v_existing_family
  FROM public.agrimarket_order_items oi
  WHERE oi.order_id = new.order_id
    AND oi.id IS DISTINCT FROM new.id
    AND public.agrimarket_cargo_family_v1(oi.cargo_class) <> v_new_family
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'AGRIMARKET_CARGO_COMPATIBILITY_MISMATCH: % cannot share one order with %; create separate orders',
      v_existing_cargo_class,
      new.cargo_class
      USING
        ERRCODE = 'P0001',
        DETAIL = format(
          'Existing family=%s; incoming family=%s.',
          v_existing_family,
          v_new_family
        ),
        HINT = 'Place incompatible Agrimarket cargo families in separate orders.';
  END IF;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1()
  TO service_role;

COMMENT ON FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1() IS
  'Step 9 order-item guard. Locks the parent order and rejects writes that would mix incompatible cargo families.';

DROP TRIGGER IF EXISTS agrimarket_order_items_cargo_compatibility_insert_trg
  ON public.agrimarket_order_items;
CREATE TRIGGER agrimarket_order_items_cargo_compatibility_insert_trg
BEFORE INSERT ON public.agrimarket_order_items
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1();

DROP TRIGGER IF EXISTS agrimarket_order_items_cargo_compatibility_update_trg
  ON public.agrimarket_order_items;
CREATE TRIGGER agrimarket_order_items_cargo_compatibility_update_trg
BEFORE UPDATE OF order_id, cargo_class ON public.agrimarket_order_items
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_enforce_order_item_cargo_compatibility_v1();

-- Self-verifying policy checks. These fail the migration if the V1 family map
-- or enforcement hooks drift from the locked Step 9 boundary.
DO $$
DECLARE
  v_supported_count integer;
  v_trigger_count integer;
BEGIN
  SELECT count(*)
  INTO v_supported_count
  FROM (VALUES
    ('standard_produce'),
    ('fragile_produce'),
    ('bulk_sack'),
    ('crate'),
    ('live_fish'),
    ('live_poultry'),
    ('live_livestock'),
    ('fresh_meat'),
    ('chilled_meat'),
    ('frozen_meat'),
    ('other_agri')
  ) AS allowed(cargo_class)
  WHERE public.agrimarket_cargo_family_v1(allowed.cargo_class) IS NOT NULL;

  IF v_supported_count <> 11 THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_CARGO_CLASS_COVERAGE_FAILED';
  END IF;

  -- Vegetables may combine across the two existing produce cargo classes.
  IF public.agrimarket_cargo_family_v1('standard_produce')
       <> public.agrimarket_cargo_family_v1('fragile_produce') THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_PRODUCE_FAMILY_CHECK_FAILED';
  END IF;

  -- Locked incompatible examples and handling/cold-chain boundaries.
  IF public.agrimarket_cargo_family_v1('live_livestock')
       = public.agrimarket_cargo_family_v1('standard_produce') THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_LIVESTOCK_PRODUCE_BOUNDARY_FAILED';
  END IF;

  IF public.agrimarket_cargo_family_v1('live_poultry')
       = public.agrimarket_cargo_family_v1('fresh_meat') THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_POULTRY_MEAT_BOUNDARY_FAILED';
  END IF;

  IF public.agrimarket_cargo_family_v1('fresh_meat')
       = public.agrimarket_cargo_family_v1('chilled_meat')
     OR public.agrimarket_cargo_family_v1('fresh_meat')
       = public.agrimarket_cargo_family_v1('frozen_meat')
     OR public.agrimarket_cargo_family_v1('chilled_meat')
       = public.agrimarket_cargo_family_v1('frozen_meat') THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_MEAT_CONDITION_BOUNDARY_FAILED';
  END IF;

  IF public.agrimarket_cargo_family_v1('bulk_sack')
       = public.agrimarket_cargo_family_v1('live_poultry') THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_BULKY_LIVE_BOUNDARY_FAILED';
  END IF;

  SELECT count(*)
  INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.agrimarket_order_items'::regclass
    AND tgname IN (
      'agrimarket_order_items_cargo_compatibility_insert_trg',
      'agrimarket_order_items_cargo_compatibility_update_trg'
    )
    AND NOT tgisinternal;

  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP9_CARGO_COMPATIBILITY_TRIGGERS_MISSING';
  END IF;
END;
$$;

-- AGRIMARKET HEAVY LOAD FEE CONSUMER - PREREQUISITE V1
--
-- Scope: close the unsequenced Heavy Load Fee backend gap before Step 11 UI.
-- This migration does not change the locked delivery fare, Special Handling
-- Fee, Driver Approach Fee, cargo compatibility, or cross-town policy.
--
-- Locked Heavy Load Fee:
--   exact <= 15 kg / approximate 1_15   -> PHP 0
--   exact >15..25 kg / approximate 16_25 -> PHP 20
--   exact >25..50 kg / approximate 26_50 -> PHP 40
--   exact >50..100 kg / approximate 51_100 -> PHP 80
--   >100 kg / over_100 -> unsupported in V1
--
-- Heavy Load Fee is paid entirely to the driver. The existing PHP 20 delivery
-- company cut remains unchanged and applies only to delivery + approach.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_orders') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_ORDERS';
  END IF;

  IF to_regclass('public.agrimarket_pricing_settings') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_PRICING_SETTINGS';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agrimarket_orders'
      AND column_name='confirmed_cargo_weight_basis'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agrimarket_orders'
      AND column_name='confirmed_cargo_weight_kg'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agrimarket_orders'
      AND column_name='confirmed_cargo_weight_band'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_WEIGHT_CONFIRMATION';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agrimarket_pricing_settings'
      AND column_name='heavy_load_tier4_fee'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_STEP5_SETTINGS';
  END IF;

  IF to_regprocedure('public.agrimarket_evaluate_customer_reapproval_v1()') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_STEP4_REAPPROVAL';
  END IF;

  IF to_regprocedure('public.agrimarket_compute_required_vehicle_v1(text,text,numeric,text,text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_REQUIRES_STEP7_VEHICLE_RULE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agrimarket_orders'
      AND column_name='heavy_load_fee'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_FEE_ALREADY_EXISTS';
  END IF;
END;
$$;

ALTER TABLE public.agrimarket_orders
  ADD COLUMN heavy_load_fee numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.agrimarket_orders
  ADD CONSTRAINT agrimarket_orders_heavy_load_fee_nonnegative_chk
  CHECK (heavy_load_fee >= 0);

CREATE OR REPLACE FUNCTION public.agrimarket_compute_heavy_load_fee_v1(
  p_weight_basis text,
  p_weight_kg numeric,
  p_weight_band text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_basis text := lower(trim(coalesce(p_weight_basis,'')));
  v_band text := lower(trim(coalesce(p_weight_band,'')));
  v_tier1_max numeric(10,3);
  v_tier2_max numeric(10,3);
  v_tier3_max numeric(10,3);
  v_tier4_max numeric(10,3);
  v_fee1 numeric(12,2);
  v_fee2 numeric(12,2);
  v_fee3 numeric(12,2);
  v_fee4 numeric(12,2);
BEGIN
  IF v_basis = '' THEN
    RETURN 0;
  END IF;

  SELECT
    heavy_load_exact_tier1_max_kg,
    heavy_load_exact_tier2_max_kg,
    heavy_load_exact_tier3_max_kg,
    heavy_load_exact_tier4_max_kg,
    heavy_load_tier1_fee,
    heavy_load_tier2_fee,
    heavy_load_tier3_fee,
    heavy_load_tier4_fee
  INTO
    v_tier1_max,
    v_tier2_max,
    v_tier3_max,
    v_tier4_max,
    v_fee1,
    v_fee2,
    v_fee3,
    v_fee4
  FROM public.agrimarket_pricing_settings
  WHERE id=1 AND is_active=true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGRIMARKET_PRICING_NOT_CONFIGURED'
      USING ERRCODE='P0001';
  END IF;

  IF v_basis='exact' THEN
    IF p_weight_kg IS NULL OR p_weight_kg <= 0 THEN
      RAISE EXCEPTION 'AGRIMARKET_EXACT_WEIGHT_REQUIRED'
        USING ERRCODE='P0001';
    END IF;

    IF p_weight_kg <= v_tier1_max THEN
      RETURN round(v_fee1,2);
    ELSIF p_weight_kg <= v_tier2_max THEN
      RETURN round(v_fee2,2);
    ELSIF p_weight_kg <= v_tier3_max THEN
      RETURN round(v_fee3,2);
    ELSIF p_weight_kg <= v_tier4_max THEN
      RETURN round(v_fee4,2);
    END IF;

    RAISE EXCEPTION 'AGRIMARKET_CARGO_OVER_100KG_UNSUPPORTED'
      USING ERRCODE='P0001';
  END IF;

  IF v_basis='approximate' THEN
    CASE v_band
      WHEN '1_15' THEN RETURN round(v_fee1,2);
      WHEN '16_25' THEN RETURN round(v_fee2,2);
      WHEN '26_50' THEN RETURN round(v_fee3,2);
      WHEN '51_100' THEN RETURN round(v_fee4,2);
      WHEN 'over_100' THEN
        RAISE EXCEPTION 'AGRIMARKET_CARGO_OVER_100KG_UNSUPPORTED'
          USING ERRCODE='P0001';
      ELSE
        RAISE EXCEPTION 'AGRIMARKET_APPROXIMATE_WEIGHT_BAND_REQUIRED'
          USING ERRCODE='P0001';
    END CASE;
  END IF;

  RAISE EXCEPTION 'AGRIMARKET_INVALID_WEIGHT_BASIS'
    USING ERRCODE='P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_compute_heavy_load_fee_v1(text,numeric,text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_compute_heavy_load_fee_v1(text,numeric,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.agrimarket_apply_heavy_load_fee_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  NEW.heavy_load_fee := public.agrimarket_compute_heavy_load_fee_v1(
    NEW.confirmed_cargo_weight_basis,
    NEW.confirmed_cargo_weight_kg,
    NEW.confirmed_cargo_weight_band
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_apply_heavy_load_fee_v1()
  FROM public, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS agrimarket_apply_heavy_load_fee_insert_trg
  ON public.agrimarket_orders;
CREATE TRIGGER agrimarket_apply_heavy_load_fee_insert_trg
BEFORE INSERT ON public.agrimarket_orders
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_apply_heavy_load_fee_v1();

DROP TRIGGER IF EXISTS agrimarket_apply_heavy_load_fee_update_trg
  ON public.agrimarket_orders;
CREATE TRIGGER agrimarket_apply_heavy_load_fee_update_trg
BEFORE UPDATE OF
  confirmed_cargo_weight_basis,
  confirmed_cargo_weight_kg,
  confirmed_cargo_weight_band,
  heavy_load_fee
ON public.agrimarket_orders
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_apply_heavy_load_fee_v1();

-- Add Heavy Load to the two durable generated money totals. There are no
-- indexes or table constraints on these generated columns in the frozen
-- production schema; all callers reference them by column name.
ALTER TABLE public.agrimarket_orders
  DROP COLUMN total_payable,
  DROP COLUMN driver_delivery_payout;

ALTER TABLE public.agrimarket_orders
  ADD COLUMN total_payable numeric(12,2)
    GENERATED ALWAYS AS (
      product_subtotal
      + delivery_fee
      + pickup_distance_fee
      + heavy_load_fee
      + handling_fee
    ) STORED,
  ADD COLUMN driver_delivery_payout numeric(12,2)
    GENERATED ALWAYS AS (
      greatest(delivery_fee + pickup_distance_fee - delivery_company_cut, 0::numeric)
      + heavy_load_fee
      + handling_fee
    ) STORED;

-- New-order approval baseline remains checkout-only. Heavy Load is normally 0
-- until farmer confirmation, but include the column so the baseline function
-- stays mathematically aligned with total_payable for every insert path.
CREATE OR REPLACE FUNCTION public.agrimarket_initialize_customer_approval_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  NEW.customer_approved_total := round(
    coalesce(NEW.product_subtotal,0)
    + coalesce(NEW.delivery_fee,0)
    + coalesce(NEW.pickup_distance_fee,0)
    + coalesce(NEW.heavy_load_fee,0)
    + coalesce(NEW.handling_fee,0),
    2
  );

  NEW.customer_approved_vehicle_type := CASE
    WHEN NEW.preferred_vehicle_type='tricycle' THEN 'tricycle'
    ELSE 'motorcycle'
  END;

  NEW.customer_reapproval_required_at := null;
  NEW.customer_reapproval_responded_at := null;
  NEW.customer_reapproval_response := null;
  NEW.customer_reapproval_proposed_total := null;
  NEW.customer_reapproval_proposed_vehicle_type := null;
  NEW.customer_reapproval_resume_status := null;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_initialize_customer_approval_v1()
  FROM public, anon, authenticated, service_role;

-- Explicitly include heavy_load_fee in the Step 4 watch list. Normal farmer
-- confirmation also updates the weight fields, but watching the monetary slot
-- itself keeps any future settings-driven reprice on the same consent gate.
DROP TRIGGER IF EXISTS agrimarket_evaluate_customer_reapproval_trg
  ON public.agrimarket_orders;
CREATE TRIGGER agrimarket_evaluate_customer_reapproval_trg
AFTER UPDATE OF
  confirmed_cargo_weight_basis,
  confirmed_cargo_weight_kg,
  confirmed_cargo_weight_band,
  confirmed_handling_tier,
  heavy_load_fee,
  handling_fee,
  required_vehicle_type
ON public.agrimarket_orders
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_evaluate_customer_reapproval_v1();

-- Recalculate only confirmed, unassigned, pre-dispatch rows. Historical rows
-- that may already have settled before this consumer existed are not repriced.
UPDATE public.agrimarket_orders
SET heavy_load_fee = heavy_load_fee
WHERE confirmed_cargo_weight_basis IS NOT NULL
  AND assigned_driver_id IS NULL
  AND status IN (
    'producer_accepted',
    'preparing',
    'awaiting_customer_reapproval',
    'ready_for_dispatch'
  );

COMMENT ON COLUMN public.agrimarket_orders.heavy_load_fee IS
  'Farmer-confirmed Heavy Load Fee derived from authoritative exact kg or approximate weight band. Paid entirely to the driver; not subject to the delivery company cut.';

COMMENT ON COLUMN public.agrimarket_orders.total_payable IS
  'Customer total: product subtotal + delivery fee + driver approach fee + Heavy Load Fee + Special Handling Fee.';

COMMENT ON COLUMN public.agrimarket_orders.driver_delivery_payout IS
  'Driver payout: delivery + approach net of delivery company cut, plus 100% of Heavy Load Fee and Special Handling Fee.';

COMMENT ON FUNCTION public.agrimarket_compute_heavy_load_fee_v1(text,numeric,text) IS
  'Computes the locked Heavy Load Fee from active pricing settings and the authoritative farmer-confirmed exact weight or approximate weight band.';

COMMENT ON FUNCTION public.agrimarket_apply_heavy_load_fee_v1() IS
  'System trigger writer for agrimarket_orders.heavy_load_fee.';

DO $$
DECLARE
  v_t1 numeric;
  v_t2 numeric;
  v_t3 numeric;
  v_t4 numeric;
  v_max1 numeric;
  v_max2 numeric;
  v_max3 numeric;
  v_max4 numeric;
  v_total_expr text;
  v_payout_expr text;
BEGIN
  SELECT
    heavy_load_tier1_fee,
    heavy_load_tier2_fee,
    heavy_load_tier3_fee,
    heavy_load_tier4_fee,
    heavy_load_exact_tier1_max_kg,
    heavy_load_exact_tier2_max_kg,
    heavy_load_exact_tier3_max_kg,
    heavy_load_exact_tier4_max_kg
  INTO v_t1,v_t2,v_t3,v_t4,v_max1,v_max2,v_max3,v_max4
  FROM public.agrimarket_pricing_settings
  WHERE id=1 AND is_active=true;

  IF public.agrimarket_compute_heavy_load_fee_v1('exact',v_max1,null) <> v_t1
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max1 + 0.001,null) <> v_t2
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max2,null) <> v_t2
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max2 + 0.001,null) <> v_t3
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max3,null) <> v_t3
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max3 + 0.001,null) <> v_t4
     OR public.agrimarket_compute_heavy_load_fee_v1('exact',v_max4,null) <> v_t4 THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_EXACT_BOUNDARY_POSTCHECK_FAILED';
  END IF;

  IF public.agrimarket_compute_heavy_load_fee_v1('approximate',null,'1_15') <> v_t1
     OR public.agrimarket_compute_heavy_load_fee_v1('approximate',999,'16_25') <> v_t2
     OR public.agrimarket_compute_heavy_load_fee_v1('approximate',1,'26_50') <> v_t3
     OR public.agrimarket_compute_heavy_load_fee_v1('approximate',1,'51_100') <> v_t4 THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_BAND_POSTCHECK_FAILED';
  END IF;

  SELECT generation_expression INTO v_total_expr
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agrimarket_orders'
    AND column_name='total_payable';

  SELECT generation_expression INTO v_payout_expr
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='agrimarket_orders'
    AND column_name='driver_delivery_payout';

  IF position('heavy_load_fee' in coalesce(v_total_expr,'')) = 0 THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_TOTAL_FORMULA_POSTCHECK_FAILED';
  END IF;

  IF position('heavy_load_fee' in coalesce(v_payout_expr,'')) = 0 THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_DRIVER_PAYOUT_POSTCHECK_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.agrimarket_orders'::regclass
      AND tgname='agrimarket_apply_heavy_load_fee_insert_trg'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.agrimarket_orders'::regclass
      AND tgname='agrimarket_apply_heavy_load_fee_update_trg'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.agrimarket_orders'::regclass
      AND tgname='agrimarket_evaluate_customer_reapproval_trg'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_TRIGGER_POSTCHECK_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_orders o
    WHERE o.confirmed_cargo_weight_basis IS NOT NULL
      AND o.assigned_driver_id IS NULL
      AND o.status IN (
        'producer_accepted','preparing','awaiting_customer_reapproval','ready_for_dispatch'
      )
      AND o.heavy_load_fee <> public.agrimarket_compute_heavy_load_fee_v1(
        o.confirmed_cargo_weight_basis,
        o.confirmed_cargo_weight_kg,
        o.confirmed_cargo_weight_band
      )
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_HEAVY_LOAD_CONFIRMED_ORDER_POSTCHECK_FAILED';
  END IF;
END;
$$;

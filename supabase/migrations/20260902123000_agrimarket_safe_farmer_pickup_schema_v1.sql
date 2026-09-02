-- AGRIMARKET SAFE FARMER PINNING AND READINESS V1
--
-- This migration closes two controlled-rollout risks:
--   1. staff-provisioned farmer accounts must carry verified pickup-access data;
--   2. newly provisioned farmers must start with accepting_orders = false.
--
-- The API independently reverse-geocodes the submitted pin and passes the
-- resolved municipality to the V2 RPC. The RPC requires it to match the
-- selected municipality and records the verification evidence in the audit
-- event. The raw one-time PIN is never persisted.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_producers') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_PRODUCERS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_products') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_PRODUCTS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_producer_credentials') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_CREDENTIALS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_farmer_applications') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_APPLICATIONS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_farmer_application_events') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_APPLICATION_EVENTS_MISSING';
  END IF;
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text)') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_PGCRYPTO_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_farmer_applications'
      AND column_name = 'onboarding_source'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_SAFE_PIN_PRECONDITION_PATCH_C_MISSING';
  END IF;
END;
$$;

ALTER TABLE public.agrimarket_producers
  ADD COLUMN IF NOT EXISTS pickup_motorcycle_accessible boolean,
  ADD COLUMN IF NOT EXISTS pickup_tricycle_accessible boolean,
  ADD COLUMN IF NOT EXISTS pickup_roadside_handoff_required boolean,
  ADD COLUMN IF NOT EXISTS pickup_driver_directions text;

ALTER TABLE public.agrimarket_farmer_applications
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS pickup_motorcycle_accessible boolean,
  ADD COLUMN IF NOT EXISTS pickup_tricycle_accessible boolean,
  ADD COLUMN IF NOT EXISTS pickup_roadside_handoff_required boolean,
  ADD COLUMN IF NOT EXISTS pickup_driver_directions text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_producers'::regclass
      AND conname = 'agrimarket_producers_pickup_access_chk'
  ) THEN
    ALTER TABLE public.agrimarket_producers
      ADD CONSTRAINT agrimarket_producers_pickup_access_chk
      CHECK (
        (pickup_motorcycle_accessible IS NULL
          AND pickup_tricycle_accessible IS NULL
          AND pickup_roadside_handoff_required IS NULL)
        OR coalesce(pickup_motorcycle_accessible, false)
        OR coalesce(pickup_tricycle_accessible, false)
        OR coalesce(pickup_roadside_handoff_required, false)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_producers'::regclass
      AND conname = 'agrimarket_producers_pickup_directions_chk'
  ) THEN
    ALTER TABLE public.agrimarket_producers
      ADD CONSTRAINT agrimarket_producers_pickup_directions_chk
      CHECK (
        pickup_driver_directions IS NULL
        OR length(trim(pickup_driver_directions)) BETWEEN 5 AND 1000
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_farmer_applications'::regclass
      AND conname = 'agrimarket_farmer_applications_verification_method_chk'
  ) THEN
    ALTER TABLE public.agrimarket_farmer_applications
      ADD CONSTRAINT agrimarket_farmer_applications_verification_method_chk
      CHECK (
        verification_method IS NULL
        OR length(trim(verification_method)) BETWEEN 2 AND 80
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_farmer_applications'::regclass
      AND conname = 'agrimarket_farmer_applications_pickup_access_chk'
  ) THEN
    ALTER TABLE public.agrimarket_farmer_applications
      ADD CONSTRAINT agrimarket_farmer_applications_pickup_access_chk
      CHECK (
        (pickup_motorcycle_accessible IS NULL
          AND pickup_tricycle_accessible IS NULL
          AND pickup_roadside_handoff_required IS NULL)
        OR coalesce(pickup_motorcycle_accessible, false)
        OR coalesce(pickup_tricycle_accessible, false)
        OR coalesce(pickup_roadside_handoff_required, false)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_farmer_applications'::regclass
      AND conname = 'agrimarket_farmer_applications_pickup_directions_chk'
  ) THEN
    ALTER TABLE public.agrimarket_farmer_applications
      ADD CONSTRAINT agrimarket_farmer_applications_pickup_directions_chk
      CHECK (
        pickup_driver_directions IS NULL
        OR length(trim(pickup_driver_directions)) BETWEEN 5 AND 1000
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.agrimarket_producers.pickup_motorcycle_accessible IS
  'Private operational fact verified by JRide staff: a motorcycle can reach the stored pickup pin.';
COMMENT ON COLUMN public.agrimarket_producers.pickup_tricycle_accessible IS
  'Private operational fact verified by JRide staff: a tricycle can reach and safely stop at the stored pickup pin.';
COMMENT ON COLUMN public.agrimarket_producers.pickup_roadside_handoff_required IS
  'Private operational fact verified by JRide staff: pickup requires a roadside meeting or handoff point.';
COMMENT ON COLUMN public.agrimarket_producers.pickup_driver_directions IS
  'Private driver-only road, landmark, access, and handoff directions. Never customer-visible.';

ALTER TABLE public.agrimarket_farmer_application_events
  DROP CONSTRAINT IF EXISTS agrimarket_farmer_application_events_type_chk;

ALTER TABLE public.agrimarket_farmer_application_events
  ADD CONSTRAINT agrimarket_farmer_application_events_type_chk
  CHECK (
    event_type IN (
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'withdrawn',
      'credential_reset',
      'credential_revoked',
      'ready_for_orders',
      'orders_paused',
      'profile_updated'
    )
  );

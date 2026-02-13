-- Phase 3.2: Stable realtime driver locations view (schema-flex)
-- Creates: public.dispatch_driver_locations_view
-- Strategy: pick first existing relation among known candidates, then create/replace view as SELECT * FROM that relation.
-- Reversible: DOWN drops the view.

-- =========================
-- UP
-- =========================
DO $$
DECLARE
  candidates text[] := ARRAY[
    'public.driver_locations',
    'public.driver_locations_view',
    'public.dispatch_driver_locations',
    'public.dispatch_driver_locations_view',
    'public.drivers_locations',
    'public.drivers_location',
    'public.driver_location',
    'public.admin_driver_locations'
  ];
  src text := NULL;
  i int;
BEGIN
  -- Find first existing relation
  FOR i IN 1..array_length(candidates, 1) LOOP
    IF to_regclass(candidates[i]) IS NOT NULL THEN
      src := candidates[i];
      EXIT;
    END IF;
  END LOOP;

  IF src IS NULL THEN
    RAISE EXCEPTION 'Phase 3.2: No realtime driver locations source found. Tried: %', candidates;
  END IF;

  EXECUTE format('CREATE OR REPLACE VIEW public.dispatch_driver_locations_view AS SELECT * FROM %s', src);

  -- Grants (safe to run even if roles vary)
  BEGIN
    EXECUTE 'GRANT SELECT ON public.dispatch_driver_locations_view TO anon';
  EXCEPTION WHEN undefined_object THEN
    -- ignore
  END;

  BEGIN
    EXECUTE 'GRANT SELECT ON public.dispatch_driver_locations_view TO authenticated';
  EXCEPTION WHEN undefined_object THEN
    -- ignore
  END;

  COMMENT ON VIEW public.dispatch_driver_locations_view IS
    'JRIDE Phase 3.2: Stable dispatch view pointing to realtime driver locations source: ' || src;

END $$;

-- =========================
-- DOWN (manual rollback)
-- =========================
-- DROP VIEW IF EXISTS public.dispatch_driver_locations_view;

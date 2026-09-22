BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- This records established catalog approval, not trading hours. Existing
-- approval is captured at migration time; no historical approval date is guessed.
ALTER TABLE public.agrimarket_producers
  ADD COLUMN catalog_approved_at timestamptz;
COMMENT ON COLUMN public.agrimarket_producers.catalog_approved_at IS
  'Established JRide catalog approval. Retained while closed or awaiting re-review; status still controls suspension. Backfilled existing approvals are recorded at migration time.';

UPDATE public.agrimarket_producers p
SET catalog_approved_at = clock_timestamp()
WHERE p.accepting_orders IS TRUE
   OR EXISTS (
     SELECT 1 FROM public.agrimarket_farmer_applications a
     JOIN public.agrimarket_farmer_application_events e ON e.application_id = a.id
     WHERE a.approved_producer_id = p.id AND a.status = 'approved'
       AND e.event_type = 'ready_for_orders'
   );

CREATE FUNCTION public.agrimarket_track_catalog_approval_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.catalog_approved_at IS NOT NULL THEN
    NEW.catalog_approved_at := OLD.catalog_approved_at;
  ELSIF NEW.status = 'active' AND NEW.accepting_orders IS TRUE THEN
    NEW.catalog_approved_at := clock_timestamp();
  ELSE
    -- Profile completion must not grant publication to a never-approved farm.
    NEW.catalog_approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_track_catalog_approval_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_track_catalog_approval_v1() TO service_role;
CREATE TRIGGER agrimarket_track_catalog_approval_trg
BEFORE INSERT OR UPDATE OF accepting_orders, status, catalog_approved_at
ON public.agrimarket_producers
FOR EACH ROW EXECUTE FUNCTION public.agrimarket_track_catalog_approval_v1();
COMMIT;

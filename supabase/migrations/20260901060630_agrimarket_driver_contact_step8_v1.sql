-- AGRIMARKET DRIVER CONTACT SNAPSHOT - STEP 8 V1
-- Scope: durable producer contact number for post-acceptance driver disclosure only.
-- No customer-facing identity changes, no Heavy Load pricing, no cargo compatibility, no UI work.

DO $$
BEGIN
  IF to_regclass('public.agrimarket_producers') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_PRECONDITION_PRODUCERS_MISSING';
  END IF;
  IF to_regclass('public.agrimarket_farmer_applications') IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_PRECONDITION_FARMER_APPLICATIONS_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_farmer_applications'
      AND column_name = 'approved_producer_id'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_PRECONDITION_APPROVED_PRODUCER_LINK_MISSING';
  END IF;
END;
$$;

ALTER TABLE public.agrimarket_producers
  ADD COLUMN IF NOT EXISTS contact_phone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agrimarket_producers'::regclass
      AND conname = 'agrimarket_producers_contact_phone_chk'
  ) THEN
    ALTER TABLE public.agrimarket_producers
      ADD CONSTRAINT agrimarket_producers_contact_phone_chk
      CHECK (
        contact_phone IS NULL
        OR length(trim(contact_phone)) BETWEEN 10 AND 30
      );
  END IF;
END;
$$;

WITH ranked_contact AS (
  SELECT DISTINCT ON (a.approved_producer_id)
    a.approved_producer_id AS producer_id,
    coalesce(
      nullif(trim(a.phone_display), ''),
      nullif(trim(a.phone_normalized), '')
    ) AS contact_phone
  FROM public.agrimarket_farmer_applications a
  WHERE a.status = 'approved'
    AND a.approved_producer_id IS NOT NULL
    AND coalesce(
      nullif(trim(a.phone_display), ''),
      nullif(trim(a.phone_normalized), '')
    ) IS NOT NULL
  ORDER BY
    a.approved_producer_id,
    a.reviewed_at DESC NULLS LAST,
    a.created_at DESC
)
UPDATE public.agrimarket_producers p
SET contact_phone = r.contact_phone,
    updated_at = clock_timestamp()
FROM ranked_contact r
WHERE p.id = r.producer_id
  AND p.contact_phone IS DISTINCT FROM r.contact_phone;

CREATE OR REPLACE FUNCTION public.agrimarket_sync_producer_contact_phone_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF new.status <> 'approved' OR new.approved_producer_id IS NULL THEN
    RETURN new;
  END IF;

  v_phone := coalesce(
    nullif(trim(new.phone_display), ''),
    nullif(trim(new.phone_normalized), '')
  );

  IF v_phone IS NULL THEN
    RETURN new;
  END IF;

  UPDATE public.agrimarket_producers
  SET contact_phone = v_phone,
      updated_at = clock_timestamp()
  WHERE id = new.approved_producer_id
    AND contact_phone IS DISTINCT FROM v_phone;

  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS agrimarket_farmer_application_sync_contact_phone
  ON public.agrimarket_farmer_applications;
CREATE TRIGGER agrimarket_farmer_application_sync_contact_phone
AFTER INSERT OR UPDATE OF status, approved_producer_id, phone_display, phone_normalized
ON public.agrimarket_farmer_applications
FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_sync_producer_contact_phone_v1();

REVOKE ALL ON FUNCTION public.agrimarket_sync_producer_contact_phone_v1()
  FROM public, anon, authenticated;

COMMENT ON COLUMN public.agrimarket_producers.contact_phone IS
  'Private producer contact number. Reveal only to the assigned driver after offer acceptance and to authorized staff.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agrimarket_producers'
      AND column_name = 'contact_phone'
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_CONTACT_PHONE_COLUMN_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.agrimarket_farmer_applications'::regclass
      AND tgname = 'agrimarket_farmer_application_sync_contact_phone'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_CONTACT_PHONE_TRIGGER_MISSING';
  END IF;

  IF EXISTS (
    WITH ranked_contact AS (
      SELECT DISTINCT ON (a.approved_producer_id)
        a.approved_producer_id AS producer_id,
        coalesce(
          nullif(trim(a.phone_display), ''),
          nullif(trim(a.phone_normalized), '')
        ) AS contact_phone
      FROM public.agrimarket_farmer_applications a
      WHERE a.status = 'approved'
        AND a.approved_producer_id IS NOT NULL
        AND coalesce(
          nullif(trim(a.phone_display), ''),
          nullif(trim(a.phone_normalized), '')
        ) IS NOT NULL
      ORDER BY
        a.approved_producer_id,
        a.reviewed_at DESC NULLS LAST,
        a.created_at DESC
    )
    SELECT 1
    FROM ranked_contact r
    JOIN public.agrimarket_producers p
      ON p.id = r.producer_id
    WHERE p.contact_phone IS DISTINCT FROM r.contact_phone
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_STEP8_LINKED_CONTACT_BACKFILL_INCOMPLETE';
  END IF;
END;
$$;

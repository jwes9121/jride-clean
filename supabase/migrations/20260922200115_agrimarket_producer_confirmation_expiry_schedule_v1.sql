BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $guard$
BEGIN
 IF to_regclass('cron.job') IS NULL THEN RAISE EXCEPTION 'pg_cron is required'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.agrimarket_expire_pending_orders_v1(timestamptz,integer)'::regprocedure) IS DISTINCT FROM 'b91e2db7f58560081fe30553d650445f' THEN RAISE EXCEPTION 'Expiry function changed; review before scheduling'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='agrimarket-producer-confirmation-expiry' OR command ILIKE '%agrimarket_expire_pending_orders_v1%') THEN RAISE EXCEPTION 'Pending-order expiry job already exists; do not duplicate'; END IF;
 IF has_function_privilege('anon','public.agrimarket_expire_pending_orders_v1(timestamptz,integer)','EXECUTE') OR has_function_privilege('authenticated','public.agrimarket_expire_pending_orders_v1(timestamptz,integer)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected browser expiry privilege'; END IF;
END;
$guard$;
-- Expire only overdue awaiting_producer orders. The function locks rows,
-- releases active reservations atomically and does not touch accepted orders.
-- No dependency on vendor/passenger polling, push delivery, or Vercel uptime.
SELECT cron.schedule(
 'agrimarket-producer-confirmation-expiry',
 '10 seconds',
 $job$SET statement_timeout='15s'; SELECT count(*) AS expired_orders FROM public.agrimarket_expire_pending_orders_v1(clock_timestamp(),200);$job$
);
COMMIT;

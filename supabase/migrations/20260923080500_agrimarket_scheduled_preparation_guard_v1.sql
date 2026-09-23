BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.agrimarket_guard_offer_order_v1()'::regprocedure) IS DISTINCT FROM '7bf8d15de8d687ff4ab9cec084e3e1ab' THEN
  RAISE EXCEPTION 'Existing AgriMarket offer guard changed; review before migration';
 END IF;
 IF EXISTS(SELECT 1 FROM public.agrimarket_orders WHERE fulfillment_mode='scheduled_harvest' AND (harvest_expected_start_at IS NULL OR harvest_expected_start_at>clock_timestamp()) AND status IN ('preparing','ready_for_dispatch','dispatching','driver_assigned')) THEN
  RAISE EXCEPTION 'Review already-dispatchable future reservations before migration';
 END IF;
END;
$preflight$;

CREATE FUNCTION public.agrimarket_guard_scheduled_preparation_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
 IF NEW.fulfillment_mode='scheduled_harvest'
    AND NEW.status IN ('preparing','ready_for_dispatch','dispatching','driver_assigned')
    AND (NEW.harvest_expected_start_at IS NULL OR NEW.harvest_expected_start_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'AGRIMARKET_SCHEDULE_NOT_READY' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.agrimarket_guard_scheduled_preparation_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_guard_scheduled_preparation_v1() TO service_role;
CREATE TRIGGER agrimarket_guard_scheduled_preparation_trg
BEFORE INSERT OR UPDATE OF status,fulfillment_mode,harvest_expected_start_at
ON public.agrimarket_orders FOR EACH ROW
EXECUTE FUNCTION public.agrimarket_guard_scheduled_preparation_v1();

CREATE OR REPLACE FUNCTION public.agrimarket_guard_offer_order_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $function$
declare o public.agrimarket_orders%rowtype;
begin
  if new.status='offered' then
    select * into o from public.agrimarket_orders where id=new.order_id for update;
    if not found or o.assigned_driver_id is not null or o.status not in ('preparing','ready_for_dispatch','dispatching') then
      raise exception 'AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE' using errcode='P0001';
    end if;
    -- Check the agreed calendar too, not just the mutable readiness status.
    if o.fulfillment_mode='scheduled_harvest' and
       (o.harvest_expected_start_at is null or o.harvest_expected_start_at>clock_timestamp()) then
      raise exception 'AGRIMARKET_SCHEDULE_NOT_READY' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$function$;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='agrimarket_farmer_complete_profile_v1') IS DISTINCT FROM 'ce2c41b4671fb13a0b7ae6ea0cea7e03' THEN
    RAISE EXCEPTION 'Profile baseline changed; review before applying';
  END IF;
END; $guard$;
ALTER TABLE public.agrimarket_producers ADD COLUMN vendor_name_locked_at timestamptz;
COMMENT ON COLUMN public.agrimarket_producers.vendor_name_locked_at IS 'Explicit farmer confirmation after successful profile save; existing/preassigned names are not auto-locked.';
CREATE FUNCTION public.agrimarket_guard_confirmed_farm_name_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF OLD.vendor_name_locked_at IS NOT NULL AND (
    NEW.vendor_name IS DISTINCT FROM OLD.vendor_name OR
    NEW.vendor_name_locked_at IS DISTINCT FROM OLD.vendor_name_locked_at
  ) THEN RAISE EXCEPTION 'AGRIMARKET_FARM_NAME_LOCKED' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.agrimarket_guard_confirmed_farm_name_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_guard_confirmed_farm_name_v1() TO service_role;
CREATE TRIGGER agrimarket_guard_confirmed_farm_name_trg BEFORE UPDATE OF vendor_name,vendor_name_locked_at
ON public.agrimarket_producers FOR EACH ROW EXECUTE FUNCTION public.agrimarket_guard_confirmed_farm_name_v1();

CREATE FUNCTION public.agrimarket_farmer_save_profile_v2(
 p_producer_id uuid,p_contact_name text,p_phone_display text,p_phone_normalized text,
 p_barangay text,p_vendor_name text,p_pickup_label text,p_pickup_lat double precision,p_pickup_lng double precision,
 p_pickup_motorcycle_accessible boolean,p_pickup_tricycle_accessible boolean,p_pickup_roadside_handoff_required boolean,
 p_pickup_driver_directions text,p_actor text,p_confirm_vendor_name boolean DEFAULT false,p_now timestamptz DEFAULT clock_timestamp()
) RETURNS TABLE(application_id uuid,producer_id uuid,access_code text,accepting_orders boolean,profile_completed_at timestamptz)
LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE v_producer public.agrimarket_producers%rowtype; v_result record;
 v_name text := regexp_replace(trim(coalesce(p_vendor_name,'')), '[[:space:]]+', ' ', 'g');
BEGIN
 SELECT * INTO v_producer FROM public.agrimarket_producers WHERE id=p_producer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_ACTIVE' USING ERRCODE='P0001'; END IF;
 IF v_producer.vendor_name_locked_at IS NOT NULL AND v_name IS DISTINCT FROM v_producer.vendor_name THEN
   RAISE EXCEPTION 'AGRIMARKET_FARM_NAME_LOCKED' USING ERRCODE='P0001';
 END IF;
 IF v_producer.vendor_name_locked_at IS NULL AND p_confirm_vendor_name IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'AGRIMARKET_FARM_NAME_CONFIRMATION_REQUIRED' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO STRICT v_result FROM public.agrimarket_farmer_complete_profile_v1(
  p_producer_id,p_contact_name,p_phone_display,p_phone_normalized,p_barangay,v_name,p_pickup_label,
  p_pickup_lat,p_pickup_lng,p_pickup_motorcycle_accessible,p_pickup_tricycle_accessible,
  p_pickup_roadside_handoff_required,p_pickup_driver_directions,p_actor,p_now);
 IF v_producer.vendor_name_locked_at IS NULL THEN
   UPDATE public.agrimarket_producers SET vendor_name_locked_at=clock_timestamp() WHERE id=p_producer_id;
   INSERT INTO public.agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
   VALUES(v_result.application_id,'profile_updated','applicant',v_result.access_code,
    jsonb_build_object('action','farm_name_confirmed_and_locked','producer_id',p_producer_id,'vendor_name',v_name),clock_timestamp());
 END IF;
 RETURN QUERY SELECT v_result.application_id,v_result.producer_id,v_result.access_code,v_result.accepting_orders,v_result.profile_completed_at;
END; $function$;
REVOKE ALL ON FUNCTION public.agrimarket_farmer_save_profile_v2(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_save_profile_v2(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,boolean,timestamptz) TO service_role;
COMMIT;

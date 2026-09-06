-- Public and assisted applications share verified pickup/setup readiness rules.
-- The API supplies authenticated staff identity and freshly resolved pin facts.
alter table public.agrimarket_farmer_applications add column application_details jsonb not null default '{}'::jsonb;
alter table public.agrimarket_farmer_applications drop constraint agrimarket_farmer_applications_status_chk;
alter table public.agrimarket_farmer_applications add constraint agrimarket_farmer_applications_status_chk
  check(status in ('submitted','under_review','correction_requested','approved','rejected','withdrawn'));
drop index public.agrimarket_farmer_applications_one_open_phone_uidx;
create unique index agrimarket_farmer_applications_one_open_phone_uidx on public.agrimarket_farmer_applications(phone_normalized)
  where status in ('submitted','under_review','correction_requested');
alter table public.agrimarket_farmer_application_events drop constraint agrimarket_farmer_application_events_type_chk;
alter table public.agrimarket_farmer_application_events add constraint agrimarket_farmer_application_events_type_chk
  check(event_type in ('submitted','under_review','correction_requested','resubmitted','approved','rejected','withdrawn','credential_reset','credential_revoked','ready_for_orders','orders_paused','profile_updated'));

create function public.agrimarket_submit_farmer_application_v2(
  p_application_code text, p_payload jsonb, p_actor text, p_actor_role text,
  p_existing_code text default null, p_now timestamptz default clock_timestamp()
) returns public.agrimarket_farmer_applications
language plpgsql security invoker set search_path=public as $$
declare
  a public.agrimarket_farmer_applications%rowtype;
  phone text := p_payload->>'phone_normalized';
  details jsonb := p_payload->'application_details';
  staff boolean := p_actor_role in ('admin','dispatcher');
  event_name text := 'submitted';
begin
  if coalesce(p_actor_role,'') not in ('applicant','admin','dispatcher') or length(trim(coalesce(p_actor,''))) < 2 then raise exception 'AGRIMARKET_APPLICATION_ACTOR_REQUIRED'; end if;
  if phone is null or phone !~ '^\+639[0-9]{9}$' then raise exception 'AGRIMARKET_APPLICANT_PHONE_INVALID'; end if;
  if coalesce(details->>'farmer_consent','') <> 'true' or coalesce(details->>'pin_confirmed','') <> 'true' then raise exception 'AGRIMARKET_FARMER_CONSENT_AND_PIN_REQUIRED'; end if;
  if coalesce(details->>'resolved_town','') <> coalesce(p_payload->>'town','') or coalesce(p_payload->>'town','') not in ('Lagawe','Hingyon','Banaue','Lamut','Kiangan') then raise exception 'AGRIMARKET_PICKUP_TOWN_MISMATCH'; end if;
  if coalesce(p_payload->>'pickup_lat','')='' or coalesce(p_payload->>'pickup_lng','')='' then raise exception 'AGRIMARKET_PRIVATE_PICKUP_PIN_REQUIRED'; end if;
  if not coalesce((p_payload->>'pickup_motorcycle_accessible')::boolean,false) and not coalesce((p_payload->>'pickup_tricycle_accessible')::boolean,false) then raise exception 'AGRIMARKET_PICKUP_ACCESS_REQUIRED'; end if;
  if length(trim(coalesce(p_payload->>'pickup_driver_directions',''))) not between 5 and 1000 then raise exception 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p_payload->'intended_products','[]')) < 1 then raise exception 'AGRIMARKET_INTENDED_PRODUCTS_REQUIRED'; end if;
  if (details->>'submitted_by'='staff') is distinct from staff then raise exception 'AGRIMARKET_STAFF_ASSISTANCE_IDENTITY_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_staff_verified:'||phone,0));
  if nullif(p_existing_code,'') is not null then
    select * into a from agrimarket_farmer_applications where application_code=p_existing_code and phone_normalized=phone for update;
    if a.id is null or (not staff and (a.application_details->>'version' is distinct from '2' or a.application_code !~ '^AGAPP-[0-9]{6}-[A-F0-9]{32}$')) then raise exception 'AGRIMARKET_APPLICATION_NOT_FOUND'; end if;
    if a.status='submitted' and a.application_details->>'request_id'=details->>'request_id' then return a; end if;
    if a.status <> 'correction_requested' then raise exception 'AGRIMARKET_APPLICATION_NOT_AWAITING_CORRECTION'; end if;
    event_name := 'resubmitted';
  else
    select * into a from agrimarket_farmer_applications where phone_normalized=phone and status in ('submitted','under_review','correction_requested','approved') limit 1 for update;
    if a.id is not null then
      if a.application_details->>'request_id'=details->>'request_id' and length(coalesce(details->>'request_id',''))=36 then return a; end if;
      raise exception 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED';
    end if;
    if p_application_code !~ '^AGAPP-[0-9]{6}-[A-F0-9]{32}$' then raise exception 'AGRIMARKET_APPLICATION_CODE_INVALID'; end if;
    insert into agrimarket_farmer_applications(application_code,applicant_name,phone_normalized,town,pickup_label,pickup_lat,pickup_lng)
      values(p_application_code,p_payload->>'applicant_name',phone,p_payload->>'town',p_payload->>'pickup_label',(p_payload->>'pickup_lat')::double precision,(p_payload->>'pickup_lng')::double precision) returning * into a;
  end if;
  update agrimarket_farmer_applications set
    applicant_name=p_payload->>'applicant_name',phone_display=p_payload->>'phone_display',town=p_payload->>'town',barangay=p_payload->>'barangay',
    pickup_label=p_payload->>'pickup_label',pickup_lat=(p_payload->>'pickup_lat')::double precision,pickup_lng=(p_payload->>'pickup_lng')::double precision,
    pickup_motorcycle_accessible=(p_payload->>'pickup_motorcycle_accessible')::boolean,pickup_tricycle_accessible=(p_payload->>'pickup_tricycle_accessible')::boolean,
    pickup_roadside_handoff_required=(p_payload->>'pickup_roadside_handoff_required')::boolean,pickup_driver_directions=p_payload->>'pickup_driver_directions',
    intended_products=array(select jsonb_array_elements_text(p_payload->'intended_products')),identity_type=p_payload->>'identity_type',identity_reference_last4=p_payload->>'identity_reference_last4',applicant_note=p_payload->>'applicant_note',
    application_details=details||jsonb_build_object('version',2,'submitted_actor',p_actor,'submitted_actor_role',p_actor_role,'submitted_at',p_now),
    status='submitted',review_note=null,reviewed_at=null,reviewed_by=null
    where id=a.id returning * into a;
  insert into agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
    values(a.id,event_name,case when staff then 'staff' else 'applicant' end,p_actor,jsonb_build_object('town',a.town,'submission',a.application_details),p_now);
  return a;
end; $$;
revoke all on function public.agrimarket_submit_farmer_application_v2(text,jsonb,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_submit_farmer_application_v2(text,jsonb,text,text,text,timestamptz) to service_role;

create function public.agrimarket_review_farmer_application_v2(
  p_application_id uuid, p_decision text, p_actor text, p_actor_role text, p_review_note text default null,
  p_access_code text default null, p_pin text default null, p_verified_pin jsonb default null,
  p_verification_confirmed boolean default false, p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path=public,extensions as $$
declare
  a public.agrimarket_farmer_applications%rowtype; producer uuid; new_status text;
begin
  if coalesce(p_actor_role,'') not in ('admin','dispatcher') or length(trim(coalesce(p_actor,''))) < 2 then raise exception 'AGRIMARKET_STAFF_AUTH_REQUIRED'; end if;
  if p_decision not in ('under_review','request_correction','approve','reject') then raise exception 'AGRIMARKET_REVIEW_DECISION_INVALID'; end if;
  if p_decision <> 'under_review' and p_actor_role <> 'admin' then raise exception 'AGRIMARKET_ADMIN_REQUIRED'; end if;
  select * into a from agrimarket_farmer_applications where id=p_application_id for update;
  if a.id is null then raise exception 'AGRIMARKET_APPLICATION_NOT_FOUND'; end if;
  if a.status in ('approved','rejected','withdrawn') then raise exception 'AGRIMARKET_APPLICATION_ALREADY_FINAL'; end if;
  if p_decision in ('request_correction','reject','approve') and length(trim(coalesce(p_review_note,''))) < 5 then raise exception 'AGRIMARKET_REVIEW_NOTE_REQUIRED'; end if;
  if p_decision='approve' then
    if a.status='correction_requested' then raise exception 'AGRIMARKET_CORRECTION_REQUIRED_BEFORE_APPROVAL'; end if;
    if not coalesce(p_verification_confirmed,false) or a.application_details->>'farmer_consent' is distinct from 'true' or a.application_details->>'version' is distinct from '2' then raise exception 'AGRIMARKET_FARMER_VERIFICATION_REQUIRED'; end if;
    if coalesce(p_verified_pin->>'town','')<>a.town or (p_verified_pin->>'lat')::double precision is distinct from a.pickup_lat or (p_verified_pin->>'lng')::double precision is distinct from a.pickup_lng then raise exception 'AGRIMARKET_PICKUP_TOWN_MISMATCH'; end if;
    if not coalesce(a.pickup_motorcycle_accessible,false) and not coalesce(a.pickup_tricycle_accessible,false) then raise exception 'AGRIMARKET_PICKUP_ACCESS_REQUIRED'; end if;
    if coalesce(p_access_code,'') !~ '^AGF-[A-Z0-9]{6,12}$' or coalesce(p_pin,'') !~ '^[0-9]{6}$' then raise exception 'AGRIMARKET_CREDENTIAL_INVALID'; end if;
    insert into agrimarket_producers(contact_name,contact_phone,town,barangay,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions)
      values(a.applicant_name,a.phone_normalized,a.town,a.barangay,a.pickup_label,a.pickup_lat,a.pickup_lng,'active',false,a.pickup_motorcycle_accessible,a.pickup_tricycle_accessible,a.pickup_roadside_handoff_required,a.pickup_driver_directions) returning id into producer;
    insert into agrimarket_producer_credentials(producer_id,access_code,pin_hash,created_by)
      values(producer,p_access_code,extensions.crypt(p_pin,extensions.gen_salt('bf',12)),p_actor);
    new_status:='approved';
  else new_status:=case p_decision when 'request_correction' then 'correction_requested' when 'reject' then 'rejected' else 'under_review' end;
  end if;
  update agrimarket_farmer_applications set status=new_status,review_note=nullif(trim(p_review_note),''),reviewed_at=p_now,reviewed_by=p_actor,
    approved_producer_id=producer,verification_method=case when producer is not null then 'admin_review' else verification_method end,
    application_details=case when producer is not null then application_details||jsonb_build_object('verification_confirmed',true,'approved_pin',p_verified_pin) else application_details end
    where id=a.id;
  insert into agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
    values(a.id,new_status,'staff',p_actor,jsonb_build_object('review_note',p_review_note,'actor_role',p_actor_role,'producer_id',producer,'accepting_orders',false),p_now);
  return jsonb_build_object('application_id',a.id,'application_code',a.application_code,'status',new_status,'producer_id',producer,'accepting_orders',false);
end; $$;
revoke all on function public.agrimarket_review_farmer_application_v2(uuid,text,text,text,text,text,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_review_farmer_application_v2(uuid,text,text,text,text,text,text,jsonb,boolean,timestamptz) to service_role;
-- The old public approval RPC opened ordering immediately and omitted pickup checks.
revoke execute on function public.agrimarket_review_farmer_application_v1(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;

-- Reuse the existing audited readiness/profile controls for reviewed applications.
CREATE OR REPLACE FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  p_producer_id uuid,
  p_ready boolean,
  p_actor text,
  p_actor_role text,
  p_note text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  producer_id uuid,
  producer_status text,
  accepting_orders boolean,
  credential_status text,
  active_available_product_count integer,
  action text,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor text := trim(coalesce(p_actor, ''));
  v_role text := lower(trim(coalesce(p_actor_role, '')));
  v_note text := trim(coalesce(p_note, ''));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_producer public.agrimarket_producers%rowtype;
  v_credential public.agrimarket_producer_credentials%rowtype;
  v_application_id uuid;
  v_product_count integer := 0;
  v_action text;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'AGRIMARKET_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_producer_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_actor) < 2 OR length(v_actor) > 200 THEN
    RAISE EXCEPTION 'AGRIMARKET_READINESS_ACTOR_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_note) < 5 OR length(v_note) > 500 THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_NOTE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_producer
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id
  FOR UPDATE;

  IF v_producer.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.id INTO v_application_id
  FROM public.agrimarket_farmer_applications a
  WHERE a.approved_producer_id = p_producer_id
    AND (a.onboarding_source = 'staff_verified' OR (a.onboarding_source = 'public_application' AND a.application_details->>'verification_confirmed' = 'true'))
    AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_application_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_VERIFIED_APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.* INTO v_credential
  FROM public.agrimarket_producer_credentials c
  WHERE c.producer_id = p_producer_id
  FOR UPDATE;

  IF v_credential.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_CREDENTIAL_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_product_count
  FROM public.agrimarket_products product
  WHERE product.producer_id = p_producer_id
    AND product.is_active = true
    AND product.listed_quantity > product.reserved_quantity + product.sold_quantity;

  IF coalesce(p_ready, false) THEN
    IF v_producer.status <> 'active' THEN
      RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    IF v_credential.status <> 'active' THEN
      RAISE EXCEPTION 'AGRIMARKET_CREDENTIAL_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    IF NOT coalesce(v_producer.pickup_motorcycle_accessible, false)
       AND NOT coalesce(v_producer.pickup_tricycle_accessible, false) THEN
      RAISE EXCEPTION 'AGRIMARKET_PICKUP_ACCESS_NOT_VERIFIED' USING ERRCODE = 'P0001';
    END IF;
    IF length(trim(coalesce(v_producer.pickup_driver_directions, ''))) < 5 THEN
      RAISE EXCEPTION 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF v_product_count < 1 THEN
      RAISE EXCEPTION 'AGRIMARKET_FARMER_NO_ACTIVE_PRODUCT' USING ERRCODE = 'P0001';
    END IF;
    v_action := 'ready_for_orders';
  ELSE
    v_action := 'orders_paused';
  END IF;

  UPDATE public.agrimarket_producers p
  SET accepting_orders = coalesce(p_ready, false),
      updated_at = v_now
  WHERE p.id = p_producer_id;

  INSERT INTO public.agrimarket_farmer_application_events(
    application_id,
    event_type,
    actor_type,
    actor,
    details,
    created_at
  ) VALUES (
    v_application_id,
    v_action,
    'staff',
    v_actor,
    jsonb_build_object(
      'producer_id', p_producer_id,
      'accepting_orders', coalesce(p_ready, false),
      'active_available_product_count', v_product_count,
      'note', v_note
    ),
    v_now
  );

  RETURN QUERY
  SELECT
    p.id,
    p.status,
    p.accepting_orders,
    c.status,
    v_product_count,
    v_action,
    v_now
  FROM public.agrimarket_producers p
  JOIN public.agrimarket_producer_credentials c ON c.producer_id = p.id
  WHERE p.id = p_producer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_set_verified_farmer_readiness_v1(
  uuid,boolean,text,text,text,timestamptz
) IS
  'Admin-only readiness gate for staff-verified farmers. Enabling orders requires an active credential, verified pickup access, private driver directions, and at least one active product with available quantity.';

DO $$
DECLARE v_readiness oid;
BEGIN
  v_readiness := to_regprocedure(
    'public.agrimarket_admin_set_verified_farmer_readiness_v1(uuid,boolean,text,text,text,timestamp with time zone)'
  )::oid;
  IF v_readiness IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_readiness, 'EXECUTE')
     OR has_function_privilege('authenticated', v_readiness, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_readiness, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_READINESS_PRIVILEGES_INVALID';
  END IF;
END;
$$;

-- Reuse the existing audited readiness/profile controls for reviewed applications.
CREATE OR REPLACE FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  p_producer_id uuid,
  p_contact_name text,
  p_phone_display text,
  p_phone_normalized text,
  p_town text,
  p_barangay text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_pickup_motorcycle_accessible boolean,
  p_pickup_tricycle_accessible boolean,
  p_pickup_roadside_handoff_required boolean,
  p_pickup_driver_directions text,
  p_resolved_town text,
  p_change_reason text,
  p_actor text,
  p_actor_role text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(
  producer_id uuid,
  application_id uuid,
  accepting_orders boolean,
  orders_paused boolean,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor text := trim(coalesce(p_actor, ''));
  v_role text := lower(trim(coalesce(p_actor_role, '')));
  v_reason text := trim(coalesce(p_change_reason, ''));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_contact_name text := regexp_replace(trim(coalesce(p_contact_name, '')), '[[:space:]]+', ' ', 'g');
  v_phone_display text := trim(coalesce(p_phone_display, ''));
  v_phone_normalized text := trim(coalesce(p_phone_normalized, ''));
  v_phone_digits text;
  v_phone_display_digits text;
  v_town text := trim(coalesce(p_town, ''));
  v_resolved_town text := trim(coalesce(p_resolved_town, ''));
  v_barangay text := nullif(regexp_replace(trim(coalesce(p_barangay, '')), '[[:space:]]+', ' ', 'g'), '');
  v_pickup_label text := regexp_replace(trim(coalesce(p_pickup_label, '')), '[[:space:]]+', ' ', 'g');
  v_pickup_directions text := trim(coalesce(p_pickup_driver_directions, ''));
  v_producer public.agrimarket_producers%rowtype;
  v_application public.agrimarket_farmer_applications%rowtype;
  v_location_or_access_changed boolean := false;
  v_orders_paused boolean := false;
BEGIN
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'AGRIMARKET_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_producer_id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_actor) < 2 OR length(v_actor) > 200 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_ACTOR_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_reason) < 5 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'AGRIMARKET_PROFILE_CHANGE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_contact_name) < 2 OR length(v_contact_name) > 120 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_NAME_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_phone_normalized !~ '^\+639[0-9]{9}$' THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_phone_display = '' THEN
    v_phone_display := v_phone_normalized;
  END IF;
  IF length(v_phone_display) < 10 OR length(v_phone_display) > 30 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_DISPLAY_INVALID' USING ERRCODE = 'P0001';
  END IF;

  v_phone_digits := regexp_replace(v_phone_normalized, '[^0-9]', '', 'g');
  v_phone_display_digits := regexp_replace(v_phone_display, '[^0-9]', '', 'g');
  IF v_phone_display_digits NOT IN (
    v_phone_digits,
    substring(v_phone_digits FROM 3),
    '0' || substring(v_phone_digits FROM 3)
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PHONE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_town NOT IN ('Lagawe', 'Hingyon', 'Kiangan', 'Banaue', 'Lamut') THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_TOWN_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_resolved_town <> v_town THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_TOWN_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF v_barangay IS NOT NULL AND length(v_barangay) > 100 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_pickup_label) < 2 OR length(v_pickup_label) > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lat < -90 OR p_pickup_lat > 90
     OR p_pickup_lng IS NULL OR p_pickup_lng < -180 OR p_pickup_lng > 180 THEN
    RAISE EXCEPTION 'AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF NOT coalesce(p_pickup_motorcycle_accessible, false)
     AND NOT coalesce(p_pickup_tricycle_accessible, false) THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_ACCESS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_pickup_directions) < 5 OR length(v_pickup_directions) > 1000 THEN
    RAISE EXCEPTION 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_producer
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id
  FOR UPDATE;

  IF v_producer.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_PRODUCER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT a.* INTO v_application
  FROM public.agrimarket_farmer_applications a
  WHERE a.approved_producer_id = p_producer_id
    AND (a.onboarding_source = 'staff_verified' OR (a.onboarding_source = 'public_application' AND a.application_details->>'verification_confirmed' = 'true'))
    AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_application.id IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_STAFF_VERIFIED_APPLICATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('agrimarket_staff_verified:' || v_phone_normalized, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_farmer_applications a
    WHERE a.id <> v_application.id
      AND a.phone_normalized = v_phone_normalized
      AND a.status IN ('submitted', 'under_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agrimarket_producers p
    WHERE p.id <> p_producer_id
      AND regexp_replace(coalesce(p.contact_phone, ''), '[^0-9]', '', 'g') IN (
        v_phone_digits,
        substring(v_phone_digits FROM 3),
        '0' || substring(v_phone_digits FROM 3)
      )
  ) THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' USING ERRCODE = 'P0001';
  END IF;

  v_location_or_access_changed :=
    v_producer.town IS DISTINCT FROM v_town
    OR coalesce(v_producer.barangay, '') IS DISTINCT FROM coalesce(v_barangay, '')
    OR v_producer.pickup_label IS DISTINCT FROM v_pickup_label
    OR v_producer.pickup_lat IS DISTINCT FROM p_pickup_lat
    OR v_producer.pickup_lng IS DISTINCT FROM p_pickup_lng
    OR coalesce(v_producer.pickup_motorcycle_accessible, false) IS DISTINCT FROM coalesce(p_pickup_motorcycle_accessible, false)
    OR coalesce(v_producer.pickup_tricycle_accessible, false) IS DISTINCT FROM coalesce(p_pickup_tricycle_accessible, false)
    OR coalesce(v_producer.pickup_roadside_handoff_required, false) IS DISTINCT FROM coalesce(p_pickup_roadside_handoff_required, false)
    OR coalesce(v_producer.pickup_driver_directions, '') IS DISTINCT FROM v_pickup_directions;

  v_orders_paused := v_location_or_access_changed AND coalesce(v_producer.accepting_orders, false);

  UPDATE public.agrimarket_producers p
  SET contact_name = v_contact_name,
      contact_phone = v_phone_display,
      town = v_town,
      barangay = v_barangay,
      pickup_label = v_pickup_label,
      pickup_lat = p_pickup_lat,
      pickup_lng = p_pickup_lng,
      pickup_motorcycle_accessible = p_pickup_motorcycle_accessible,
      pickup_tricycle_accessible = p_pickup_tricycle_accessible,
      pickup_roadside_handoff_required = p_pickup_roadside_handoff_required,
      pickup_driver_directions = v_pickup_directions,
      accepting_orders = CASE
        WHEN v_location_or_access_changed THEN false
        ELSE p.accepting_orders
      END,
      updated_at = v_now
  WHERE p.id = p_producer_id;

  UPDATE public.agrimarket_farmer_applications a
  SET applicant_name = v_contact_name,
      phone_normalized = v_phone_normalized,
      phone_display = v_phone_display,
      town = v_town,
      barangay = v_barangay,
      pickup_label = v_pickup_label,
      pickup_lat = p_pickup_lat,
      pickup_lng = p_pickup_lng,
      pickup_motorcycle_accessible = p_pickup_motorcycle_accessible,
      pickup_tricycle_accessible = p_pickup_tricycle_accessible,
      pickup_roadside_handoff_required = p_pickup_roadside_handoff_required,
      pickup_driver_directions = v_pickup_directions,
      updated_at = v_now
  WHERE a.id = v_application.id;

  INSERT INTO public.agrimarket_farmer_application_events(
    application_id,
    event_type,
    actor_type,
    actor,
    details,
    created_at
  ) VALUES (
    v_application.id,
    'profile_updated',
    'staff',
    v_actor,
    jsonb_build_object(
      'producer_id', p_producer_id,
      'reason', v_reason,
      'location_or_access_changed', v_location_or_access_changed,
      'orders_paused', v_orders_paused,
      'before', jsonb_build_object(
        'contact_name', v_producer.contact_name,
        'contact_phone', v_producer.contact_phone,
        'town', v_producer.town,
        'barangay', v_producer.barangay,
        'pickup_label', v_producer.pickup_label,
        'pickup_lat', v_producer.pickup_lat,
        'pickup_lng', v_producer.pickup_lng,
        'pickup_motorcycle_accessible', v_producer.pickup_motorcycle_accessible,
        'pickup_tricycle_accessible', v_producer.pickup_tricycle_accessible,
        'pickup_roadside_handoff_required', v_producer.pickup_roadside_handoff_required,
        'pickup_driver_directions', v_producer.pickup_driver_directions,
        'accepting_orders', v_producer.accepting_orders
      ),
      'after', jsonb_build_object(
        'contact_name', v_contact_name,
        'contact_phone', v_phone_display,
        'phone_normalized', v_phone_normalized,
        'town', v_town,
        'barangay', v_barangay,
        'pickup_label', v_pickup_label,
        'pickup_lat', p_pickup_lat,
        'pickup_lng', p_pickup_lng,
        'pickup_motorcycle_accessible', p_pickup_motorcycle_accessible,
        'pickup_tricycle_accessible', p_pickup_tricycle_accessible,
        'pickup_roadside_handoff_required', p_pickup_roadside_handoff_required,
        'pickup_driver_directions', v_pickup_directions,
        'accepting_orders', CASE
          WHEN v_location_or_access_changed THEN false
          ELSE v_producer.accepting_orders
        END
      )
    ),
    v_now
  );

  RETURN QUERY
  SELECT
    p.id,
    v_application.id,
    p.accepting_orders,
    v_orders_paused,
    v_now
  FROM public.agrimarket_producers p
  WHERE p.id = p_producer_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) TO service_role;

COMMENT ON FUNCTION public.agrimarket_admin_update_verified_farmer_profile_v1(
  uuid,text,text,text,text,text,text,double precision,double precision,
  boolean,boolean,boolean,text,text,text,text,text,timestamptz
) IS
  'Admin-only audited correction for staff-verified farmer contact and private pickup data. Location or access changes automatically pause new orders until readiness is approved again.';

DO $$
DECLARE v_profile_update oid;
BEGIN
  v_profile_update := to_regprocedure(
    'public.agrimarket_admin_update_verified_farmer_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,text,text,text,timestamp with time zone)'
  )::oid;
  IF v_profile_update IS NULL THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PROFILE_UPDATE_INSTALL_FAILED';
  END IF;
  IF has_function_privilege('anon', v_profile_update, 'EXECUTE')
     OR has_function_privilege('authenticated', v_profile_update, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_profile_update, 'EXECUTE') THEN
    RAISE EXCEPTION 'AGRIMARKET_FARMER_PROFILE_UPDATE_PRIVILEGES_INVALID';
  END IF;
END;
$$;

-- Reactivation restores login; readiness remains a separate administrator action.
create or replace function public.agrimarket_admin_manage_farmer_access_v1(
  p_producer_id uuid,
  p_action text,
  p_actor text,
  p_reason text default null,
  p_new_pin text default null,
  p_now timestamptz default clock_timestamp()
)
returns table(
  producer_id uuid,
  producer_status text,
  accepting_orders boolean,
  credential_status text,
  access_code text,
  action text,
  active_order_count integer
)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_producer public.agrimarket_producers%rowtype;
  v_credential public.agrimarket_producer_credentials%rowtype;
  v_active_orders integer := 0;
begin
  if p_producer_id is null then
    raise exception 'AGRIMARKET_PRODUCER_ID_REQUIRED' using errcode='P0001';
  end if;

  if v_action not in ('reset_pin','revoke_access','suspend_farmer','reactivate_farmer') then
    raise exception 'AGRIMARKET_FARMER_ACCESS_ACTION_INVALID' using errcode='P0001';
  end if;

  if v_action in ('revoke_access','suspend_farmer') and v_reason is null then
    raise exception 'AGRIMARKET_FARMER_ACCESS_REASON_REQUIRED' using errcode='P0001';
  end if;

  if v_action = 'reset_pin' and (p_new_pin is null or p_new_pin !~ '^[0-9]{6}$') then
    raise exception 'AGRIMARKET_NEW_PIN_INVALID' using errcode='P0001';
  end if;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id = p_producer_id
  for update;

  if v_producer.id is null then
    raise exception 'AGRIMARKET_PRODUCER_NOT_FOUND' using errcode='P0001';
  end if;

  select c.* into v_credential
  from public.agrimarket_producer_credentials c
  where c.producer_id = p_producer_id
  for update;

  if v_credential.id is null then
    raise exception 'AGRIMARKET_PRODUCER_CREDENTIAL_NOT_FOUND' using errcode='P0001';
  end if;

  select count(*)::integer into v_active_orders
  from public.agrimarket_orders o
  where o.producer_id = p_producer_id
    and o.status not in ('completed','cancelled','producer_rejected','producer_timeout');

  if v_action = 'reset_pin' then
    update public.agrimarket_producer_credentials c
    set pin_hash = crypt(p_new_pin, gen_salt('bf')),
        status = 'active',
        failed_attempts = 0,
        locked_until = null,
        updated_at = p_now
    where c.id = v_credential.id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'pin_reset',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('access_code',v_credential.access_code),p_now
    );

  elsif v_action = 'revoke_access' then
    update public.agrimarket_producer_credentials c
    set status = 'revoked',
        failed_attempts = 0,
        locked_until = null,
        updated_at = p_now
    where c.id = v_credential.id;

    update public.agrimarket_producers p
    set status = 'suspended',
        accepting_orders = false,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'access_revoked',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('active_order_count',v_active_orders),p_now
    );

  elsif v_action = 'suspend_farmer' then
    update public.agrimarket_producers p
    set status = 'suspended',
        accepting_orders = false,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'farmer_suspended',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('credential_status',v_credential.status,'active_order_count',v_active_orders),p_now
    );

  else
    if v_credential.status <> 'active' then
      raise exception 'AGRIMARKET_CREDENTIAL_NOT_ACTIVE_RESET_PIN_REQUIRED' using errcode='P0001';
    end if;

    update public.agrimarket_producers p
    set status = 'active',
        accepting_orders = false,
        updated_at = p_now
    where p.id = p_producer_id;

    insert into public.agrimarket_producer_access_events(
      producer_id,event_type,actor,reason,details,created_at
    ) values (
      p_producer_id,'farmer_reactivated',nullif(trim(coalesce(p_actor,'')),''),v_reason,
      jsonb_build_object('credential_status',v_credential.status),p_now
    );
  end if;

  return query
  select p.id,
         p.status,
         p.accepting_orders,
         c.status,
         c.access_code,
         v_action,
         v_active_orders
  from public.agrimarket_producers p
  join public.agrimarket_producer_credentials c on c.producer_id=p.id
  where p.id=p_producer_id;
end;
$$;

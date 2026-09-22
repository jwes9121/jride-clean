BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='agrimarket_farmer_complete_profile_v1') IS DISTINCT FROM '210a4b6a53467ca6b0561e108f1bada3' THEN
    RAISE EXCEPTION 'Farmer profile function changed; review before applying availability migration';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.agrimarket_farmer_complete_profile_v1(p_producer_id uuid, p_contact_name text, p_phone_display text, p_phone_normalized text, p_barangay text, p_vendor_name text, p_pickup_label text, p_pickup_lat double precision, p_pickup_lng double precision, p_pickup_motorcycle_accessible boolean, p_pickup_tricycle_accessible boolean, p_pickup_roadside_handoff_required boolean, p_pickup_driver_directions text, p_actor text, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS TABLE(application_id uuid, producer_id uuid, access_code text, accepting_orders boolean, profile_completed_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_producer public.agrimarket_producers%rowtype;
  v_credential public.agrimarket_producer_credentials%rowtype;
  v_application_id uuid;
  v_application_code text;
  v_name text := regexp_replace(trim(coalesce(p_contact_name,'')), '[[:space:]]+', ' ', 'g');
  v_phone_display text := trim(coalesce(p_phone_display,''));
  v_phone_normalized text := trim(coalesce(p_phone_normalized,''));
  v_barangay text := regexp_replace(trim(coalesce(p_barangay,'')), '[[:space:]]+', ' ', 'g');
  v_vendor_name text := regexp_replace(trim(coalesce(p_vendor_name,'')), '[[:space:]]+', ' ', 'g');
  v_pickup_label text := regexp_replace(trim(coalesce(p_pickup_label,'')), '[[:space:]]+', ' ', 'g');
  v_directions text := trim(coalesce(p_pickup_driver_directions,''));
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_phone_digits text;
  v_old_phone_digits text;
  v_review_fields text[];
  v_next_ready boolean;
  v_next_open boolean;
begin
  if p_producer_id is null then
    raise exception 'AGRIMARKET_PRODUCER_ID_REQUIRED' using errcode='P0001';
  end if;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id=p_producer_id
  for update;

  if v_producer.id is null or v_producer.status <> 'active' then
    raise exception 'AGRIMARKET_PRODUCER_NOT_ACTIVE' using errcode='P0001';
  end if;

  select c.* into v_credential
  from public.agrimarket_producer_credentials c
  where c.producer_id=p_producer_id
  for update;

  if v_credential.id is null or v_credential.status <> 'active' then
    raise exception 'AGRIMARKET_CREDENTIAL_NOT_ACTIVE' using errcode='P0001';
  end if;

  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_NAME_INVALID' using errcode='P0001';
  end if;
  if v_phone_normalized !~ '^\+639[0-9]{9}$' then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_PHONE_INVALID' using errcode='P0001';
  end if;
  if length(v_phone_display) < 10 or length(v_phone_display) > 30 then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_PHONE_DISPLAY_INVALID' using errcode='P0001';
  end if;
  if length(v_barangay) < 2 or length(v_barangay) > 100 then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_BARANGAY_INVALID' using errcode='P0001';
  end if;
  if length(v_vendor_name) < 2 or length(v_vendor_name) > 60 then
    raise exception 'AGRIMARKET_STORE_NAME_REQUIRED' using errcode='P0001';
  end if;
  if length(v_pickup_label) < 2 or length(v_pickup_label) > 180 then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_PICKUP_LABEL_INVALID' using errcode='P0001';
  end if;
  if p_pickup_lat is null or p_pickup_lat < -90 or p_pickup_lat > 90
     or p_pickup_lng is null or p_pickup_lng < -180 or p_pickup_lng > 180 then
    raise exception 'AGRIMARKET_VERIFIED_FARMER_PICKUP_PIN_INVALID' using errcode='P0001';
  end if;
  if not coalesce(p_pickup_motorcycle_accessible,false)
     and not coalesce(p_pickup_tricycle_accessible,false) then
    raise exception 'AGRIMARKET_PICKUP_ACCESS_REQUIRED' using errcode='P0001';
  end if;
  if length(v_directions) < 5 or length(v_directions) > 1000 then
    raise exception 'AGRIMARKET_PICKUP_DIRECTIONS_REQUIRED' using errcode='P0001';
  end if;

  if v_actor is null then v_actor := v_credential.access_code; end if;

  v_phone_digits := regexp_replace(v_phone_normalized,'[^0-9]','','g');
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_preassigned_profile:' || v_phone_normalized,0));

  if exists (
    select 1 from public.agrimarket_producers p
    where p.id <> p_producer_id
      and regexp_replace(coalesce(p.contact_phone,''),'[^0-9]','','g') in (
        v_phone_digits,
        substring(v_phone_digits from 3),
        '0' || substring(v_phone_digits from 3)
      )
  ) then
    raise exception 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' using errcode='P0001';
  end if;

  if exists (
    select 1 from public.agrimarket_farmer_applications a
    where a.approved_producer_id is distinct from p_producer_id
      and a.phone_normalized=v_phone_normalized
      and a.status in ('submitted','under_review','correction_requested','approved')
  ) then
    raise exception 'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED' using errcode='P0001';
  end if;

  select a.id into v_application_id
  from public.agrimarket_farmer_applications a
  where a.approved_producer_id=p_producer_id
    and a.status='approved'
  order by a.reviewed_at desc nulls last, a.created_at desc
  limit 1
  for update;

  -- Preserve only an existing approval. Profile saves can never grant readiness.
  -- Store name, directions and geocoder label edits do not revoke approval.
  -- Identity/contact, barangay, exact pin and access changes require review.
  v_old_phone_digits := regexp_replace(coalesce(v_producer.contact_phone,''),'[^0-9]','','g');
  if v_old_phone_digits ~ '^09[0-9]{9}$' then
    v_old_phone_digits := '63' || substring(v_old_phone_digits from 2);
  elsif v_old_phone_digits ~ '^9[0-9]{9}$' then
    v_old_phone_digits := '63' || v_old_phone_digits;
  end if;
  v_review_fields := array_remove(ARRAY[
    case when lower(regexp_replace(trim(coalesce(v_producer.contact_name,'')), '[[:space:]]+', ' ', 'g')) is distinct from lower(v_name) then 'contact_name' end,
    case when v_old_phone_digits is distinct from v_phone_digits then 'contact_phone' end,
    case when lower(regexp_replace(trim(coalesce(v_producer.barangay,'')), '[[:space:]]+', ' ', 'g')) is distinct from lower(v_barangay) then 'barangay' end,
    case when v_producer.pickup_lat is distinct from p_pickup_lat then 'pickup_lat' end,
    case when v_producer.pickup_lng is distinct from p_pickup_lng then 'pickup_lng' end,
    case when coalesce(v_producer.pickup_motorcycle_accessible,false) is distinct from coalesce(p_pickup_motorcycle_accessible,false) then 'pickup_motorcycle_accessible' end,
    case when coalesce(v_producer.pickup_tricycle_accessible,false) is distinct from coalesce(p_pickup_tricycle_accessible,false) then 'pickup_tricycle_accessible' end,
    case when coalesce(v_producer.pickup_roadside_handoff_required,false) is distinct from coalesce(p_pickup_roadside_handoff_required,false) then 'pickup_roadside_handoff_required' end
  ], NULL);
  v_next_ready := coalesce(v_producer.accepting_orders,false) and cardinality(v_review_fields)=0;
  v_next_open := v_next_ready and coalesce(v_producer.store_open,false);

  update public.agrimarket_producers p
  set contact_name=v_name,
      contact_phone=v_phone_display,
      barangay=v_barangay,
      vendor_name=v_vendor_name,
      pickup_label=v_pickup_label,
      pickup_lat=p_pickup_lat,
      pickup_lng=p_pickup_lng,
      pickup_motorcycle_accessible=coalesce(p_pickup_motorcycle_accessible,false),
      pickup_tricycle_accessible=coalesce(p_pickup_tricycle_accessible,false),
      pickup_roadside_handoff_required=coalesce(p_pickup_roadside_handoff_required,false),
      pickup_driver_directions=v_directions,
      accepting_orders=v_next_ready,
      store_open=v_next_open,
      updated_at=v_now
  where p.id=p_producer_id;

  if v_application_id is null then
    v_application_code := 'AGINFO-' || replace(v_credential.access_code,'AGF-','');
    if exists(select 1 from public.agrimarket_farmer_applications where application_code=v_application_code) then
      v_application_code := v_application_code || '-' || left(p_producer_id::text,8);
    end if;

    insert into public.agrimarket_farmer_applications(
      application_code,
      applicant_name,
      phone_normalized,
      phone_display,
      town,
      barangay,
      pickup_label,
      pickup_lat,
      pickup_lng,
      intended_products,
      identity_type,
      identity_reference_last4,
      applicant_note,
      status,
      review_note,
      reviewed_by,
      reviewed_at,
      approved_producer_id,
      onboarding_source,
      verification_method,
      pickup_motorcycle_accessible,
      pickup_tricycle_accessible,
      pickup_roadside_handoff_required,
      pickup_driver_directions,
      application_details,
      created_at,
      updated_at
    ) values (
      v_application_code,
      v_name,
      v_phone_normalized,
      v_phone_display,
      v_producer.town,
      v_barangay,
      v_pickup_label,
      p_pickup_lat,
      p_pickup_lng,
      '{}'::text[],
      null,
      null,
      'Preassigned JRide information-drive farmer account.',
      'approved',
      case when v_next_ready then 'Profile saved. Existing JRide order-readiness approval preserved.' else 'Profile completed by farmer. Order readiness still requires JRide admin approval.' end,
      'JRide info-drive preassigned access',
      v_now,
      p_producer_id,
      'staff_verified',
      'JRide info-drive preassigned access',
      coalesce(p_pickup_motorcycle_accessible,false),
      coalesce(p_pickup_tricycle_accessible,false),
      coalesce(p_pickup_roadside_handoff_required,false),
      v_directions,
      jsonb_build_object(
        'version','2',
        'farmer_consent',true,
        'preassigned_access',true,
        'profile_completed_by_farmer',true,
        'readiness_review_pending',not v_next_ready,
        'access_code',v_credential.access_code
      ),
      v_now,
      v_now
    )
    returning id into v_application_id;
  else
    update public.agrimarket_farmer_applications a
    set applicant_name=v_name,
        phone_normalized=v_phone_normalized,
        phone_display=v_phone_display,
        town=v_producer.town,
        barangay=v_barangay,
        pickup_label=v_pickup_label,
        pickup_lat=p_pickup_lat,
        pickup_lng=p_pickup_lng,
        pickup_motorcycle_accessible=coalesce(p_pickup_motorcycle_accessible,false),
        pickup_tricycle_accessible=coalesce(p_pickup_tricycle_accessible,false),
        pickup_roadside_handoff_required=coalesce(p_pickup_roadside_handoff_required,false),
        pickup_driver_directions=v_directions,
        application_details=coalesce(a.application_details,'{}'::jsonb) || jsonb_build_object('readiness_review_pending',not v_next_ready),
        updated_at=v_now
    where a.id=v_application_id;
  end if;

  insert into public.agrimarket_farmer_application_events(
    application_id,event_type,actor_type,actor,details,created_at
  ) values (
    v_application_id,
    'profile_updated',
    'applicant',
    v_actor,
    jsonb_build_object(
      'action','profile_completed_by_farmer',
      'producer_id',p_producer_id,
      'access_code',v_credential.access_code,
      'previous_accepting_orders',v_producer.accepting_orders,
      'previous_store_open',v_producer.store_open,
      'accepting_orders',v_next_ready,
      'store_open',v_next_open,
      'readiness_review_pending',not v_next_ready,
      'review_change_fields',to_jsonb(v_review_fields),
      'availability_policy','preserve_approved_routine_edits_v1'
    ),
    v_now
  );

  return query
  select v_application_id,p_producer_id,v_credential.access_code,v_next_ready,v_now;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.agrimarket_farmer_complete_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_complete_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,timestamp with time zone) TO service_role;

-- On installations containing the named dummy fixture, exercise actual SQL.
-- Every fixture mutation is rolled back by the caught subtransaction exception.
-- A failed assertion aborts the migration, including the function replacement.
DO $regression$
DECLARE
  v_fixture public.agrimarket_producers%rowtype;
  v_current public.agrimarket_producers%rowtype;
  v_phone text;
  v_result record;
  v_case integer;
  v_expected_ready boolean;
  v_expected_open boolean;
  v_before jsonb;
  v_after jsonb;
  v_fields jsonb;
BEGIN
  SELECT p.* INTO v_fixture FROM public.agrimarket_producers p
  WHERE p.vendor_name='JRide AgriMarket TEST - Lamut' AND p.town='Lamut' AND p.status='active'
  ORDER BY p.id LIMIT 1 FOR UPDATE;
  IF v_fixture.id IS NULL THEN RETURN; END IF;
  SELECT a.phone_normalized INTO v_phone FROM public.agrimarket_farmer_applications a WHERE a.approved_producer_id=v_fixture.id AND a.status='approved' ORDER BY a.reviewed_at DESC NULLS LAST,a.created_at DESC LIMIT 1;
  IF v_phone IS NULL THEN RETURN; END IF;
  SELECT jsonb_build_object('producer',to_jsonb(v_fixture),'credentials',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.agrimarket_producer_credentials c WHERE c.producer_id=v_fixture.id),'products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.agrimarket_products p WHERE p.producer_id=v_fixture.id),'applications',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.agrimarket_farmer_applications a WHERE a.approved_producer_id=v_fixture.id),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.agrimarket_farmer_application_events e JOIN public.agrimarket_farmer_applications a ON a.id=e.application_id WHERE a.approved_producer_id=v_fixture.id)) INTO v_before;
  FOR v_case IN 1..10 LOOP
    BEGIN
      -- 1: routine open; 2: routine closed; 3: pending cannot self-approve;
      -- 4: phone formatting; 5: pin change; 6: identity change;
      -- 7: barangay change; 8: access change; 9: roadside change;
      -- 10: retry after sensitive change cannot restore approval.
      UPDATE public.agrimarket_producers SET accepting_orders=(v_case<>3),store_open=(v_case<>2 AND v_case<>3) WHERE id=v_fixture.id;
      SELECT * INTO v_result FROM public.agrimarket_farmer_complete_profile_v1(
        v_fixture.id,
        CASE WHEN v_case=6 THEN v_fixture.contact_name || ' QA' ELSE v_fixture.contact_name END,
        CASE WHEN v_case=4 THEN v_phone ELSE v_fixture.contact_phone END,
        v_phone,
        CASE WHEN v_case=7 THEN 'QA different barangay' ELSE v_fixture.barangay END,
        'QA routine store name',
        'QA refreshed geocoder label',
        CASE WHEN v_case IN (5,10) THEN v_fixture.pickup_lat+0.0001 ELSE v_fixture.pickup_lat END,
        v_fixture.pickup_lng,
        CASE WHEN v_case=8 THEN NOT coalesce(v_fixture.pickup_motorcycle_accessible,false) ELSE v_fixture.pickup_motorcycle_accessible END,
        CASE WHEN v_case=8 THEN true ELSE v_fixture.pickup_tricycle_accessible END,
        CASE WHEN v_case=9 THEN NOT coalesce(v_fixture.pickup_roadside_handoff_required,false) ELSE v_fixture.pickup_roadside_handoff_required END,
        'QA clearer landmark and driver directions',
        'rollback-availability-regression',clock_timestamp());
      IF v_case=10 THEN
        SELECT p.* INTO v_current FROM public.agrimarket_producers p WHERE p.id=v_fixture.id;
        SELECT * INTO v_result FROM public.agrimarket_farmer_complete_profile_v1(v_current.id,v_current.contact_name,v_current.contact_phone,v_phone,v_current.barangay,v_current.vendor_name,v_current.pickup_label,v_current.pickup_lat,v_current.pickup_lng,v_current.pickup_motorcycle_accessible,v_current.pickup_tricycle_accessible,v_current.pickup_roadside_handoff_required,v_current.pickup_driver_directions,'rollback-availability-regression',clock_timestamp());
      END IF;
      v_expected_ready := v_case IN (1,2,4);
      v_expected_open := v_case IN (1,4);
      SELECT p.* INTO v_current FROM public.agrimarket_producers p WHERE p.id=v_fixture.id;
      IF v_current.accepting_orders IS DISTINCT FROM v_expected_ready OR v_current.store_open IS DISTINCT FROM v_expected_open OR v_result.accepting_orders IS DISTINCT FROM v_expected_ready THEN RAISE EXCEPTION 'Availability regression case % failed',v_case; END IF;
      IF (SELECT (a.application_details->>'readiness_review_pending')::boolean FROM public.agrimarket_farmer_applications a WHERE a.id=v_result.application_id) IS DISTINCT FROM NOT v_expected_ready THEN RAISE EXCEPTION 'Readiness metadata regression case % failed',v_case; END IF;
      SELECT e.details INTO v_fields FROM public.agrimarket_farmer_application_events e WHERE e.application_id=v_result.application_id ORDER BY e.id DESC LIMIT 1;
      IF (v_fields->>'accepting_orders')::boolean IS DISTINCT FROM v_expected_ready OR (v_fields->>'store_open')::boolean IS DISTINCT FROM v_expected_open OR NOT (v_fields ? 'previous_accepting_orders') OR NOT (v_fields ? 'review_change_fields') THEN RAISE EXCEPTION 'Audit regression case % failed',v_case; END IF;
      IF v_current.vendor_name <> 'QA routine store name' OR v_current.pickup_driver_directions <> 'QA clearer landmark and driver directions' THEN RAISE EXCEPTION 'Profile persistence regression case % failed',v_case; END IF;
      RAISE EXCEPTION USING ERRCODE='ZJ001',MESSAGE='ROLLBACK_SUCCESSFUL_REGRESSION_CASE';
    EXCEPTION WHEN SQLSTATE 'ZJ001' THEN NULL;
    END;
  END LOOP;
  SELECT jsonb_build_object('producer',to_jsonb(p),'credentials',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.agrimarket_producer_credentials c WHERE c.producer_id=p.id),'products',(SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr.id) FROM public.agrimarket_products pr WHERE pr.producer_id=p.id),'applications',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.agrimarket_farmer_applications a WHERE a.approved_producer_id=p.id),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.agrimarket_farmer_application_events e JOIN public.agrimarket_farmer_applications a ON a.id=e.application_id WHERE a.approved_producer_id=p.id)) INTO v_after FROM public.agrimarket_producers p WHERE p.id=v_fixture.id;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'Regression fixture was not fully rolled back'; END IF;
END;
$regression$;
COMMIT;
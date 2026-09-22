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
      accepting_orders=false,
      store_open=false,
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
      'Profile completed by farmer. Order readiness still requires JRide admin approval.',
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
        'readiness_review_pending',true,
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
      'accepting_orders',false,
      'store_open',false,
      'readiness_review_pending',true
    ),
    v_now
  );

  return query
  select v_application_id,p_producer_id,v_credential.access_code,false,v_now;
end;
$function$;


REVOKE EXECUTE ON FUNCTION public.agrimarket_farmer_complete_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrimarket_farmer_complete_profile_v1(uuid,text,text,text,text,text,text,double precision,double precision,boolean,boolean,boolean,text,text,timestamp with time zone) TO service_role;

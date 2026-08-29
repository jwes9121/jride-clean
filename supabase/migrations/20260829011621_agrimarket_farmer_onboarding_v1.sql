create table if not exists public.agrimarket_farmer_applications (
  id uuid primary key default gen_random_uuid(),
  application_code text not null unique,
  applicant_name text not null,
  phone_normalized text not null,
  phone_display text,
  town text not null,
  barangay text,
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  intended_products text[] not null default '{}'::text[],
  identity_type text,
  identity_reference_last4 text,
  applicant_note text,
  status text not null default 'submitted',
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  approved_producer_id uuid references public.agrimarket_producers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_farmer_applications_name_chk check (length(trim(applicant_name)) >= 2),
  constraint agrimarket_farmer_applications_phone_chk check (length(trim(phone_normalized)) between 10 and 16),
  constraint agrimarket_farmer_applications_town_chk check (length(trim(town)) >= 2),
  constraint agrimarket_farmer_applications_pickup_label_chk check (length(trim(pickup_label)) >= 2),
  constraint agrimarket_farmer_applications_lat_chk check (pickup_lat between -90 and 90),
  constraint agrimarket_farmer_applications_lng_chk check (pickup_lng between -180 and 180),
  constraint agrimarket_farmer_applications_status_chk check (status in ('submitted','under_review','approved','rejected','withdrawn')),
  constraint agrimarket_farmer_applications_identity_last4_chk check (identity_reference_last4 is null or length(identity_reference_last4) between 2 and 4)
);

create unique index if not exists agrimarket_farmer_applications_one_open_phone_uidx
  on public.agrimarket_farmer_applications(phone_normalized)
  where status in ('submitted','under_review');

create index if not exists agrimarket_farmer_applications_status_created_idx
  on public.agrimarket_farmer_applications(status, created_at desc);

create table if not exists public.agrimarket_farmer_application_events (
  id bigserial primary key,
  application_id uuid not null references public.agrimarket_farmer_applications(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agrimarket_farmer_application_events_type_chk check (event_type in ('submitted','under_review','approved','rejected','withdrawn','credential_reset','credential_revoked')),
  constraint agrimarket_farmer_application_events_actor_type_chk check (actor_type in ('applicant','staff','system'))
);

create index if not exists agrimarket_farmer_application_events_app_idx
  on public.agrimarket_farmer_application_events(application_id, created_at desc);

create table if not exists public.agrimarket_producer_credentials (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null unique references public.agrimarket_producers(id) on delete cascade,
  access_code text not null unique,
  pin_hash text not null,
  status text not null default 'active',
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_used_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_producer_credentials_access_code_chk check (access_code ~ '^AGF-[A-Z0-9]{6,12}$'),
  constraint agrimarket_producer_credentials_status_chk check (status in ('active','revoked','reset_required')),
  constraint agrimarket_producer_credentials_failed_attempts_chk check (failed_attempts between 0 and 100)
);

create or replace function public.agrimarket_touch_farmer_application_updated_at_v1()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.agrimarket_touch_producer_credential_updated_at_v1()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists agrimarket_farmer_applications_touch_updated_at on public.agrimarket_farmer_applications;
create trigger agrimarket_farmer_applications_touch_updated_at
before update on public.agrimarket_farmer_applications
for each row execute function public.agrimarket_touch_farmer_application_updated_at_v1();

drop trigger if exists agrimarket_producer_credentials_touch_updated_at on public.agrimarket_producer_credentials;
create trigger agrimarket_producer_credentials_touch_updated_at
before update on public.agrimarket_producer_credentials
for each row execute function public.agrimarket_touch_producer_credential_updated_at_v1();

create or replace function public.agrimarket_review_farmer_application_v1(
  p_application_id uuid,
  p_decision text,
  p_reviewed_by text,
  p_review_note text default null,
  p_access_code text default null,
  p_pin text default null,
  p_now timestamptz default clock_timestamp()
)
returns table(
  application_id uuid,
  application_code text,
  status text,
  producer_id uuid,
  access_code text
)
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_app public.agrimarket_farmer_applications%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_producer_id uuid;
  v_access_code text := upper(trim(coalesce(p_access_code,'')));
begin
  if p_application_id is null then
    raise exception 'AGRIMARKET_APPLICATION_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_reviewed_by,'')),'') is null then
    raise exception 'AGRIMARKET_REVIEWER_REQUIRED' using errcode = 'P0001';
  end if;
  if v_decision not in ('under_review','approve','reject') then
    raise exception 'AGRIMARKET_REVIEW_DECISION_INVALID' using errcode = 'P0001';
  end if;

  select * into v_app
  from public.agrimarket_farmer_applications
  where id = p_application_id
  for update;

  if not found then
    raise exception 'AGRIMARKET_APPLICATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_app.status in ('approved','rejected','withdrawn') then
    raise exception 'AGRIMARKET_APPLICATION_ALREADY_FINAL' using errcode = 'P0001';
  end if;

  if v_decision = 'under_review' then
    update public.agrimarket_farmer_applications
    set status = 'under_review',
        review_note = nullif(trim(coalesce(p_review_note,'')),''),
        reviewed_by = trim(p_reviewed_by),
        reviewed_at = p_now
    where id = v_app.id;

    insert into public.agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
    values (v_app.id,'under_review','staff',trim(p_reviewed_by),jsonb_build_object('review_note',nullif(trim(coalesce(p_review_note,'')),'')),p_now);

    return query select v_app.id,v_app.application_code,'under_review'::text,null::uuid,null::text;
    return;
  end if;

  if v_decision = 'reject' then
    if nullif(trim(coalesce(p_review_note,'')),'') is null then
      raise exception 'AGRIMARKET_REJECTION_REASON_REQUIRED' using errcode = 'P0001';
    end if;

    update public.agrimarket_farmer_applications
    set status = 'rejected',
        review_note = trim(p_review_note),
        reviewed_by = trim(p_reviewed_by),
        reviewed_at = p_now
    where id = v_app.id;

    insert into public.agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
    values (v_app.id,'rejected','staff',trim(p_reviewed_by),jsonb_build_object('review_note',trim(p_review_note)),p_now);

    return query select v_app.id,v_app.application_code,'rejected'::text,null::uuid,null::text;
    return;
  end if;

  if v_access_code !~ '^AGF-[A-Z0-9]{6,12}$' then
    raise exception 'AGRIMARKET_ACCESS_CODE_INVALID' using errcode = 'P0001';
  end if;
  if coalesce(p_pin,'') !~ '^[0-9]{6}$' then
    raise exception 'AGRIMARKET_PIN_INVALID' using errcode = 'P0001';
  end if;

  insert into public.agrimarket_producers(
    vendor_account_id,contact_name,town,barangay,pickup_label,pickup_lat,pickup_lng,
    status,accepting_orders,joining_fee,listing_fee,marketplace_fee_percent,created_at,updated_at
  ) values (
    null,v_app.applicant_name,v_app.town,v_app.barangay,v_app.pickup_label,v_app.pickup_lat,v_app.pickup_lng,
    'active',true,0,0,0,p_now,p_now
  ) returning id into v_producer_id;

  insert into public.agrimarket_producer_credentials(
    producer_id,access_code,pin_hash,status,failed_attempts,created_by,created_at,updated_at
  ) values (
    v_producer_id,v_access_code,extensions.crypt(p_pin, extensions.gen_salt('bf')),'active',0,trim(p_reviewed_by),p_now,p_now
  );

  update public.agrimarket_farmer_applications
  set status = 'approved',
      review_note = nullif(trim(coalesce(p_review_note,'')),''),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = p_now,
      approved_producer_id = v_producer_id
  where id = v_app.id;

  insert into public.agrimarket_farmer_application_events(application_id,event_type,actor_type,actor,details,created_at)
  values (
    v_app.id,'approved','staff',trim(p_reviewed_by),
    jsonb_build_object('producer_id',v_producer_id,'access_code',v_access_code,'free_farmer_launch',true),p_now
  );

  return query select v_app.id,v_app.application_code,'approved'::text,v_producer_id,v_access_code;
end;
$function$;

create or replace function public.agrimarket_verify_producer_credential_v1(
  p_access_code text,
  p_pin text,
  p_now timestamptz default clock_timestamp()
)
returns table(
  producer_id uuid,
  access_code text,
  producer_status text,
  accepting_orders boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_cred public.agrimarket_producer_credentials%rowtype;
  v_producer public.agrimarket_producers%rowtype;
  v_failures integer;
begin
  select * into v_cred
  from public.agrimarket_producer_credentials
  where access_code = upper(trim(coalesce(p_access_code,'')))
  for update;

  if not found or v_cred.status <> 'active' then
    return;
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > p_now then
    return;
  end if;

  if coalesce(p_pin,'') = '' or extensions.crypt(p_pin,v_cred.pin_hash) <> v_cred.pin_hash then
    v_failures := least(coalesce(v_cred.failed_attempts,0) + 1,100);
    update public.agrimarket_producer_credentials
    set failed_attempts = v_failures,
        locked_until = case when v_failures >= 5 then p_now + interval '15 minutes' else null end,
        updated_at = p_now
    where id = v_cred.id;
    return;
  end if;

  update public.agrimarket_producer_credentials
  set failed_attempts = 0,
      locked_until = null,
      last_used_at = p_now,
      updated_at = p_now
  where id = v_cred.id;

  select * into v_producer
  from public.agrimarket_producers
  where id = v_cred.producer_id;

  if not found or v_producer.status <> 'active' then
    return;
  end if;

  return query
  select v_producer.id,v_cred.access_code,v_producer.status,v_producer.accepting_orders;
end;
$function$;

alter table public.agrimarket_farmer_applications enable row level security;
alter table public.agrimarket_farmer_application_events enable row level security;
alter table public.agrimarket_producer_credentials enable row level security;

revoke all on public.agrimarket_farmer_applications from anon, authenticated;
revoke all on public.agrimarket_farmer_application_events from anon, authenticated;
revoke all on public.agrimarket_producer_credentials from anon, authenticated;
revoke all on function public.agrimarket_review_farmer_application_v1(uuid,text,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.agrimarket_verify_producer_credential_v1(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.agrimarket_review_farmer_application_v1(uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.agrimarket_verify_producer_credential_v1(text,text,timestamptz) to service_role;

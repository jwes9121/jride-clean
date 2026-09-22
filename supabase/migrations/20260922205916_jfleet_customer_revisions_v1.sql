-- Customer inquiry revisions. No service activation or document verification.
-- Preserve every submitted plan; one inquiry may have multiple immutable versions.
alter table public.jfleet_route_plans drop constraint jfleet_route_plans_inquiry_id_key;
create index jfleet_route_plans_inquiry_idx on public.jfleet_route_plans(inquiry_id);
create table public.jfleet_inquiry_revisions (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.jfleet_inquiries(id) on delete restrict,
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  route_plan_id uuid not null unique references public.jfleet_route_plans(id) on delete restrict,
  itinerary_id uuid not null unique references public.jfleet_itineraries(id) on delete restrict,
  previous_context_token text not null,
  reason text not null check (length(reason) between 3 and 1500),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index jfleet_inquiry_revisions_inquiry_idx on public.jfleet_inquiry_revisions(inquiry_id,created_at desc);
create index jfleet_inquiry_revisions_passenger_idx on public.jfleet_inquiry_revisions(passenger_user_id);
alter table public.jfleet_inquiry_revisions enable row level security;
revoke all on public.jfleet_inquiry_revisions from public,anon,authenticated;
grant select,insert on public.jfleet_inquiry_revisions to service_role;
create function public.jfleet_freeze_inquiry_revision_v1() returns trigger
language plpgsql security invoker set search_path='' as $jfleet$
begin raise exception 'JFLEET_REVISION_IMMUTABLE'; end;
$jfleet$;
create trigger jfleet_inquiry_revisions_immutable before update or delete on public.jfleet_inquiry_revisions
for each row execute function public.jfleet_freeze_inquiry_revision_v1();

-- Includes owner decisions, quote versions/statuses and payment/cancellation terms.
-- All writers in this flow serialize on the same inquiry row.
create function public.jfleet_customer_state_token_v1(p_inquiry_id uuid) returns text
language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; p public.jfleet_partners%rowtype; s jsonb; r uuid; qs jsonb;
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id for update;
  if q.id is null then raise exception 'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'; end if;
  select * into p from public.jfleet_partners where id=q.partner_id for share;
  s:=public.jfleet_route_snapshot_v1(q.id);
  select id into r from public.jfleet_route_reviews where inquiry_id=q.id order by created_at desc,id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'version',version_no) order by version_no),'[]'::jsonb)
    into qs from public.jfleet_quotes where inquiry_id=q.id;
  return encode(sha256(convert_to(jsonb_build_object('snapshot',s,'status',q.status,'booking',q.converted_booking_id,
    'review',r,'quotes',qs,'owner',p.owner_user_id,'partner_status',p.status,'quote_tat',p.quote_tat_minutes,
    'deposit',greatest(p.reservation_percent,20),'cancel_hours',p.free_cancel_hours,'late_percent',p.late_cancel_percent)::text,'UTF8')),'hex');
end;
$jfleet$;

create function public.jfleet_customer_inquiry_v1(p_inquiry_id uuid,p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $jfleet$
declare
  q public.jfleet_inquiries%rowtype; p public.jfleet_partners%rowtype; r public.jfleet_route_reviews%rowtype;
  s jsonb; token text; quotes jsonb; reviews jsonb; revisions jsonb; actionable uuid; booking jsonb;
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id and passenger_user_id=p_user_id for update;
  if q.id is null then raise exception 'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'; end if;
  select * into p from public.jfleet_partners where id=q.partner_id for share;
  s:=public.jfleet_route_snapshot_v1(q.id);
  token:=public.jfleet_customer_state_token_v1(q.id);
  select * into r from public.jfleet_route_reviews where inquiry_id=q.id order by created_at desc,id desc limit 1;
  if q.status='quote_ready' and q.converted_booking_id is null and q.scheduled_start_at>clock_timestamp()
     and p.status='active' and r.decision='approved' and r.snapshot=s and r.owner_user_id=p.owner_user_id then
    select id into actionable from public.jfleet_quotes where inquiry_id=q.id and status='sent'
      and valid_until>clock_timestamp() and route_review_id=r.id order by version_no desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'version_no',x.version_no,'status',x.status,
    'display_status',case when x.status='sent' and x.valid_until<=clock_timestamp() then 'expired' else x.status end,
    'total_amount',x.total_amount,'currency',x.currency,'valid_until',x.valid_until,
    'inclusions',x.inclusions,'exclusions',x.exclusions,'pricing_notes',x.pricing_notes,'fuel_basis_note',x.fuel_basis_note,
    'sent_at',x.sent_at,'accepted_at',x.accepted_at,
    'reservation_required_amount',round(x.total_amount*greatest(p.reservation_percent,20)/100,2),
    'snapshot',v.snapshot-array['passenger_user_id','partner_id'],
    'items',(select coalesce(jsonb_agg(jsonb_build_object('sequence_no',z.sequence_no,'label',z.label,
       'amount',z.amount,'included',z.included,'notes',z.notes) order by z.sequence_no),'[]'::jsonb)
       from public.jfleet_quote_items z where z.quote_id=x.id)
  ) order by x.version_no desc),'[]'::jsonb) into quotes from public.jfleet_quotes x
    left join public.jfleet_route_reviews v on v.id=x.route_review_id where x.inquiry_id=q.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'decision',decision,'notes',notes,'created_at',created_at,
    'itinerary_version',snapshot->'itinerary_version') order by created_at desc,id desc),'[]'::jsonb)
    into reviews from public.jfleet_route_reviews where inquiry_id=q.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'reason',reason,'created_at',created_at,
    'from_version',before_snapshot->'itinerary_version','to_version',after_snapshot->'itinerary_version') order by created_at desc),'[]'::jsonb)
    into revisions from public.jfleet_inquiry_revisions where inquiry_id=q.id;
  select jsonb_build_object('id',id,'booking_code',booking_code,'status',status,'payment_status',payment_status,
    'original_quote_amount',original_quote_amount,'reservation_required_amount',reservation_required_amount)
    into booking from public.jfleet_bookings where inquiry_id=q.id and passenger_user_id=p_user_id;
  return jsonb_build_object('ok',true,'inquiry_id',q.id,'inquiry_code',q.inquiry_code,'status',q.status,
    'partner_name',p.display_name,'quote_due_at',q.quote_due_at,'context_token',token,
    'snapshot',s-array['passenger_user_id','partner_id'],
    'can_revise',p.status='active' and q.status in ('quote_requested','under_review','quote_ready','revision_requested')
       and q.converted_booking_id is null and q.scheduled_start_at>clock_timestamp() and booking is null,
    'actionable_quote_id',actionable,'quotes',quotes,'reviews',reviews,'revisions',revisions,'booking',booking,
    'terms',jsonb_build_object('reservation_percent',greatest(p.reservation_percent,20),'free_cancel_hours',p.free_cancel_hours,
      'late_cancel_percent',p.late_cancel_percent,'quote_tat_minutes',p.quote_tat_minutes,
      'free_cancel_until_epoch',extract(epoch from q.scheduled_start_at)-(p.free_cancel_hours*3600)));
end;
$jfleet$;

create function public.jfleet_resubmit_inquiry_v1(
  p_inquiry_id uuid,p_user_id uuid,p_plan_id uuid,p_points jsonb,p_details jsonb,p_context_token text,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare
  q public.jfleet_inquiries%rowtype; p public.jfleet_partners%rowtype; plan public.jfleet_route_plans%rowtype;
  receipt public.jfleet_inquiry_revisions%rowtype; before_s jsonb; after_s jsonb; result jsonb;
  v_itinerary uuid; v_version integer; v_start timestamptz; v_end timestamptz; v_count integer;
  v_point jsonb; v_seq integer:=0; v_mode text; v_now timestamptz:=clock_timestamp(); n text:=trim(coalesce(p_reason,''));
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id and passenger_user_id=p_user_id for update;
  if q.id is null then raise exception 'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'; end if;
  select * into plan from public.jfleet_route_plans where id=p_plan_id and passenger_user_id=p_user_id for update;
  if plan.id is null then raise exception 'JFLEET_ROUTE_PLAN_NOT_FOUND'; end if;
  if plan.points is distinct from p_points then raise exception 'JFLEET_ROUTE_PLAN_CHANGED'; end if;
  if plan.status='submitted' then
    select * into receipt from public.jfleet_inquiry_revisions where route_plan_id=plan.id;
    if receipt.id is null or receipt.inquiry_id<>q.id or receipt.passenger_user_id<>p_user_id
       or plan.submission_details is distinct from p_details or receipt.previous_context_token is distinct from p_context_token
       or receipt.reason is distinct from n then raise exception 'JFLEET_REVISION_RETRY_CONFLICT'; end if;
    return receipt.result||jsonb_build_object('already_submitted',true);
  end if;
  if q.converted_booking_id is not null or q.status not in ('quote_requested','under_review','quote_ready','revision_requested')
     or q.scheduled_start_at<=v_now or exists(select 1 from public.jfleet_bookings where inquiry_id=q.id) then
    raise exception 'JFLEET_CUSTOMER_REVISION_CLOSED';
  end if;
  select * into p from public.jfleet_partners where id=q.partner_id and status='active' for share;
  if p.id is null then raise exception 'JFLEET_PARTNER_NOT_ACTIVE'; end if;
  if public.jfleet_customer_state_token_v1(q.id) is distinct from p_context_token then
    raise exception 'JFLEET_CUSTOMER_CONTEXT_STALE';
  end if;
  if plan.status<>'ready' then raise exception 'JFLEET_ROUTE_NOT_READY'; end if;
  if plan.expires_at<=v_now then raise exception 'JFLEET_ROUTE_PLAN_EXPIRED'; end if;
  if length(n) not between 3 and 1500 or p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'JFLEET_REVISION_INPUT_INVALID';
  end if;
  v_mode:=p_details->>'trip_mode';
  if v_mode is null or v_mode not in ('one_way','round_trip','multi_day')
     or coalesce(p_details->>'purpose','') not in ('tour_leisure','family','business','event','cargo_delivery','moving_hauling','other')
     or coalesce(p_details->>'requested_vehicle_type','') not in ('van','pickup','truck','recommend') then
    raise exception 'JFLEET_REVISION_INPUT_INVALID';
  end if;
  v_start:=(p_details->>'scheduled_start_at')::timestamptz; v_end:=(p_details->>'scheduled_end_at')::timestamptz;
  if v_start is null or v_end is null or v_start<=v_now or v_end<=v_start then raise exception 'JFLEET_TRIP_SCHEDULE_INVALID'; end if;
  if (p_details->>'passenger_count') is not null and (jsonb_typeof(p_details->'passenger_count')<>'number'
     or (p_details->>'passenger_count')::numeric<=0
     or trunc((p_details->>'passenger_count')::numeric)<>(p_details->>'passenger_count')::numeric) then
    raise exception 'JFLEET_REVISION_INPUT_INVALID';
  end if;
  if (p_details->>'cargo_weight_kg') is not null and (jsonb_typeof(p_details->'cargo_weight_kg')<>'number'
     or (p_details->>'cargo_weight_kg')::numeric<=0) then raise exception 'JFLEET_REVISION_INPUT_INVALID'; end if;
  v_count:=jsonb_array_length(plan.points);
  if v_mode='round_trip' and (v_count<3 or plan.points#>'{0,lat}' is distinct from plan.points->(v_count-1)->'lat'
     or plan.points#>'{0,lng}' is distinct from plan.points->(v_count-1)->'lng') then raise exception 'JFLEET_RETURN_PIN_REQUIRED'; end if;
  before_s:=public.jfleet_route_snapshot_v1(q.id);
  select coalesce(max(version_no),0)+1 into v_version from public.jfleet_itineraries where inquiry_id=q.id;
  update public.jfleet_itineraries set status='superseded' where inquiry_id=q.id and status='current';
  insert into public.jfleet_itineraries(inquiry_id,version_no,source,status,change_reason)
    values(q.id,v_version,'customer','current',n) returning id into v_itinerary;
  for v_point in select value from jsonb_array_elements(plan.points) loop
    insert into public.jfleet_itinerary_stops(itinerary_id,sequence_no,stop_type,location_label,lat,lng,notes)
      values(v_itinerary,v_seq,case when v_seq=0 then 'pickup' when v_seq=v_count-1 then
        case when v_mode='round_trip' then 'return' else 'destination' end else 'stop' end,
        v_point->>'label',(v_point->>'lat')::double precision,(v_point->>'lng')::double precision,coalesce(v_point->>'notes',''));
    v_seq:=v_seq+1;
  end loop;
  update public.jfleet_itineraries set route_plan_id=plan.id where id=v_itinerary;
  update public.jfleet_route_plans set status='submitted',inquiry_id=q.id,submission_details=p_details where id=plan.id;
  update public.jfleet_quotes set status='superseded' where inquiry_id=q.id and status='sent';
  update public.jfleet_inquiries set purpose=p_details->>'purpose',requested_vehicle_type=p_details->>'requested_vehicle_type',
    trip_mode=v_mode,pickup_label=plan.points#>>'{0,label}',pickup_lat=(plan.points#>>'{0,lat}')::double precision,
    pickup_lng=(plan.points#>>'{0,lng}')::double precision,scheduled_start_at=v_start,scheduled_end_at=v_end,
    passenger_count=(p_details->>'passenger_count')::integer,cargo_description=nullif(trim(p_details->>'cargo_description'),''),
    cargo_weight_kg=(p_details->>'cargo_weight_kg')::numeric,luggage_notes=nullif(trim(p_details->>'luggage_notes'),''),
    special_notes=nullif(trim(p_details->>'special_notes'),''),status='quote_requested',current_itinerary_version=v_version,
    quote_due_at=v_now+make_interval(mins=>p.quote_tat_minutes),owner_opened_at=null,accepted_quote_id=null
    where id=q.id returning * into q;
  after_s:=public.jfleet_route_snapshot_v1(q.id);
  result:=jsonb_build_object('ok',true,'inquiry_id',q.id,'inquiry_code',q.inquiry_code,'status',q.status,
    'itinerary_version',v_version,'quote_due_at',q.quote_due_at,'already_submitted',false);
  insert into public.jfleet_inquiry_revisions(inquiry_id,passenger_user_id,route_plan_id,itinerary_id,previous_context_token,
    reason,before_snapshot,after_snapshot,result) values(q.id,p_user_id,plan.id,v_itinerary,p_context_token,n,before_s,after_s,result);
  insert into public.jfleet_events(inquiry_id,actor_type,actor_id,event_type,details)
    values(q.id,'customer',p_user_id::text,'inquiry_revised',jsonb_build_object('from_version',before_s->'itinerary_version',
      'to_version',v_version,'reason',n,'route_plan_id',plan.id,'quote_due_at',q.quote_due_at));
  return result;
end;
$jfleet$;

create function public.jfleet_customer_accept_quote_v2(
  p_inquiry_id uuid,p_quote_id uuid,p_user_id uuid,p_context_token text,p_terms_acknowledged boolean
) returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; result jsonb;
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id and passenger_user_id=p_user_id for update;
  if q.id is null then raise exception 'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'; end if;
  if p_terms_acknowledged is distinct from true then raise exception 'JFLEET_CUSTOMER_TERMS_REQUIRED'; end if;
  if q.converted_booking_id is not null then
    if q.accepted_quote_id is distinct from p_quote_id then raise exception 'JFLEET_CUSTOMER_ACCEPT_CONFLICT'; end if;
    return public.jfleet_accept_quote_v1(q.id,p_quote_id,p_user_id,'JFLEET-RETRY',clock_timestamp());
  end if;
  if q.status<>'quote_ready' or q.scheduled_start_at<=clock_timestamp() then raise exception 'JFLEET_CUSTOMER_ACCEPT_CLOSED'; end if;
  if public.jfleet_customer_state_token_v1(q.id) is distinct from p_context_token then raise exception 'JFLEET_CUSTOMER_CONTEXT_STALE'; end if;
  result:=public.jfleet_accept_quote_v1(q.id,p_quote_id,p_user_id,'JFB-'||upper(replace(gen_random_uuid()::text,'-','')),clock_timestamp());
  insert into public.jfleet_events(inquiry_id,booking_id,actor_type,actor_id,event_type,details)
    values(q.id,(result->>'booking_id')::uuid,'customer',p_user_id::text,'quote_terms_acknowledged',
      jsonb_build_object('quote_id',p_quote_id,'context_token',p_context_token,'reservation_required_amount',result->'reservation_required_amount'));
  return result;
end;
$jfleet$;
revoke all on function public.jfleet_freeze_inquiry_revision_v1() from public,anon,authenticated;
revoke all on function public.jfleet_customer_state_token_v1(uuid) from public,anon,authenticated;
revoke all on function public.jfleet_customer_inquiry_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jfleet_resubmit_inquiry_v1(uuid,uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.jfleet_customer_accept_quote_v2(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.jfleet_customer_state_token_v1(uuid) to service_role;
grant execute on function public.jfleet_customer_inquiry_v1(uuid,uuid) to service_role;
grant execute on function public.jfleet_resubmit_inquiry_v1(uuid,uuid,uuid,jsonb,jsonb,text,text) to service_role;
grant execute on function public.jfleet_customer_accept_quote_v2(uuid,uuid,uuid,text,boolean) to service_role;

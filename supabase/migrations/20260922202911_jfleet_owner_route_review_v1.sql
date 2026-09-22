-- JFleet owner route review. No activation or document verification is performed.
create table public.jfleet_route_reviews (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.jfleet_inquiries(id) on delete restrict,
  itinerary_id uuid not null references public.jfleet_itineraries(id) on delete restrict,
  route_plan_id uuid not null references public.jfleet_route_plans(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','changes_requested')),
  snapshot jsonb not null,
  snapshot_hash text not null check (length(snapshot_hash)=64),
  notes text not null default '' check (length(notes)<=1500),
  created_at timestamptz not null default clock_timestamp()
);
create index jfleet_route_reviews_inquiry_idx on public.jfleet_route_reviews(inquiry_id,created_at desc,id desc);
create index jfleet_route_reviews_itinerary_idx on public.jfleet_route_reviews(itinerary_id);
create index jfleet_route_reviews_plan_idx on public.jfleet_route_reviews(route_plan_id);
create index jfleet_route_reviews_owner_idx on public.jfleet_route_reviews(owner_user_id);
alter table public.jfleet_route_reviews enable row level security;
revoke all on public.jfleet_route_reviews from public,anon,authenticated;
grant select,insert on public.jfleet_route_reviews to service_role;
alter table public.jfleet_quotes add column route_review_id uuid references public.jfleet_route_reviews(id) on delete restrict;
alter table public.jfleet_bookings add column route_review_id uuid references public.jfleet_route_reviews(id) on delete restrict;
alter table public.jfleet_bookings add column quoted_route_plan_id uuid references public.jfleet_route_plans(id) on delete restrict;
create index jfleet_quotes_route_review_idx on public.jfleet_quotes(route_review_id);
create index jfleet_bookings_route_review_idx on public.jfleet_bookings(route_review_id);
create index jfleet_bookings_quoted_plan_idx on public.jfleet_bookings(quoted_route_plan_id);
create unique index jfleet_itineraries_one_current_idx on public.jfleet_itineraries(inquiry_id) where status='current';

-- All decision/quote/acceptance paths serialize on the inquiry row. Timestamps in
-- snapshots are epochs so session timezone changes do not alter the fingerprint.
create function public.jfleet_route_snapshot_v1(p_inquiry_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare
  q public.jfleet_inquiries%rowtype;
  i public.jfleet_itineraries%rowtype;
  p public.jfleet_route_plans%rowtype;
  stops jsonb; points jsonb;
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id for update;
  if q.id is null then raise exception 'JFLEET_INQUIRY_NOT_FOUND'; end if;
  select * into i from public.jfleet_itineraries where inquiry_id=q.id and status='current';
  if i.id is null or i.route_plan_id is null then raise exception 'JFLEET_PINNED_ROUTE_REQUIRED'; end if;
  select * into p from public.jfleet_route_plans where id=i.route_plan_id;
  if p.status is distinct from 'submitted' or p.inquiry_id is distinct from q.id
     or p.passenger_user_id is distinct from q.passenger_user_id then
    raise exception 'JFLEET_ROUTE_BINDING_INVALID';
  end if;
  if p.route->>'provider' is distinct from 'mapbox' or p.route->>'profile' is distinct from 'driving'
     or p.route#>>'{geometry,type}' is distinct from 'LineString'
     or jsonb_typeof(p.route#>'{geometry,coordinates}') is distinct from 'array'
     or jsonb_typeof(p.route->'distance_m') is distinct from 'number'
     or jsonb_typeof(p.route->'duration_s') is distinct from 'number' then
    raise exception 'JFLEET_ROUTE_GEOMETRY_INVALID';
  end if;
  if jsonb_array_length(p.route#>'{geometry,coordinates}') < 2
     or (p.route->>'distance_m')::numeric<=0 or (p.route->>'duration_s')::numeric<=0 then
    raise exception 'JFLEET_ROUTE_GEOMETRY_INVALID';
  end if;
  select jsonb_agg(jsonb_build_object('label',s.location_label,'lat',s.lat,'lng',s.lng,'notes',coalesce(s.notes,'')) order by s.sequence_no),
         jsonb_agg(jsonb_build_object('sequence_no',s.sequence_no,'stop_type',s.stop_type,'label',s.location_label,'lat',s.lat,'lng',s.lng,'notes',coalesce(s.notes,'')) order by s.sequence_no)
    into points,stops from public.jfleet_itinerary_stops s where s.itinerary_id=i.id;
  -- Pickup notes are stored only in the route plan by the original submission RPC.
  points:=jsonb_set(points,'{0,notes}',coalesce(p.points#>'{0,notes}','""'::jsonb));
  if points is distinct from p.points then raise exception 'JFLEET_ROUTE_STOPS_MISMATCH'; end if;
  return jsonb_build_object(
    'inquiry_id',q.id,'partner_id',q.partner_id,'passenger_user_id',q.passenger_user_id,
    'itinerary_id',i.id,'itinerary_version',i.version_no,'route_plan_id',p.id,
    'points',p.points,'stops',stops,'route',p.route,
    'details',jsonb_build_object('purpose',q.purpose,'vehicle_type',q.requested_vehicle_type,'trip_mode',q.trip_mode,
      'start_epoch',extract(epoch from q.scheduled_start_at),'end_epoch',extract(epoch from q.scheduled_end_at),
      'passenger_count',q.passenger_count,'cargo_description',q.cargo_description,'cargo_weight_kg',q.cargo_weight_kg,
      'luggage_notes',q.luggage_notes,'special_notes',q.special_notes));
end;
$jfleet$;

create function public.jfleet_require_route_review_v1(p_inquiry_id uuid,p_review_id uuid default null)
returns public.jfleet_route_reviews language plpgsql security invoker set search_path='' as $jfleet$
declare s jsonb; r public.jfleet_route_reviews%rowtype; owner_id uuid;
begin
  s:=public.jfleet_route_snapshot_v1(p_inquiry_id);
  select owner_user_id into owner_id from public.jfleet_partners
    where id=(s->>'partner_id')::uuid and status='active' for share;
  select * into r from public.jfleet_route_reviews where inquiry_id=p_inquiry_id order by created_at desc,id desc limit 1;
  if r.id is null or r.decision<>'approved' then raise exception 'JFLEET_ROUTE_REVIEW_REQUIRED'; end if;
  if owner_id is null or r.owner_user_id is distinct from owner_id
     or r.snapshot is distinct from s or (p_review_id is not null and r.id<>p_review_id) then
    raise exception 'JFLEET_ROUTE_REVIEW_STALE';
  end if;
  return r;
end;
$jfleet$;

create function public.jfleet_owner_route_context_v1(p_inquiry_id uuid,p_owner_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; s jsonb; r public.jfleet_route_reviews%rowtype; history jsonb;
begin
  select i.* into q from public.jfleet_inquiries i join public.jfleet_partners p on p.id=i.partner_id
    where i.id=p_inquiry_id and p.owner_user_id=p_owner_user_id and p.status='active' for update of i;
  if q.id is null then raise exception 'JFLEET_OWNER_INQUIRY_NOT_FOUND'; end if;
  s:=public.jfleet_route_snapshot_v1(q.id);
  select * into r from public.jfleet_route_reviews where inquiry_id=q.id order by created_at desc,id desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into history from (
    select id,decision,notes,created_at,itinerary_id,snapshot_hash from public.jfleet_route_reviews
    where inquiry_id=q.id order by created_at desc,id desc limit 20
  ) x;
  return jsonb_build_object('ok',true,'inquiry_code',q.inquiry_code,'status',q.status,'quote_due_at',q.quote_due_at,
    'snapshot',s,'snapshot_hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'),
    'approved_review_id',case when r.decision='approved' and r.snapshot=s and r.owner_user_id=p_owner_user_id then r.id else null end,
    'history',history);
end;
$jfleet$;

create function public.jfleet_owner_review_route_v1(
  p_inquiry_id uuid,p_owner_user_id uuid,p_snapshot_hash text,p_decision text,p_notes text,p_acknowledged boolean
) returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; s jsonb; h text; r public.jfleet_route_reviews%rowtype; n text:=trim(coalesce(p_notes,''));
begin
  select i.* into q from public.jfleet_inquiries i join public.jfleet_partners p on p.id=i.partner_id
    where i.id=p_inquiry_id and p.owner_user_id=p_owner_user_id and p.status='active' for update of i;
  if q.id is null then raise exception 'JFLEET_OWNER_INQUIRY_NOT_FOUND'; end if;
  if q.status not in ('quote_requested','under_review','quote_ready','revision_requested') or q.scheduled_start_at<=clock_timestamp() then
    raise exception 'JFLEET_ROUTE_REVIEW_CLOSED';
  end if;
  if p_decision is null or p_decision not in ('approved','changes_requested') or length(n)>1500
     or (p_decision='approved' and p_acknowledged is distinct from true)
     or (p_decision='changes_requested' and length(n)<3) then raise exception 'JFLEET_ROUTE_REVIEW_INPUT_INVALID'; end if;
  s:=public.jfleet_route_snapshot_v1(q.id);
  h:=encode(sha256(convert_to(s::text,'UTF8')),'hex');
  if h is distinct from p_snapshot_hash then raise exception 'JFLEET_ROUTE_REVIEW_STALE'; end if;
  select * into r from public.jfleet_route_reviews where inquiry_id=q.id order by created_at desc,id desc limit 1;
  if r.id is not null and r.snapshot=s and r.decision=p_decision and r.notes=n and r.owner_user_id=p_owner_user_id then
    return jsonb_build_object('ok',true,'review_id',r.id,'decision',r.decision,'already_recorded',true);
  end if;
  insert into public.jfleet_route_reviews(inquiry_id,itinerary_id,route_plan_id,owner_user_id,decision,snapshot,snapshot_hash,notes)
    values(q.id,(s->>'itinerary_id')::uuid,(s->>'route_plan_id')::uuid,p_owner_user_id,p_decision,s,h,n) returning * into r;
  update public.jfleet_quotes set status='withdrawn' where inquiry_id=q.id and status='sent';
  update public.jfleet_inquiries set status=case when p_decision='approved' then 'under_review' else 'revision_requested' end,
    owner_opened_at=coalesce(owner_opened_at,clock_timestamp()) where id=q.id;
  insert into public.jfleet_events(inquiry_id,actor_type,actor_id,event_type,details)
    values(q.id,'owner',p_owner_user_id::text,'route_'||p_decision,jsonb_build_object('review_id',r.id,'snapshot_hash',h,'notes',n));
  return jsonb_build_object('ok',true,'review_id',r.id,'decision',r.decision,'already_recorded',false);
end;
$jfleet$;

-- The new HTTP quotation flow must supply the approval actually displayed to the
-- owner. The wrapper locks and verifies it before using the existing pricing RPC.
create function public.jfleet_owner_send_reviewed_quote_v1(
  p_inquiry_id uuid,p_owner_user_id uuid,p_review_id uuid,p_total_amount numeric,p_valid_until timestamptz,
  p_inclusions text,p_exclusions text,p_pricing_notes text,p_fuel_basis_note text,p_items jsonb default '[]'::jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; r public.jfleet_route_reviews%rowtype; result jsonb;
begin
  select i.* into q from public.jfleet_inquiries i join public.jfleet_partners p on p.id=i.partner_id
    where i.id=p_inquiry_id and p.owner_user_id=p_owner_user_id and p.status='active' for update of i;
  if q.id is null then raise exception 'JFLEET_OWNER_INQUIRY_NOT_FOUND'; end if;
  if p_review_id is null then raise exception 'JFLEET_ROUTE_REVIEW_REQUIRED'; end if;
  r:=public.jfleet_require_route_review_v1(q.id,p_review_id);
  if q.scheduled_start_at<=clock_timestamp() or p_valid_until>q.scheduled_start_at then raise exception 'JFLEET_QUOTE_VALIDITY_INVALID'; end if;
  result:=public.jfleet_owner_send_quote_v1(q.id,p_owner_user_id,p_total_amount,p_valid_until,p_inclusions,p_exclusions,p_pricing_notes,p_fuel_basis_note,p_items,clock_timestamp());
  return result||jsonb_build_object('route_review_id',r.id,'route_plan_id',r.route_plan_id);
end;
$jfleet$;

create function public.jfleet_guard_quote_route_review_v1()
returns trigger language plpgsql security invoker set search_path='' as $jfleet$
declare r public.jfleet_route_reviews%rowtype;
begin
  if tg_op='UPDATE' and (to_jsonb(new)-array['status','accepted_at','declined_at','updated_at'])
     is distinct from (to_jsonb(old)-array['status','accepted_at','declined_at','updated_at']) then
    raise exception 'JFLEET_QUOTE_IMMUTABLE_CREATE_REVISION';
  end if;
  if tg_op='INSERT' or (new.status='accepted' and old.status is distinct from 'accepted') then
    r:=public.jfleet_require_route_review_v1(new.inquiry_id,new.route_review_id);
    if r.itinerary_id is distinct from new.itinerary_id
       or (r.snapshot->>'partner_id')::uuid is distinct from new.partner_id
       or r.owner_user_id is distinct from new.created_by_owner_user_id then raise exception 'JFLEET_ROUTE_REVIEW_STALE'; end if;
    new.route_review_id:=r.id;
  end if;
  return new;
end;
$jfleet$;
create trigger jfleet_guard_quote_route_review_trg before insert or update on public.jfleet_quotes
for each row execute function public.jfleet_guard_quote_route_review_v1();

create function public.jfleet_bind_booking_route_review_v1()
returns trigger language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_quotes%rowtype; r public.jfleet_route_reviews%rowtype;
begin
  if tg_op='UPDATE' then
    if row(new.accepted_quote_id,new.route_review_id,new.quoted_route_plan_id,new.inquiry_id,new.partner_id,new.passenger_user_id)
       is distinct from row(old.accepted_quote_id,old.route_review_id,old.quoted_route_plan_id,old.inquiry_id,old.partner_id,old.passenger_user_id) then
      raise exception 'JFLEET_BOOKED_ROUTE_REFERENCE_IMMUTABLE';
    end if;
    return new;
  end if;
  select * into q from public.jfleet_quotes where id=new.accepted_quote_id;
  if q.id is null or q.route_review_id is null or q.status<>'sent' then raise exception 'JFLEET_ROUTE_REVIEW_REQUIRED'; end if;
  r:=public.jfleet_require_route_review_v1(new.inquiry_id,q.route_review_id);
  if q.inquiry_id is distinct from new.inquiry_id or q.partner_id is distinct from new.partner_id
     or q.itinerary_id is distinct from new.current_itinerary_id
     or (r.snapshot->>'passenger_user_id')::uuid is distinct from new.passenger_user_id
     or q.valid_until<=clock_timestamp() then raise exception 'JFLEET_ROUTE_REVIEW_STALE'; end if;
  new.route_review_id:=r.id; new.quoted_route_plan_id:=r.route_plan_id;
  return new;
end;
$jfleet$;
create trigger jfleet_bind_booking_route_review_trg before insert or update on public.jfleet_bookings
for each row execute function public.jfleet_bind_booking_route_review_v1();

-- Preserve source evidence. Changes require a NEW route plan/itinerary version.
create function public.jfleet_freeze_route_evidence_v1()
returns trigger language plpgsql security invoker set search_path='' as $jfleet$
begin
  if tg_table_name='jfleet_route_reviews' then raise exception 'JFLEET_ROUTE_REVIEW_IMMUTABLE'; end if;
  if tg_table_name='jfleet_route_plans' and old.status='submitted' then raise exception 'JFLEET_SUBMITTED_ROUTE_IMMUTABLE'; end if;
  if tg_table_name='jfleet_itineraries' then
    if tg_op='DELETE' and old.route_plan_id is not null then raise exception 'JFLEET_PINNED_ITINERARY_IMMUTABLE'; end if;
    if tg_op='UPDATE' and old.route_plan_id is not null and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
      raise exception 'JFLEET_PINNED_ITINERARY_IMMUTABLE';
    end if;
    perform 1 from public.jfleet_inquiries where id=case when tg_op='DELETE' then old.inquiry_id else new.inquiry_id end for update;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$jfleet$;
create trigger jfleet_route_reviews_immutable before update or delete on public.jfleet_route_reviews for each row execute function public.jfleet_freeze_route_evidence_v1();
create trigger jfleet_route_plans_immutable before update or delete on public.jfleet_route_plans for each row execute function public.jfleet_freeze_route_evidence_v1();
create trigger jfleet_itineraries_immutable before insert or update or delete on public.jfleet_itineraries for each row execute function public.jfleet_freeze_route_evidence_v1();

create function public.jfleet_freeze_pinned_stops_v1()
returns trigger language plpgsql security invoker set search_path='' as $jfleet$
begin
  if exists(select 1 from public.jfleet_itineraries where route_plan_id is not null
    and id in (case when tg_op<>'INSERT' then old.itinerary_id end,case when tg_op<>'DELETE' then new.itinerary_id end)) then
    raise exception 'JFLEET_PINNED_STOPS_IMMUTABLE';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$jfleet$;
create trigger jfleet_pinned_stops_immutable before insert or update or delete on public.jfleet_itinerary_stops for each row execute function public.jfleet_freeze_pinned_stops_v1();

revoke all on function public.jfleet_route_snapshot_v1(uuid) from public,anon,authenticated;
revoke all on function public.jfleet_require_route_review_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jfleet_owner_route_context_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jfleet_owner_review_route_v1(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.jfleet_owner_send_reviewed_quote_v1(uuid,uuid,uuid,numeric,timestamptz,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.jfleet_guard_quote_route_review_v1() from public,anon,authenticated;
revoke all on function public.jfleet_bind_booking_route_review_v1() from public,anon,authenticated;
revoke all on function public.jfleet_freeze_route_evidence_v1() from public,anon,authenticated;
revoke all on function public.jfleet_freeze_pinned_stops_v1() from public,anon,authenticated;
grant execute on function public.jfleet_route_snapshot_v1(uuid) to service_role;
grant execute on function public.jfleet_require_route_review_v1(uuid,uuid) to service_role;
grant execute on function public.jfleet_owner_route_context_v1(uuid,uuid) to service_role;
grant execute on function public.jfleet_owner_review_route_v1(uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.jfleet_owner_send_reviewed_quote_v1(uuid,uuid,uuid,numeric,timestamptz,text,text,text,text,jsonb) to service_role;
comment on table public.jfleet_route_reviews is 'Immutable operator review of the route, ordered pins and quotation-basis details. Not permit verification or a guarantee of safe/legally accessible roads. Driver tracking and deviation alerts are separate features.';

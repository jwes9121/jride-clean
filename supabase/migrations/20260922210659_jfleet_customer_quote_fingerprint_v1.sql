-- Bind consent to the itemized quotation as well as the route and terms.
create or replace function public.jfleet_customer_state_token_v1(p_inquiry_id uuid) returns text
language plpgsql security invoker set search_path='' as $jfleet$
declare q public.jfleet_inquiries%rowtype; p public.jfleet_partners%rowtype; s jsonb; r uuid; qs jsonb;
begin
  select * into q from public.jfleet_inquiries where id=p_inquiry_id for update;
  if q.id is null then raise exception 'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'; end if;
  select * into p from public.jfleet_partners where id=q.partner_id for share;
  s:=public.jfleet_route_snapshot_v1(q.id);
  select id into r from public.jfleet_route_reviews where inquiry_id=q.id order by created_at desc,id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',qt.id,'status',qt.status,'version',qt.version_no,
    'items',(select coalesce(jsonb_agg(to_jsonb(z) order by z.sequence_no),'[]'::jsonb)
      from public.jfleet_quote_items z where z.quote_id=qt.id)) order by qt.version_no),'[]'::jsonb)
    into qs from public.jfleet_quotes qt where qt.inquiry_id=q.id;
  return encode(sha256(convert_to(jsonb_build_object('snapshot',s,'status',q.status,'booking',q.converted_booking_id,
    'review',r,'quotes',qs,'owner',p.owner_user_id,'partner_status',p.status,'quote_tat',p.quote_tat_minutes,
    'deposit',greatest(p.reservation_percent,20),'cancel_hours',p.free_cancel_hours,'late_percent',p.late_cancel_percent)::text,'UTF8')),'hex');
end;
$jfleet$;
create function public.jfleet_guard_quote_items_v1() returns trigger
language plpgsql security invoker set search_path='' as $jfleet$
declare quote_state text; inquiry uuid;
begin
  if tg_op<>'INSERT' then raise exception 'JFLEET_QUOTE_ITEMS_IMMUTABLE'; end if;
  select inquiry_id into inquiry from public.jfleet_quotes where id=new.quote_id;
  perform 1 from public.jfleet_inquiries where id=inquiry for update;
  select status into quote_state from public.jfleet_quotes where id=new.quote_id;
  if quote_state is distinct from 'sent' then raise exception 'JFLEET_QUOTE_ITEMS_CLOSED'; end if;
  return new;
end;
$jfleet$;
create trigger jfleet_quote_items_immutable before insert or update or delete on public.jfleet_quote_items
for each row execute function public.jfleet_guard_quote_items_v1();
revoke all on function public.jfleet_guard_quote_items_v1() from public,anon,authenticated;

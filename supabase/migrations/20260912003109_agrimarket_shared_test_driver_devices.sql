-- TEST-0001 is the reserved shared Test Driver used on phones and emulators.
-- Match its fixed seed UUID, never a display name or a client-supplied test flag.
-- Each phone still requires its own staff-approved credential. Request expiry,
-- token/device verification, revocation and audit events remain in force.
-- Regular driver accounts continue to have exactly one approved phone.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop index public.agrimarket_driver_devices_one_approved;
create unique index agrimarket_driver_devices_one_approved
  on public.agrimarket_driver_devices(driver_id)
  where status = 'approved'
    and driver_id <> '00000000-0000-4000-8000-000000000001'::uuid;

create or replace function public.agrimarket_review_driver_device_v1(
  p_id uuid,p_decision text,p_actor text,p_actor_role text,p_note text,p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare d agrimarket_driver_devices%rowtype; old_id uuid;
begin
  if p_actor_role is distinct from 'admin' or length(trim(coalesce(p_actor,'')))<2 then raise exception 'AGRIMARKET_ADMIN_REQUIRED'; end if;
  if coalesce(p_decision,'') not in ('approve','revoke') or length(trim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'DRIVER_DEVICE_REVIEW_INVALID'; end if;
  select * into d from agrimarket_driver_devices where id=p_id;
  if d.id is null then raise exception 'DRIVER_DEVICE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_device:'||d.driver_id::text,0));
  select * into d from agrimarket_driver_devices where id=p_id for update;
  if p_decision='approve' then
    if d.status='revoked' then raise exception 'DRIVER_DEVICE_REVOKED'; end if;
    if d.status='pending' and d.created_at<p_now-interval '24 hours' then raise exception 'DRIVER_DEVICE_REQUEST_EXPIRED'; end if;
    if d.status='approved' then return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status','approved'); end if;
    -- Only the reserved shared Test Driver may keep multiple approved phones.
    if d.driver_id <> '00000000-0000-4000-8000-000000000001'::uuid then
      for old_id in update agrimarket_driver_devices set status='revoked',reviewed_at=p_now,reviewed_by=p_actor,review_note='Replaced by another approved phone' where driver_id=d.driver_id and status='approved' returning id loop
        insert into agrimarket_driver_device_events(device_credential_id,event_type,actor,note,created_at) values(old_id,'revoked',p_actor,'Replaced by another approved phone',p_now);
      end loop;
    end if;
  elsif d.status='revoked' then return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status','revoked');
  end if;
  update agrimarket_driver_devices set status=case p_decision when 'approve' then 'approved' else 'revoked' end,reviewed_at=p_now,reviewed_by=p_actor,review_note=trim(p_note) where id=d.id;
  insert into agrimarket_driver_device_events(device_credential_id,event_type,actor,note,created_at) values(d.id,case p_decision when 'approve' then 'approved' else 'revoked' end,p_actor,trim(p_note),p_now);
  return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status',case p_decision when 'approve' then 'approved' else 'revoked' end);
end; $$;
revoke all on function public.agrimarket_review_driver_device_v1(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_review_driver_device_v1(uuid,text,text,text,text,timestamptz) to service_role;

begin;

create or replace function public.vendor_acknowledge_suspension_v1(
  p_vendor_id uuid,
  p_sanction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acknowledged_at timestamptz;
begin
  if p_vendor_id is null or p_sanction_id is null then
    raise exception 'VENDOR_AND_SANCTION_REQUIRED' using errcode = 'P0001';
  end if;

  update public.vendor_sanctions
  set acknowledged_at = coalesce(acknowledged_at, clock_timestamp())
  where id = p_sanction_id
    and vendor_id = p_vendor_id
    and status = 'active'
    and sanction_type in ('suspension_7_days', 'manual')
    and ends_at > clock_timestamp()
  returning acknowledged_at into v_acknowledged_at;

  if not found then
    raise exception 'ACTIVE_SUSPENSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'sanction_id', p_sanction_id,
    'vendor_id', p_vendor_id,
    'acknowledged_at', v_acknowledged_at
  );
end;
$$;

revoke all on function public.vendor_acknowledge_suspension_v1(uuid, uuid) from public;
revoke all on function public.vendor_acknowledge_suspension_v1(uuid, uuid) from anon;
revoke all on function public.vendor_acknowledge_suspension_v1(uuid, uuid) from authenticated;
grant execute on function public.vendor_acknowledge_suspension_v1(uuid, uuid) to service_role;

commit;

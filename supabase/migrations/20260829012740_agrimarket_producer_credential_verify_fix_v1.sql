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
  select c.* into v_cred
  from public.agrimarket_producer_credentials c
  where c.access_code = upper(trim(coalesce(p_access_code,'')))
  for update;

  if not found or v_cred.status <> 'active' then
    return;
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > p_now then
    return;
  end if;

  if coalesce(p_pin,'') = '' or extensions.crypt(p_pin,v_cred.pin_hash) <> v_cred.pin_hash then
    v_failures := least(coalesce(v_cred.failed_attempts,0) + 1,100);
    update public.agrimarket_producer_credentials c
    set failed_attempts = v_failures,
        locked_until = case when v_failures >= 5 then p_now + interval '15 minutes' else null end,
        updated_at = p_now
    where c.id = v_cred.id;
    return;
  end if;

  update public.agrimarket_producer_credentials c
  set failed_attempts = 0,
      locked_until = null,
      last_used_at = p_now,
      updated_at = p_now
  where c.id = v_cred.id;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id = v_cred.producer_id;

  if not found or v_producer.status <> 'active' then
    return;
  end if;

  return query
  select v_producer.id,v_cred.access_code,v_producer.status,v_producer.accepting_orders;
end;
$function$;

revoke all on function public.agrimarket_verify_producer_credential_v1(text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.agrimarket_verify_producer_credential_v1(text,text,timestamptz) to service_role;

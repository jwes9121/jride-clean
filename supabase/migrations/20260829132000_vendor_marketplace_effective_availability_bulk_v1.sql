create or replace function public.vendor_marketplace_effective_availability_bulk()
returns table (
  vendor_id uuid,
  effective_accepting_orders boolean,
  availability_reason text,
  hours_enforced boolean,
  hours_configured boolean,
  daily_opened boolean,
  normal_open_time time without time zone,
  normal_close_time time without time zone,
  scheduled_close_at timestamp with time zone,
  extension_active boolean,
  extended_until timestamp with time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select
    va.id as vendor_id,
    case
      when coalesce(va.hours_enforced, false) is false then false
      when va.normal_open_time is null or va.normal_close_time is null then false
      else coalesce(s.effective_accepting_orders, false)
    end as effective_accepting_orders,
    case
      when coalesce(va.hours_enforced, false) is false then 'hours_required'
      when va.normal_open_time is null or va.normal_close_time is null then 'hours_required'
      else coalesce(s.reason, 'unavailable')
    end as availability_reason,
    coalesce(va.hours_enforced, false) as hours_enforced,
    (va.normal_open_time is not null and va.normal_close_time is not null) as hours_configured,
    (va.daily_open_date = (now() at time zone 'Asia/Manila')::date and va.accepting_orders is true) as daily_opened,
    va.normal_open_time,
    va.normal_close_time,
    s.scheduled_close_at,
    coalesce(s.extension_active, false) as extension_active,
    s.extended_until
  from public.vendor_accounts va
  left join lateral public.vendor_effective_availability(va.id, now()) s on true;
$$;

revoke all on function public.vendor_marketplace_effective_availability_bulk() from public;
grant execute on function public.vendor_marketplace_effective_availability_bulk() to service_role;
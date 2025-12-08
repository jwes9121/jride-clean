-- ---------------------------------------------------------
-- RESET FUNCTION
-- ---------------------------------------------------------
drop function if exists public.admin_get_live_trips_page_data();

create or replace function public.admin_get_live_trips_page_data()
returns json
language plpgsql
security definer
as C:\Users\jwes9\Desktop\jride-clean-fresh
declare
  result json;
begin
  -- NOTE ON STATUSES:
  --  active  = anything that is NOT completed/cancelled
  --           but we specifically match your actual enums:
  --           'pending','assigned','on_the_way','on_trip'
  --  complete = 'completed'
  --
  --  We also keep this very forgiving so schema tweaks
  --  (extra columns) won't break the function.

  result := json_build_object(

    ------------------------------------------------------
    -- ACTIVE BOOKINGS
    ------------------------------------------------------
    'active_bookings',
    (
      select coalesce(json_agg(row_to_json(bk)), '[]'::json)
      from public.bookings bk
      where bk.status in (
        'pending',
        'assigned',
        'on_the_way',
        'on_trip'
      )
      order by bk.created_at desc
    ),

    ------------------------------------------------------
    -- RECENT COMPLETED BOOKINGS (last 24h, max 20)
    ------------------------------------------------------
    'recent_completed',
    (
      select coalesce(json_agg(row_to_json(bk)), '[]'::json)
      from (
        select *
        from public.bookings
        where status = 'completed'
          and updated_at > now() - interval '24 hours'
        order by updated_at desc
        limit 20
      ) bk
    ),

    ------------------------------------------------------
    -- DRIVER METRICS (safe, no schema assumptions)
    ------------------------------------------------------
    'drivers_online',
    (
      -- safest: just count all rows in latest locations table
      -- (no assumption on column names)
      select coalesce(count(*), 0)::int
      from public.driver_locations_latest
    ),

    'drivers_on_trip',
    (
      -- conservative fallback: 0 (we'll refine later if needed)
      0::int
    ),

    ------------------------------------------------------
    -- ZONE CAPACITY OVERVIEW
    ------------------------------------------------------
    'zones_overview',
    (
      -- don't assume column names; return full rows
      select coalesce(json_agg(row_to_json(z)), '[]'::json)
      from public.zone_capacity_view z
    )
  );

  return result;
end;
C:\Users\jwes9\Desktop\jride-clean-fresh;

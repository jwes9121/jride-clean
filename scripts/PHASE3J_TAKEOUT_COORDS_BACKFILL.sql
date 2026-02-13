-- PHASE3J_TAKEOUT_COORDS_BACKFILL.sql
-- One-time backfill for legacy TAKEOUT bookings with missing coords (NULL/0).
-- Rules:
--  - Only service_type='takeout'
--  - Only active rows (status NOT IN completed/cancelled)
--  - Only fills coords when missing (NULL/0)
--  - Pickup coords from vendor coords source (auto-detected)
--  - Dropoff coords from passenger primary/default address coords source (auto-detected)
--  - If sources cannot be detected, script will NO-OP with NOTICE.

do $$
declare
  v_booking_vendor_fk text;
  v_vendor_table text;
  v_vendor_id_col text;
  v_vendor_lat_col text;
  v_vendor_lng_col text;

  v_booking_user_fk text;
  v_addr_table text;
  v_addr_user_col text;
  v_addr_lat_col text;
  v_addr_lng_col text;
  v_addr_primary_col text;

  v_sql text;
  v_updated bigint;
begin
  -- 1) Detect booking -> vendor FK column (common patterns)
  select c.column_name into v_booking_vendor_fk
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='bookings'
    and c.column_name in ('vendor_id','vendor_account_id','vendor_profile_id','vendor_user_id')
  order by case c.column_name
    when 'vendor_id' then 1
    when 'vendor_account_id' then 2
    when 'vendor_profile_id' then 3
    when 'vendor_user_id' then 4
    else 99 end
  limit 1;

  -- 2) Detect booking -> user FK column (common patterns)
  select c.column_name into v_booking_user_fk
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='bookings'
    and c.column_name in ('user_id','passenger_id','passenger_user_id')
  order by case c.column_name
    when 'user_id' then 1
    when 'passenger_user_id' then 2
    when 'passenger_id' then 3
    else 99 end
  limit 1;

  -- 3) Detect a vendor coords source table (must have: id-ish column + lat/lng-ish columns)
  -- We try a ranked search across public tables.
  with t as (
    select
      c.table_name,
      max(case when c.column_name in ('id','vendor_id','vendor_account_id','vendor_profile_id','user_id') then c.column_name end) as id_col,
      max(case when c.column_name in ('lat','latitude','vendor_lat','pickup_lat') then c.column_name end) as lat_col,
      max(case when c.column_name in ('lng','lon','longitude','vendor_lng','pickup_lng') then c.column_name end) as lng_col
    from information_schema.columns c
    where c.table_schema='public'
    group by c.table_name
  ),
  ranked as (
    select *,
      case
        when table_name in ('vendors','vendor_accounts','vendor_profiles') then 1
        when table_name like '%vendor%' then 2
        else 5
      end as rnk
    from t
    where id_col is not null and lat_col is not null and lng_col is not null
  )
  select table_name, id_col, lat_col, lng_col
    into v_vendor_table, v_vendor_id_col, v_vendor_lat_col, v_vendor_lng_col
  from ranked
  order by rnk, table_name
  limit 1;

  -- 4) Detect passenger address table (must have: user_id-ish + lat/lng-ish + primary/default-ish)
  with t as (
    select
      c.table_name,
      max(case when c.column_name in ('user_id','passenger_id','passenger_user_id') then c.column_name end) as user_col,
      max(case when c.column_name in ('lat','latitude','dropoff_lat') then c.column_name end) as lat_col,
      max(case when c.column_name in ('lng','lon','longitude','dropoff_lng') then c.column_name end) as lng_col,
      max(case when c.column_name in ('is_primary','is_default','primary','default','is_main') then c.column_name end) as primary_col
    from information_schema.columns c
    where c.table_schema='public'
    group by c.table_name
  ),
  ranked as (
    select *,
      case
        when table_name in ('passenger_addresses','addresses','user_addresses') then 1
        when table_name like '%address%' then 2
        else 5
      end as rnk
    from t
    where user_col is not null and lat_col is not null and lng_col is not null and primary_col is not null
  )
  select table_name, user_col, lat_col, lng_col, primary_col
    into v_addr_table, v_addr_user_col, v_addr_lat_col, v_addr_lng_col, v_addr_primary_col
  from ranked
  order by rnk, table_name
  limit 1;

  raise notice 'Detected bookings.vendor fk: %', coalesce(v_booking_vendor_fk,'(none)');
  raise notice 'Detected bookings.user fk: %', coalesce(v_booking_user_fk,'(none)');
  raise notice 'Detected vendor coords source: %.% (id=% lat=% lng=%)',
    'public', coalesce(v_vendor_table,'(none)'), coalesce(v_vendor_id_col,'(none)'), coalesce(v_vendor_lat_col,'(none)'), coalesce(v_vendor_lng_col,'(none)');
  raise notice 'Detected address source: %.% (user=% lat=% lng=% primary=%)',
    'public', coalesce(v_addr_table,'(none)'), coalesce(v_addr_user_col,'(none)'), coalesce(v_addr_lat_col,'(none)'), coalesce(v_addr_lng_col,'(none)'), coalesce(v_addr_primary_col,'(none)');

  if v_booking_vendor_fk is null or v_vendor_table is null then
    raise notice 'NO-OP: Cannot backfill pickup coords (missing bookings vendor fk or vendor coords table).';
  end if;

  if v_booking_user_fk is null or v_addr_table is null then
    raise notice 'NO-OP: Cannot backfill dropoff coords (missing bookings user fk or address table).';
  end if;

  -- Build a single UPDATE that fills what it can (pickup and/or dropoff), without touching rows that already have coords.
  v_sql := 'update public.bookings b set ';

  if v_booking_vendor_fk is not null and v_vendor_table is not null then
    v_sql := v_sql ||
      'pickup_lat = case when (b.pickup_lat is null or b.pickup_lat = 0) then v.'||quote_ident(v_vendor_lat_col)||' else b.pickup_lat end, '||
      'pickup_lng = case when (b.pickup_lng is null or b.pickup_lng = 0) then v.'||quote_ident(v_vendor_lng_col)||' else b.pickup_lng end, ';
  end if;

  if v_booking_user_fk is not null and v_addr_table is not null then
    v_sql := v_sql ||
      'dropoff_lat = case when (b.dropoff_lat is null or b.dropoff_lat = 0) then a.'||quote_ident(v_addr_lat_col)||' else b.dropoff_lat end, '||
      'dropoff_lng = case when (b.dropoff_lng is null or b.dropoff_lng = 0) then a.'||quote_ident(v_addr_lng_col)||' else b.dropoff_lng end, ';
  end if;

  -- Trim trailing comma+space
  v_sql := regexp_replace(v_sql, ',\s*$', '');

  -- FROM/JOIN clauses
  v_sql := v_sql || ' from ';

  if v_booking_vendor_fk is not null and v_vendor_table is not null then
    v_sql := v_sql || 'public.'||quote_ident(v_vendor_table)||' v ';
  else
    v_sql := v_sql || '(select 1) v ';
  end if;

  if v_booking_user_fk is not null and v_addr_table is not null then
    v_sql := v_sql || ' left join lateral (select * from public.'||quote_ident(v_addr_table)||
             ' aa where aa.'||quote_ident(v_addr_user_col)||' = b.'||quote_ident(v_booking_user_fk)||
             ' and coalesce(aa.'||quote_ident(v_addr_primary_col)||'::text,''false'') in (''true'',''t'',''1'',''yes'') '||
             ' order by 1 limit 1) a on true ';
  else
    v_sql := v_sql || ' left join lateral (select null::double precision as x, null::double precision as y) a on true ';
  end if;

  -- WHERE constraints (strict)
  v_sql := v_sql || ' where b.service_type = ''takeout'' and b.status not in (''completed'',''cancelled'') and ( '||
          ' (b.pickup_lat is null or b.pickup_lng is null or b.pickup_lat = 0 or b.pickup_lng = 0) '||
          ' or (b.dropoff_lat is null or b.dropoff_lng is null or b.dropoff_lat = 0 or b.dropoff_lng = 0) '||
          ' ) ';

  if v_booking_vendor_fk is not null and v_vendor_table is not null then
    v_sql := v_sql || ' and (b.'||quote_ident(v_booking_vendor_fk)||' is null or b.'||quote_ident(v_booking_vendor_fk)||' = b.'||quote_ident(v_booking_vendor_fk)||') ';
    v_sql := v_sql || ' and (b.'||quote_ident(v_booking_vendor_fk)||' is null or v.'||quote_ident(v_vendor_id_col)||' = b.'||quote_ident(v_booking_vendor_fk)||') ';
    v_sql := v_sql || ' and (v.'||quote_ident(v_vendor_lat_col)||' is not null and v.'||quote_ident(v_vendor_lng_col)||' is not null and v.'||quote_ident(v_vendor_lat_col)||' <> 0 and v.'||quote_ident(v_vendor_lng_col)||' <> 0) ';
  end if;

  -- If we have neither source, do nothing.
  if (v_booking_vendor_fk is null or v_vendor_table is null) and (v_booking_user_fk is null or v_addr_table is null) then
    raise notice 'NO-OP: No detected sources. Nothing will be updated.';
    return;
  end if;

  raise notice 'Running backfill SQL: %', v_sql;

  execute v_sql;
  get diagnostics v_updated = row_count;

  raise notice 'Backfill updated rows: %', v_updated;
end $$;

-- Verification query (should be 0 after backfill)
select count(*)
from public.bookings
where service_type = 'takeout'
and status not in ('completed','cancelled')
and (
  pickup_lat is null or pickup_lng is null
  or dropoff_lat is null or dropoff_lng is null
  or pickup_lat = 0 or pickup_lng = 0
  or dropoff_lat = 0 or dropoff_lng = 0
);
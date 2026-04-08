param(
  [string]$OutFile = ".\JRIDE_BOOKINGS_RLS_DIAGNOSTIC.sql"
)

$ErrorActionPreference = "Stop"

$sql = @"
-- JRIDE BOOKINGS RLS DIAGNOSTIC
-- Run this in Supabase SQL Editor and paste back the FULL results.

-- 1) Confirm table schema basics
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'bookings';

-- 2) List all policies on public.bookings
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'bookings'
order by policyname;

-- 3) Show grants on public.bookings
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'bookings'
order by grantee, privilege_type;

-- 4) Show bookings columns exactly
select
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'bookings'
order by ordinal_position;

-- 5) Show whether created_by_user_id exists and its type
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'bookings'
  and column_name in (
    'id',
    'booking_code',
    'status',
    'town',
    'from_label',
    'to_label',
    'pickup_lat',
    'pickup_lng',
    'dropoff_lat',
    'dropoff_lng',
    'service_type',
    'passenger_count',
    'created_by_user_id',
    'customer_status'
  )
order by column_name;

-- 6) Show triggers on public.bookings
select
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as trigger_def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'bookings'
  and not t.tgisinternal
order by t.tgname;

-- 7) Show policies/functions that may reference auth.uid()
select
  p.polname as policy_name,
  pg_get_expr(p.polqual, p.polrelid) as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'bookings'
order by p.polname;
"@

Set-Content -LiteralPath $OutFile -Value $sql -Encoding UTF8

Write-Host ""
Write-Host "[OK] Wrote SQL diagnostic file:" -ForegroundColor Green
Write-Host "     $OutFile"
Write-Host ""
Write-Host "NEXT:"
Write-Host "1. Open Supabase Dashboard"
Write-Host "2. Go to SQL Editor"
Write-Host "3. Click New query"
Write-Host "4. Open the generated file and paste ALL contents"
Write-Host "5. Run it"
Write-Host "6. Paste back ALL result grids here"
Write-Host ""
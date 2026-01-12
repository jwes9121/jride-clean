# GEN-PHASE3J_TAKEOUT_BACKFILL_SQL_V2_DETERMINISTIC.ps1
# Writes a deterministic one-time backfill SQL for TAKEOUT legacy rows (NULL/0 coords)
# Sources (confirmed by your schema):
#  - bookings.vendor_id -> vendor_accounts (assumes vendor_accounts.id)
#  - bookings.created_by_user_id -> passenger_addresses.created_by_user_id (primary only)

$ErrorActionPreference = "Stop"
function Ok($m){ Write-Host $m -ForegroundColor Green }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "scripts"
if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$outPath = Join-Path $outDir "PHASE3J_TAKEOUT_COORDS_BACKFILL_V2.sql"

$sql = @'
-- PHASE3J_TAKEOUT_COORDS_BACKFILL_V2.sql
-- One-time legacy cleanup:
--   - Only service_type='takeout'
--   - Only status NOT IN ('completed','cancelled')
--   - Only fills fields where NULL or 0
--   - Dropoff from passenger_addresses (is_primary=true) using bookings.created_by_user_id
--   - Pickup from vendor_accounts using bookings.vendor_id (only if pickup missing)

begin;

-- 1) DROP-OFF backfill (most of your remaining rows are here)
update public.bookings b
set
  dropoff_lat = pa.lat,
  dropoff_lng = pa.lng
from public.passenger_addresses pa
where b.service_type = 'takeout'
  and b.status not in ('completed','cancelled')
  and (b.dropoff_lat is null or b.dropoff_lng is null or b.dropoff_lat = 0 or b.dropoff_lng = 0)
  and pa.created_by_user_id = b.created_by_user_id
  and pa.is_primary is true
  and pa.lat is not null and pa.lng is not null
  and pa.lat <> 0 and pa.lng <> 0;

-- 2) PICK-UP backfill (only if any legacy rows still have pickup missing)
-- Assumption: vendor_accounts.id matches bookings.vendor_id (typical)
update public.bookings b
set
  pickup_lat = va.lat,
  pickup_lng = va.lng
from public.vendor_accounts va
where b.service_type = 'takeout'
  and b.status not in ('completed','cancelled')
  and (b.pickup_lat is null or b.pickup_lng is null or b.pickup_lat = 0 or b.pickup_lng = 0)
  and b.vendor_id is not null
  and va.id = b.vendor_id
  and va.lat is not null and va.lng is not null
  and va.lat <> 0 and va.lng <> 0;

-- Verification (EXPECTED: 0)
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

commit;
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $sql, $utf8NoBom)

Ok "[OK] Wrote SQL: $outPath"
